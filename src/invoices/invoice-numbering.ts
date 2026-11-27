import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Company-wise invoice numbering.
 *
 * Every company (business) keeps its own running sequence per resolved prefix,
 * e.g. "INV-2026-" or "INV/26-27/". The counter lives in `invoice_number_sequences`
 * and is only advanced inside the transaction that saves the invoice, while the
 * company row is locked, so two saves can never receive the same number.
 */

/** Default minimum digits of the running number: INV-01, INV-02 … INV-99, INV-100. */
export const INVOICE_SEQUENCE_DIGITS = 2;
/** Template length cap: even if every character were a {FY} token the resolved prefix stays ≤ 30, so numbers fit the 40-char limit. */
export const INVOICE_PREFIX_MAX = 24;
/** Letters, digits, / _ . - and the date tokens {YYYY}, {YY}, {FY}. Must start with a letter, digit or token (or be empty). */
export const INVOICE_PREFIX_PATTERN = /^(?:(?:[A-Za-z0-9]|\{(?:YYYY|YY|FY)\})(?:[A-Za-z0-9/_.-]|\{(?:YYYY|YY|FY)\})*)?$/;
/** What companies that never set a custom prefix keep using, based on the older "numbering prefix" choice. */
export const LEGACY_INVOICE_PREFIXES: Record<string, string> = { invoice: 'INV-', bill: 'BILL-', none: '' };
const MAX_SKIPS = 10_000;

export function isValidInvoicePrefix(value: unknown): value is string {
  return typeof value === 'string' && value.length <= INVOICE_PREFIX_MAX && INVOICE_PREFIX_PATTERN.test(value);
}

/** Indian financial year (April–March) of a date, e.g. 2026-05-10 → "26-27". */
function financialYear(date: Date) {
  const start = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  const two = (year: number) => String(year % 100).padStart(2, '0');
  return `${two(start)}-${two(start + 1)}`;
}

/** Replaces the date tokens of a prefix template using the invoice date. */
export function resolveInvoicePrefix(template: string, date: Date): string {
  const year = date.getUTCFullYear();
  return template
    .replaceAll('{YYYY}', String(year))
    .replaceAll('{YY}', String(year % 100).padStart(2, '0'))
    .replaceAll('{FY}', financialYear(date));
}

export function formatInvoiceNumber(prefix: string, sequence: number, digits = INVOICE_SEQUENCE_DIGITS): string {
  return `${prefix}${String(sequence).padStart(digits, '0')}`;
}

/** Highest sequence already used under `prefix`, also reading legacy branch-prefixed numbers ("MAIN-INV-2026-000012"). */
export function highestSequence(numbers: string[], prefix: string, branchCodes: string[]): number {
  const wanted = prefix.toUpperCase();
  const legacyStarts = branchCodes.map((code) => `${code.toUpperCase()}-${wanted}`);
  let highest = 0;
  for (const number of numbers) {
    const upper = number.toUpperCase();
    const start = upper.startsWith(wanted) && /^\d+$/.test(upper.slice(wanted.length)) ? wanted : legacyStarts.find((legacy) => upper.startsWith(legacy));
    if (start === undefined) continue;
    const digits = upper.slice(start.length);
    if (!/^\d{1,9}$/.test(digits)) continue;
    highest = Math.max(highest, Number(digits));
  }
  return highest;
}

type NumberingDb = Pick<Prisma.TransactionClient, 'invoice' | 'branch' | 'invoiceNumberSequence'>;

/** Serializes every invoice-number change of one company. Call inside the saving transaction. */
export async function lockCompanyNumbering(tx: Prisma.TransactionClient, businessId: string) {
  await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR UPDATE`;
}

/** True when another invoice of the company (deleted ones included, numbers are never reused) already has this number. */
export async function invoiceNumberTaken(db: Pick<Prisma.TransactionClient, 'invoice'>, businessId: string, invoiceNumber: string, exceptInvoiceId?: string) {
  const count = await db.invoice.count({ where: { businessId, invoiceNumber, ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) } });
  return count > 0;
}

async function lastUsedSequence(db: NumberingDb, businessId: string, prefix: string) {
  const row = await db.invoiceNumberSequence.findUnique({ where: { businessId_prefix: { businessId, prefix } }, select: { lastNumber: true } });
  if (row) return { last: row.lastNumber, stored: true };
  // First number under this prefix: continue after anything already saved with it.
  const [invoices, branches] = await Promise.all([
    db.invoice.findMany({ where: { businessId, ...(prefix ? { invoiceNumber: { contains: prefix } } : {}) }, select: { invoiceNumber: true } }),
    db.branch.findMany({ where: { businessId }, select: { code: true } }),
  ]);
  return { last: highestSequence(invoices.map(({ invoiceNumber }) => invoiceNumber), prefix, branches.map(({ code }) => code)), stored: false };
}

/** A company's numbering settings: prefix template and minimum digits of the running number. */
export type InvoiceNumberFormat = { prefix: string; digits: number };

async function nextFree(db: NumberingDb, businessId: string, prefix: string, digits: number, after: number) {
  for (let sequence = after + 1, tries = 0; tries < MAX_SKIPS; sequence++, tries++) {
    const invoiceNumber = formatInvoiceNumber(prefix, sequence, digits);
    if (!(await invoiceNumberTaken(db, businessId, invoiceNumber))) return { sequence, invoiceNumber };
  }
  throw new ConflictException('Could not find a free invoice number. Change the invoice prefix in Settings → Transaction.');
}

/** The number the next saved invoice would most likely get. Read-only: nothing is reserved. */
export async function previewInvoiceNumber(db: NumberingDb, businessId: string, format: InvoiceNumberFormat, date: Date) {
  const prefix = resolveInvoicePrefix(format.prefix, date);
  const { last } = await lastUsedSequence(db, businessId, prefix);
  return (await nextFree(db, businessId, prefix, format.digits, last)).invoiceNumber;
}

/** Takes the next free number and advances the company's counter. The caller must hold {@link lockCompanyNumbering}. */
export async function allocateInvoiceNumber(tx: Prisma.TransactionClient, businessId: string, format: InvoiceNumberFormat, date: Date) {
  const prefix = resolveInvoicePrefix(format.prefix, date);
  const { last, stored } = await lastUsedSequence(tx, businessId, prefix);
  const { sequence, invoiceNumber } = await nextFree(tx, businessId, prefix, format.digits, last);
  if (stored) await tx.invoiceNumberSequence.update({ where: { businessId_prefix: { businessId, prefix } }, data: { lastNumber: sequence } });
  else await tx.invoiceNumberSequence.create({ data: { businessId, prefix, lastNumber: sequence } });
  return invoiceNumber;
}
