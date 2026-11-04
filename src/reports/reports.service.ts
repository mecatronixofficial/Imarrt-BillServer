import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { sumMoney, subtractMoney } from '../common/utils/billing.util.js';
import { TransactionReportQueryDto, type TransactionKind } from './reports.dto.js';

/** One line of the All Transactions report, whatever kind of record it came from. */
export type TransactionReportRow = {
  id: string;
  kind: TransactionKind;
  type: string;
  date: Date;
  number: string;
  partyName: string;
  category: string;
  total: number;
  paid: number;
  balance: number;
  dueDate: Date | null;
  status: string;
  paymentType: string;
  warehouseId: string | null;
  createdById: string | null;
  createdByName: string | null;
  href: string;
  /** Sales invoices and documents, as their registers return them, for the shared row actions. */
  record?: Record<string, unknown>;
};

const DOCUMENT_KINDS: Record<string, { kind: TransactionKind; type: string; href: string }> = {
  PURCHASE_INVOICE: { kind: 'PURCHASE', type: 'Purchase', href: '/documents/' },
  QUOTATION: { kind: 'ESTIMATE', type: 'Estimate', href: '/documents/' },
  PROFORMA_INVOICE: { kind: 'PROFORMA', type: 'Proforma Invoice', href: '/documents/' },
  SALES_ORDER: { kind: 'SALE_ORDER', type: 'Sale Order', href: '/documents/' },
  DELIVERY_CHALLAN: { kind: 'DELIVERY_CHALLAN', type: 'Delivery Challan', href: '/documents/' },
  CREDIT_NOTE: { kind: 'SALE_RETURN', type: 'Credit Note', href: '/documents/' },
  DEBIT_NOTE: { kind: 'PURCHASE_RETURN', type: 'Debit Note', href: '/documents/' },
};
const ENTRY_KINDS: Record<string, { kind: TransactionKind; type: string; href: string }> = {
  OTHER_INCOME: { kind: 'OTHER_INCOME', type: 'Other Income', href: '/sales/other-income' },
  LOAN_PAYMENT: { kind: 'EMI', type: 'EMI Paid', href: '/cash-banks/loans' },
  LOAN_OPENING: { kind: 'LOAN', type: 'Loan Received', href: '/cash-banks/loans' },
  CASH_ADJUSTMENT: { kind: 'CASH_ADJUSTMENT', type: 'Cash Adjustment', href: '/cash-banks/cash' },
  TRANSFER_OUT: { kind: 'TRANSFER', type: 'Bank Transfer', href: '/cash-banks' },
};
const LIVE_NOTE = { deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] as Prisma.EnumDocumentStatusFilter['notIn'] } };
/** More rows than this in one period should be narrowed by date. */
const MAX_ROWS = 5000;

/** Runs the query only when it is needed. */
function when<T>(needed: unknown, query: () => Promise<T[]>): Promise<T[]> {
  return needed ? query() : Promise.resolve([]);
}

/** Inclusive YYYY-MM-DD bounds; dates are stored as UTC midnight. */
function range(from: string, to: string) {
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: new Date(`${from}T00:00:00.000Z`), lt: end };
}

/** How a record was paid: its latest payment's method, or "credit" while nothing is paid. */
function paidBy(methods: Array<string | null | undefined>, fallback = 'credit') {
  return methods.find(Boolean) ?? fallback;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every sale, purchase, payment, expense and money movement in the period, newest first. */
  async transactions(businessId: string, branchId: string | undefined, query: TransactionReportQueryDto): Promise<TransactionReportRow[]> {
    if (query.from > query.to) throw new BadRequestException('From date must be on or before the To date');
    const scope = { businessId, ...(branchId ? { branchId } : {}) };
    const dates = range(query.from, query.to);
    const wants = (kind: TransactionKind | TransactionKind[]) => !query.type || [kind].flat().includes(query.type);
    const user = { select: { id: true, name: true } } as const;
    const documentTypes = Object.entries(DOCUMENT_KINDS).filter(([, meta]) => wants(meta.kind)).map(([type]) => type);
    const entryKinds = Object.entries(ENTRY_KINDS).filter(([, meta]) => wants(meta.kind)).map(([kind]) => kind);

    const [invoices, receipts, documents, paymentsOut, orders, expenses, entries] = await Promise.all([
      wants('SALE') ? this.prisma.invoice.findMany({
        where: { ...scope, deletedAt: null, issueDate: dates },
        include: {
          party: { select: { id: true, name: true, phone: true, email: true } },
          createdBy: user,
          relatedDocuments: { where: { type: 'CREDIT_NOTE', ...LIVE_NOTE }, select: { grandTotal: true } },
          payments: { orderBy: { paidAt: 'desc' }, take: 1, select: { method: true } },
        },
        take: MAX_ROWS,
      }) : [],
      wants('PAYMENT_IN') ? this.prisma.paymentRecord.findMany({
        where: { paidAt: dates, invoice: { ...scope, deletedAt: null, status: { not: 'DRAFT' } } },
        include: { invoice: { select: { id: true, invoiceNumber: true, warehouseId: true, party: { select: { name: true } }, createdBy: user } } },
        take: MAX_ROWS,
      }) : [],
      documentTypes.length ? this.prisma.businessDocument.findMany({
        where: { ...scope, deletedAt: null, issueDate: dates, type: { in: documentTypes as Prisma.EnumDocumentTypeFilter['in'] } },
        include: {
          party: { select: { id: true, name: true, phone: true, email: true } },
          supplier: { select: { id: true, name: true, phone: true, email: true } },
          createdBy: user,
          convertedDocuments: { where: { type: 'DEBIT_NOTE', ...LIVE_NOTE }, select: { grandTotal: true } },
          payments: { where: { voidedAt: null }, orderBy: { paidAt: 'desc' }, take: 1, select: { method: true } },
        },
        take: MAX_ROWS,
      }) : [],
      wants('PAYMENT_OUT') ? this.prisma.paymentOutReceipt.findMany({
        where: { ...scope, paidAt: dates },
        include: { supplier: { select: { name: true } }, payments: { take: 1, select: { method: true } } },
        take: MAX_ROWS,
      }) : [],
      wants('PURCHASE_ORDER') ? this.prisma.purchaseOrder.findMany({
        where: { ...scope, orderDate: dates },
        include: { supplier: { select: { name: true } } },
        take: MAX_ROWS,
      }) : [],
      wants('EXPENSE') ? this.prisma.expense.findMany({ where: { ...scope, expenseDate: dates }, take: MAX_ROWS }) : [],
      when(entryKinds.length, () => this.prisma.financeEntry.findMany({ where: { ...scope, entryDate: dates, kind: { in: entryKinds } }, take: MAX_ROWS })),
    ]);

    // Names for the people and loans the rows above only hold ids for.
    const userIds = [...new Set([...paymentsOut, ...orders, ...expenses, ...entries].map((row) => row.createdById))];
    const loanIds = [...new Set(entries.filter((e) => e.kind.startsWith('LOAN') && e.referenceId).map((e) => e.referenceId!))];
    const [users, loans] = await Promise.all([
      when(userIds.length, () => this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })),
      when(loanIds.length, () => this.prisma.loanAccount.findMany({ where: { id: { in: loanIds } }, select: { id: true, name: true } })),
    ]);
    const userName = (id: string) => users.find((u) => u.id === id)?.name ?? null;

    const rows: TransactionReportRow[] = [
      ...invoices.map(({ relatedDocuments, payments, ...invoice }) => {
        const creditTotal = sumMoney(relatedDocuments.map((note) => Number(note.grandTotal)));
        const live = invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED';
        const balance = live ? Math.max(0, subtractMoney(subtractMoney(Number(invoice.grandTotal), creditTotal), Number(invoice.amountPaid))) : 0;
        return {
          id: invoice.id, kind: 'SALE' as const, type: 'Sale', date: invoice.issueDate, number: invoice.invoiceNumber, partyName: invoice.party.name, category: '',
          total: Number(invoice.grandTotal), paid: Number(invoice.amountPaid), balance, dueDate: invoice.dueDate, status: invoice.status,
          paymentType: paidBy([payments[0]?.method]), warehouseId: invoice.warehouseId ?? null, createdById: invoice.createdBy.id, createdByName: invoice.createdBy.name,
          href: `/invoices/${invoice.id}`, record: { ...invoice, creditTotal, balanceDue: balance },
        };
      }),
      ...receipts.map((payment) => ({
        id: payment.id, kind: 'PAYMENT_IN' as const, type: 'Payment-In', date: payment.paidAt, number: payment.reference ?? '', partyName: payment.invoice.party.name, category: '',
        total: Number(payment.amount), paid: Number(payment.amount), balance: 0, dueDate: null, status: 'RECEIVED',
        paymentType: payment.method, warehouseId: payment.invoice.warehouseId ?? null, createdById: payment.invoice.createdBy.id, createdByName: payment.invoice.createdBy.name,
        href: `/invoices/${payment.invoice.id}`,
      })),
      ...documents.map(({ convertedDocuments, payments, ...document }) => {
        const meta = DOCUMENT_KINDS[document.type];
        const purchase = document.type === 'PURCHASE_INVOICE';
        const debitTotal = sumMoney(convertedDocuments.map((note) => Number(note.grandTotal)));
        const live = ['ISSUED', 'ACCEPTED', 'CONVERTED'].includes(document.status);
        const balance = purchase && live ? Math.max(0, subtractMoney(subtractMoney(Number(document.grandTotal), debitTotal), Number(document.paidAmount))) : 0;
        return {
          id: document.id, kind: meta.kind, type: meta.type, date: document.issueDate, number: document.referenceNumber || document.documentNumber,
          partyName: document.supplier?.name ?? document.party?.name ?? '', category: '',
          total: Number(document.grandTotal), paid: Number(document.paidAmount), balance, dueDate: document.dueDate ?? document.validUntil ?? null, status: document.status,
          paymentType: purchase ? paidBy([payments[0]?.method, document.paymentMethod]) : '', warehouseId: document.warehouseId ?? null,
          createdById: document.createdBy.id, createdByName: document.createdBy.name, href: `${meta.href}${document.id}`,
          record: { ...document, debitTotal, balanceDue: balance },
        };
      }),
      ...paymentsOut.map((receipt) => ({
        id: receipt.id, kind: 'PAYMENT_OUT' as const, type: 'Payment-Out', date: receipt.paidAt, number: receipt.receiptNumber, partyName: receipt.supplier?.name ?? '', category: '',
        total: sumMoney([Number(receipt.paid), Number(receipt.discount)]), paid: Number(receipt.paid), balance: 0, dueDate: null, status: receipt.voidedAt ? 'VOIDED' : 'PAID',
        paymentType: paidBy([receipt.payments[0]?.method], 'cash'), warehouseId: null, createdById: receipt.createdById, createdByName: userName(receipt.createdById),
        href: '/purchases/payment-out',
      })),
      ...orders.map((order) => ({
        id: order.id, kind: 'PURCHASE_ORDER' as const, type: 'Purchase Order', date: order.orderDate, number: order.orderNumber, partyName: order.supplier?.name ?? '', category: '',
        total: Number(order.grandTotal), paid: 0, balance: 0, dueDate: order.expectedDeliveryDate ?? null, status: order.status,
        paymentType: '', warehouseId: order.warehouseId ?? null, createdById: order.createdById, createdByName: userName(order.createdById),
        href: `/purchases/orders/${order.id}`,
      })),
      ...expenses.map((expense) => ({
        id: expense.id, kind: 'EXPENSE' as const, type: 'Expense', date: expense.expenseDate, number: expense.reference ?? '', partyName: expense.description, category: expense.category,
        total: Number(expense.total), paid: expense.status === 'CANCELLED' ? 0 : Number(expense.total), balance: 0, dueDate: null, status: expense.status,
        paymentType: expense.method, warehouseId: null, createdById: expense.createdById, createdByName: userName(expense.createdById),
        href: '/purchases/expenses',
      })),
      ...entries.map((entry) => {
        const meta = ENTRY_KINDS[entry.kind];
        const amount = Math.abs(Number(entry.amount));
        const loanName = entry.referenceId ? loans.find((loan) => loan.id === entry.referenceId)?.name : undefined;
        return {
          id: entry.id, kind: meta.kind, type: entry.kind === 'CASH_ADJUSTMENT' ? (Number(entry.amount) < 0 ? 'Reduce Cash' : 'Add Cash') : meta.type,
          date: entry.entryDate, number: '', partyName: loanName ?? (entry.kind === 'LOAN_OPENING' ? entry.name : entry.notes ?? ''),
          category: entry.kind === 'LOAN_PAYMENT' ? 'Loan EMI' : entry.kind === 'CASH_ADJUSTMENT' && entry.name !== 'Cash adjustment' ? entry.name : entry.kind === 'OTHER_INCOME' ? entry.name : '',
          total: amount, paid: amount, balance: 0, dueDate: null, status: 'PAID',
          paymentType: entry.accountId ? 'bank_transfer' : 'cash', warehouseId: null, createdById: entry.createdById, createdByName: userName(entry.createdById),
          href: meta.href,
        };
      }),
    ];
    return rows.sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id));
  }
}
