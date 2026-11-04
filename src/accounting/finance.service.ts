import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { billingTransaction, lockBillingRecord } from '../common/utils/billing-transaction.util.js';
import { sumMoney, subtractMoney } from '../common/utils/billing.util.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CashAdjustmentDto, ChequeActionDto, ConvertToLoanPaymentDto, IncomeCategoryDto, IncomeDto, LoanDto, LoanPaymentDto, TransferDto, UpdateFinanceEntryDto } from './finance.dto.js';

/** Entries owned by the bank and cash screens. Loan entries belong to their loan account and change only there. */
const EDITABLE_ENTRIES = ['TRANSFER_IN', 'TRANSFER_OUT', 'OTHER_INCOME', 'CASH_ADJUSTMENT'];
/** Stored as a cash adjustment's name when no type was typed in. */
const DEFAULT_ADJUSTMENT = 'Cash adjustment';
const rupees = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

/** How an entry reads in a ledger. Money between cash and a bank is a deposit or a withdrawal. */
function entryLabel(kind: string, amount: number, cash: boolean, name: string) {
  switch (kind) {
    case 'LOAN_PAYMENT': return 'EMI Paid';
    case 'LOAN_OPENING': return 'Loan Received';
    case 'OTHER_INCOME': return 'Other Income';
    // A cash adjustment shows the type the user typed in, if any.
    case 'CASH_ADJUSTMENT': return name && name !== DEFAULT_ADJUSTMENT ? name : amount < 0 ? 'Reduce Cash' : 'Add Cash';
    case 'TRANSFER_OUT': return cash ? 'Bank Deposit' : 'Withdrawal';
    case 'TRANSFER_IN': return cash ? 'Cash Withdrawal' : 'Deposit';
    default: return kind.replaceAll('_', ' ');
  }
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  private scope(businessId: string, branchId?: string) { return { businessId, ...(branchId ? { branchId } : {}) }; }
  private async account(tx: Prisma.TransactionClient, id: string | undefined, businessId: string, branchId: string) {
    if (id && !await tx.cashAccount.findFirst({ where: { id, businessId, branchId, deletedAt: null } })) throw new BadRequestException('Select an account in this company and branch');
  }
  async loans(businessId: string, branchId: string | undefined, page: PaginationQueryDto) {
    const loans = await this.prisma.loanAccount.findMany({ where: this.scope(businessId, branchId), include: { payments: { orderBy: { paidAt: 'desc' } } }, orderBy: { name: 'asc' }, take: page.limit, skip: page.offset });
    return loans.map(loan => ({ ...loan, balance: subtractMoney(Number(loan.principal), sumMoney(loan.payments.map(p => Number(p.principal)))) }));
  }
  async createLoan(dto: LoanDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const previous = await tx.loanAccount.findFirst({ where: { businessId, branchId, requestId: dto.requestId } });
      if (previous) return previous;
      await this.account(tx, dto.accountId, businessId, branchId);
      const loan = await tx.loanAccount.create({ data: { businessId, branchId, name: dto.name.trim(), principal: dto.principal, openingDate: new Date(dto.openingDate), notes: dto.notes, requestId: dto.requestId, createdById: userId } });
      // An opening loan is a balance brought forward. An explicit account records a new disbursement.
      if (dto.accountId) await tx.financeEntry.create({ data: { businessId, branchId, accountId: dto.accountId, kind: 'LOAN_OPENING', name: loan.name, amount: dto.principal, entryDate: new Date(dto.openingDate), referenceId: loan.id, requestId: dto.requestId, createdById: userId } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'LOAN_CREATED', entityType: 'LoanAccount', entityId: loan.id } });
      return loan;
    });
  }
  async payLoan(id: string, dto: LoanPaymentDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      return this.postLoanPayment(tx, id, dto, userId, businessId, branchId);
    });
  }
  /** One loan receipt and one cash/bank movement, shared by both entry screens. */
  private async postLoanPayment(tx: Prisma.TransactionClient, id: string, dto: LoanPaymentDto, userId: string, businessId: string, branchId: string) {
    const total = sumMoney([dto.principal, dto.interest]);
    if (dto.principal < 0 || dto.interest < 0) throw new BadRequestException('Principal and interest cannot be negative');
    if (total <= 0) throw new BadRequestException('Enter principal or interest to pay');
    if (total > 9999999999.99) throw new BadRequestException('Payment exceeds the supported amount');
    const loan = await tx.loanAccount.findFirst({ where: { id, businessId, branchId }, include: { payments: true } });
    if (!loan) throw new NotFoundException('Loan account not found');
    const previous = loan.payments.find(p => p.requestId === dto.requestId);
    if (previous) {
      if (Number(previous.principal) !== dto.principal || Number(previous.interest) !== dto.interest || previous.paidAt && previous.paidAt.getTime() !== new Date(dto.paidAt).getTime()) throw new BadRequestException('This payment request was already saved. Refresh before entering another payment');
      return previous;
    }
    const posted = await tx.financeEntry.findFirst({ where: { businessId, branchId, requestId: dto.requestId } });
    if (posted) throw new BadRequestException('This request was already recorded. Refresh the balances or link the existing cash entry to the loan');
    if (new Date(dto.paidAt) < loan.openingDate) throw new BadRequestException('Payment cannot precede the opening loan date');
    const balance = subtractMoney(Number(loan.principal), sumMoney(loan.payments.map(p => Number(p.principal))));
    if (dto.principal > balance) throw new BadRequestException('Principal repayment exceeds the loan balance');
    await this.account(tx, dto.accountId, businessId, branchId);
    if (!dto.accountId) await this.ensureCash(tx, businessId, branchId, -total);
    const payment = await tx.loanPayment.create({ data: { loanId: id, principal: dto.principal, interest: dto.interest, total, paidAt: new Date(dto.paidAt), requestId: dto.requestId, createdById: userId } });
    await tx.financeEntry.create({ data: { businessId, branchId, accountId: dto.accountId, kind: 'LOAN_PAYMENT', name: loan.name, amount: -total, entryDate: new Date(dto.paidAt), referenceId: id, notes: dto.notes, requestId: dto.requestId, createdById: userId } });
    await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'LOAN_PAYMENT', entityType: 'LoanPayment', entityId: payment.id } });
    return payment;
  }
  async categories(businessId: string, branchId: string | undefined, page: PaginationQueryDto) {
    const categories = await this.prisma.incomeCategory.findMany({ where: this.scope(businessId, branchId), orderBy: { name: 'asc' }, take: page.limit, skip: page.offset });
    const totals = await this.prisma.financeEntry.groupBy({ by: ['referenceId'], where: { ...this.scope(businessId, branchId), kind: 'OTHER_INCOME' }, _sum: { amount: true } });
    return categories.map(c => ({ ...c, total: Number(totals.find(t => t.referenceId === c.id)?._sum.amount ?? 0) }));
  }
  async createCategory(dto: IncomeCategoryDto, userId: string, businessId: string, branchId: string) {
    const category = await this.prisma.incomeCategory.upsert({ where: { branchId_name: { branchId, name: dto.name.trim() } }, create: { businessId, branchId, name: dto.name.trim() }, update: {} });
    await this.audit.log({ businessId, branchId, userId, action: 'INCOME_CATEGORY_CREATED', entityType: 'IncomeCategory', entityId: category.id });
    return category;
  }
  incomes(businessId: string, branchId: string | undefined, page: PaginationQueryDto) {
    return this.prisma.financeEntry.findMany({ where: { ...this.scope(businessId, branchId), kind: 'OTHER_INCOME' }, orderBy: [{ entryDate: 'desc' }, { id: 'desc' }], take: page.limit, skip: page.offset });
  }
  async income(dto: IncomeDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const previous = await tx.financeEntry.findFirst({ where: { businessId, branchId, requestId: dto.requestId, kind: 'OTHER_INCOME' } });
      if (previous) return previous;
      const category = await tx.incomeCategory.findFirst({ where: { id: dto.categoryId, businessId, branchId } });
      if (!category) throw new BadRequestException('Select an income category in this branch');
      await this.account(tx, dto.accountId, businessId, branchId);
      const entry = await tx.financeEntry.create({ data: { businessId, branchId, accountId: dto.accountId, name: category.name, kind: 'OTHER_INCOME', referenceId: category.id, amount: dto.amount, entryDate: new Date(dto.date), notes: dto.notes, requestId: dto.requestId, createdById: userId } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'OTHER_INCOME_CREATED', entityType: 'FinanceEntry', entityId: entry.id } });
      return entry;
    });
  }
  async adjustCash(dto: CashAdjustmentDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const previous = await tx.financeEntry.findFirst({ where: { businessId, branchId, requestId: dto.requestId } });
      if (previous) {
        const expectedKind = dto.loanId ? 'LOAN_PAYMENT' : 'CASH_ADJUSTMENT';
        const expectedAmount = dto.direction === 'IN' ? dto.amount : -dto.amount;
        if (previous.kind !== expectedKind || Number(previous.amount) !== expectedAmount || (dto.loanId && previous.referenceId !== dto.loanId)) throw new BadRequestException('This request was already saved. Refresh the balances before entering another payment');
        if (dto.loanId) {
          const payment = await tx.loanPayment.findFirst({ where: { loanId: dto.loanId, requestId: dto.requestId } });
          if (!payment || Number(payment.interest) !== (dto.interest ?? 0)) throw new BadRequestException('This payment request was already saved with a different interest amount');
        }
        return previous;
      }
      if (dto.loanId) {
        if (dto.direction !== 'OUT') throw new BadRequestException('Select Reduce Cash to record a loan repayment');
        const interest = dto.interest ?? 0;
        if (interest < 0 || interest > dto.amount) throw new BadRequestException('Interest must be between zero and the total amount paid');
        return this.postLoanPayment(tx, dto.loanId, { principal: subtractMoney(dto.amount, interest), interest, paidAt: dto.date, requestId: dto.requestId, notes: dto.reason?.trim() || undefined }, userId, businessId, branchId);
      }
      if (dto.interest) throw new BadRequestException('Select a loan account before entering interest');
      const amount = dto.direction === 'IN' ? dto.amount : -dto.amount;
      await this.ensureCash(tx, businessId, branchId, amount);
      const entry = await tx.financeEntry.create({ data: { businessId, branchId, kind: 'CASH_ADJUSTMENT', name: dto.type?.trim() || DEFAULT_ADJUSTMENT, notes: dto.reason?.trim() || null, amount, entryDate: new Date(dto.date), requestId: dto.requestId, createdById: userId } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'CASH_ADJUSTED', entityType: 'FinanceEntry', entityId: entry.id } });
      return entry;
    });
  }
  async transfer(dto: TransferDto, userId: string, businessId: string, branchId: string) {
    if ((dto.fromAccountId ?? '') === (dto.toAccountId ?? '')) throw new BadRequestException('Choose different source and destination accounts');
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const previous = await tx.financeEntry.findFirst({ where: { businessId, branchId, requestId: dto.requestId, kind: 'TRANSFER_OUT' } });
      if (previous) return previous;
      await this.account(tx, dto.fromAccountId, businessId, branchId);
      await this.account(tx, dto.toAccountId, businessId, branchId);
      if (!dto.fromAccountId) await this.ensureCash(tx, businessId, branchId, -dto.amount);
      const common ={ businessId, branchId, entryDate: new Date(dto.date), requestId: dto.requestId, notes: dto.notes, createdById: userId };
      const out = await tx.financeEntry.create({ data: { ...common, accountId: dto.fromAccountId, kind: 'TRANSFER_OUT', name: 'Transfer out', amount: -dto.amount } });
      await tx.financeEntry.create({ data: { ...common, accountId: dto.toAccountId, kind: 'TRANSFER_IN', name: 'Transfer in', amount: dto.amount, referenceId: out.id } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'ACCOUNT_TRANSFER', entityType: 'FinanceEntry', entityId: out.id } });
      return out;
    });
  }
  async transactions(accountId: string | null, businessId: string, branchId: string | undefined, page: PaginationQueryDto) {
    const scope = this.scope(businessId, branchId);
    const account = accountId ? await this.prisma.cashAccount.findFirst({ where: { id: accountId, ...scope, deletedAt: null } }) : null;
    if (accountId && !account) throw new NotFoundException('Account not found');
    const filter = { accountId, ...(!accountId ? { method: 'cash' } : {}) };
    const take = page.offset + page.limit;
    const activeInvoice: Prisma.InvoiceWhereInput = { ...scope, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } };
    const activeDocument: Prisma.BusinessDocumentWhereInput = { ...scope, deletedAt: null, status: { in: ['ISSUED', 'ACCEPTED', 'CONVERTED'] } };
    const [receipts, payments, expenses, entries, balance] = await Promise.all([
      this.prisma.paymentRecord.findMany({ where: { ...filter, invoice: activeInvoice }, include: { invoice: { select: { invoiceNumber: true, party: { select: { name: true } } } } }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take }),
      this.prisma.purchasePayment.findMany({ where: { ...filter, voidedAt: null, document: activeDocument }, include: { document: { select: { documentNumber: true, supplier: { select: { name: true } } } } }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take }),
      this.prisma.expense.findMany({ where: { ...scope, ...filter, status: 'ISSUED' }, orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take }),
      this.prisma.financeEntry.findMany({ where: { ...scope, accountId }, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take }),
      this.ledgerBalance(this.prisma, accountId, scope, Number(account?.openingBalance ?? 0)),
    ]);
    const rows = [
      ...receipts.map(r => ({ id: r.id, source: 'PAYMENT_IN', type: 'Payment-In', name: r.invoice.party.name, date: r.paidAt, createdAt: r.createdAt, amount: Number(r.amount), reference: r.reference, method: r.method, sourceId: r.invoiceId, number: r.invoice.invoiceNumber })),
      ...payments.map(r => ({ id: r.id, source: 'PAYMENT_OUT', type: 'Payment-Out', name: r.document.supplier?.name ?? '', date: r.paidAt, createdAt: r.createdAt, amount: -Number(r.amount), reference: r.reference, notes: r.notes, method: r.method, sourceId: r.documentId, receiptId: r.receiptId, number: r.document.documentNumber })),
      ...expenses.map(r => ({ id: r.id, source: 'EXPENSE', type: 'Expense', name: r.description, date: r.expenseDate, createdAt: r.createdAt, amount: -Number(r.total), reference: r.reference, notes: r.notes, method: r.method, category: r.category })),
      ...entries.map(r => ({ id: r.id, source: 'ENTRY', kind: r.kind, type: entryLabel(r.kind, Number(r.amount), !accountId, r.name), name: r.kind === 'CASH_ADJUSTMENT' ? r.notes ?? '' : r.name, date: r.entryDate, createdAt: r.createdAt, amount: Number(r.amount), reference: r.notes, notes: r.notes, sourceId: r.referenceId, editable: EDITABLE_ENTRIES.includes(r.kind) })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(page.offset, take);
    return { rows, balance };
  }
  /** A company's cash in hand and total bank balance across all its branches, as the Cash and Bank screens count them. */
  async cashAndBank(businessId: string) {
    const scope = { businessId };
    const accounts = await this.prisma.cashAccount.findMany({ where: { businessId, deletedAt: null }, select: { id: true, openingBalance: true } });
    const [cash, ...banks] = await Promise.all([
      this.ledgerBalance(this.prisma, null, scope),
      ...accounts.map(account => this.ledgerBalance(this.prisma, account.id, scope, Number(account.openingBalance))),
    ]);
    return { cash, bank: sumMoney(banks) };
  }
  /** An account's balance, or cash in hand when accountId is null: what came in less what went out. */
  private async ledgerBalance(client: Prisma.TransactionClient, accountId: string | null, scope: { businessId: string; branchId?: string }, openingBalance = 0) {
    const filter = { accountId, ...(!accountId ? { method: 'cash' } : {}) };
    const [received, paid, expenses, entries] = await Promise.all([
      client.paymentRecord.aggregate({ where: { ...filter, invoice: { ...scope, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } } }, _sum: { amount: true } }),
      client.purchasePayment.aggregate({ where: { ...filter, voidedAt: null, document: { ...scope, deletedAt: null, status: { in: ['ISSUED', 'ACCEPTED', 'CONVERTED'] } } }, _sum: { amount: true } }),
      client.expense.aggregate({ where: { ...scope, ...filter, status: 'ISSUED' }, _sum: { total: true } }),
      client.financeEntry.aggregate({ where: { ...scope, accountId }, _sum: { amount: true } }),
    ]);
    return sumMoney([openingBalance, Number(received._sum.amount ?? 0), -Number(paid._sum.amount ?? 0), -Number(expenses._sum.total ?? 0), Number(entries._sum.amount ?? 0)]);
  }
  /** Cash in hand cannot go below zero: you cannot take out more cash than you hold. */
  private async ensureCash(tx: Prisma.TransactionClient, businessId: string, branchId: string, change: number) {
    if (change >= 0) return;
    const cash = await this.ledgerBalance(tx, null, { businessId, branchId });
    if (sumMoney([cash, change]) < 0) throw new BadRequestException(`Cash in hand is ${rupees(cash)}, so ${rupees(-change)} cannot be taken out of it.`);
  }
  /** The entry plus, for a deposit/withdrawal, its other leg, so both accounts stay in step. */
  private async entryGroup(tx: Prisma.TransactionClient, id: string, businessId: string, branchId: string) {
    const entry = await tx.financeEntry.findFirst({ where: { id, businessId, branchId } });
    if (!entry) throw new NotFoundException('Transaction not found');
    if (!EDITABLE_ENTRIES.includes(entry.kind)) throw new BadRequestException(entry.kind.startsWith('LOAN') ? 'Loan transactions are changed from Loan Accounts' : 'This transaction cannot be changed here');
    if (!entry.kind.startsWith('TRANSFER')) return [entry];
    const pair = entry.kind === 'TRANSFER_OUT'
      ? await tx.financeEntry.findFirst({ where: { businessId, branchId, kind: 'TRANSFER_IN', referenceId: entry.id } })
      : entry.referenceId ? await tx.financeEntry.findFirst({ where: { id: entry.referenceId, businessId, branchId, kind: 'TRANSFER_OUT' } }) : null;
    return pair ? [entry, pair] : [entry];
  }
  async updateEntry(id: string, dto: UpdateFinanceEntryDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const group = await this.entryGroup(tx, id, businessId, branchId);
      const name = dto.name?.trim();
      // A cash adjustment may switch between adding and reducing cash; anything else keeps its direction.
      const next = (entry: (typeof group)[number]) => (entry.kind === 'CASH_ADJUSTMENT' && dto.direction ? dto.direction === 'OUT' : Number(entry.amount) < 0) ? -dto.amount : dto.amount;
      await this.ensureCash(tx, businessId, branchId, sumMoney(group.filter(e => !e.accountId).map(e => next(e) - Number(e.amount))));
      for (const entry of group) {
        await tx.financeEntry.update({ where: { id: entry.id }, data: {
          amount: next(entry),
          entryDate: new Date(dto.date),
          notes: dto.notes?.trim() || null,
          ...(entry.kind === 'CASH_ADJUSTMENT' ? { name: name || DEFAULT_ADJUSTMENT } : {}),
        } });
      }
      const before = group.map(e => ({ id: e.id, kind: e.kind, amount: Number(e.amount), entryDate: e.entryDate, notes: e.notes }));
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'FINANCE_ENTRY_UPDATED', entityType: 'FinanceEntry', entityId: id, metadata: JSON.stringify({ before, amount: dto.amount, date: dto.date }) } });
      return { id, updated: group.length };
    });
  }
  /** Deletes an EMI payment and its cash/bank entry together, so the loan balance goes back up. */
  async removeLoanPayment(loanId: string, paymentId: string, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const loan = await tx.loanAccount.findFirst({ where: { id: loanId, businessId, branchId } });
      const payment = loan && await tx.loanPayment.findFirst({ where: { id: paymentId, loanId } });
      if (!loan || !payment) throw new NotFoundException('Loan payment not found');
      return this.deleteLoanPayment(tx, loan, payment, userId, businessId, branchId);
    });
  }
  private async deleteLoanPayment(tx: Prisma.TransactionClient, loan: { id: string; name: string }, payment: { id: string; requestId: string; principal: Prisma.Decimal | number; interest: Prisma.Decimal | number; total: Prisma.Decimal | number; paidAt: Date }, userId: string, businessId: string, branchId: string) {
    const entries = await tx.financeEntry.findMany({ where: { businessId, branchId, kind: 'LOAN_PAYMENT', referenceId: loan.id, requestId: payment.requestId } });
    await tx.financeEntry.deleteMany({ where: { id: { in: entries.map(e => e.id) }, businessId, branchId } });
    await tx.loanPayment.delete({ where: { id: payment.id } });
    const removed = { loanId: loan.id, loanName: loan.name, principal: Number(payment.principal), interest: Number(payment.interest), total: Number(payment.total), paidAt: payment.paidAt, accountId: entries[0]?.accountId ?? null, notes: entries[0]?.notes ?? null };
    await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'LOAN_PAYMENT_DELETED', entityType: 'LoanPayment', entityId: payment.id, metadata: JSON.stringify(removed) } });
    return { id: payment.id, deleted: true };
  }
  /**
   * Turns a "Reduce Cash" adjustment into an EMI payment on a loan account. Cash in hand is unchanged;
   * the loan balance goes down by the principal.
   */
  async convertToLoanPayment(id: string, dto: ConvertToLoanPaymentDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const entry = await tx.financeEntry.findFirst({ where: { id, businessId, branchId } });
      if (!entry) throw new NotFoundException('Transaction not found');
      if (entry.kind !== 'CASH_ADJUSTMENT' || Number(entry.amount) >= 0 || entry.accountId) throw new BadRequestException('Only a "Reduce Cash" adjustment can become a loan payment');
      const loan = await tx.loanAccount.findFirst({ where: { id: dto.loanId, businessId, branchId }, include: { payments: true } });
      if (!loan) throw new BadRequestException('Select a loan account in this company and branch');
      const total = -Number(entry.amount);
      const interest = dto.interest ?? 0;
      if (interest > total) throw new BadRequestException('Interest cannot be more than the amount paid');
      const principal = subtractMoney(total, interest);
      const balance = subtractMoney(Number(loan.principal), sumMoney(loan.payments.map(p => Number(p.principal))));
      if (principal > balance) throw new BadRequestException(`Principal ${rupees(principal)} is more than the ${loan.name} loan balance of ${rupees(balance)}`);
      if (entry.entryDate < loan.openingDate) throw new BadRequestException('Payment cannot precede the opening loan date');
      const requestId = entry.requestId;
      const payment = await tx.loanPayment.create({ data: { loanId: loan.id, principal, interest, total, paidAt: entry.entryDate, requestId, createdById: userId } });
      await tx.financeEntry.create({ data: { businessId, branchId, accountId: null, kind: 'LOAN_PAYMENT', name: loan.name, amount: -total, entryDate: entry.entryDate, referenceId: loan.id, notes: entry.notes, requestId, createdById: userId } });
      await tx.financeEntry.delete({ where: { id: entry.id } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'CASH_ADJUSTMENT_TO_LOAN_PAYMENT', entityType: 'LoanPayment', entityId: payment.id, metadata: JSON.stringify({ adjustment: { id: entry.id, name: entry.name, amount: Number(entry.amount), entryDate: entry.entryDate, notes: entry.notes }, loanId: loan.id, principal, interest }) } });
      return payment;
    });
  }
  async removeEntry(id: string, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      // An EMI shown in cash or a bank is removed with its loan payment.
      const loanEntry = await tx.financeEntry.findFirst({ where: { id, businessId, branchId, kind: 'LOAN_PAYMENT' } });
      if (loanEntry) {
        const loan = loanEntry.referenceId ? await tx.loanAccount.findFirst({ where: { id: loanEntry.referenceId, businessId, branchId } }) : null;
        const payment = loan && await tx.loanPayment.findFirst({ where: { loanId: loan.id, requestId: loanEntry.requestId } });
        if (!loan || !payment) throw new BadRequestException('This EMI is not linked to a loan payment');
        return this.deleteLoanPayment(tx, loan, payment, userId, businessId, branchId);
      }
      const group = await this.entryGroup(tx, id, businessId, branchId);
      await this.ensureCash(tx, businessId, branchId, -sumMoney(group.filter(e => !e.accountId).map(e => Number(e.amount))));
      await tx.financeEntry.deleteMany({ where: { id: { in: group.map(e => e.id) }, businessId, branchId } });
      // The audit row keeps a full copy, so a deleted entry can be re-posted if needed.
      const removed = group.map(e => ({ id: e.id, kind: e.kind, accountId: e.accountId, name: e.name, amount: Number(e.amount), entryDate: e.entryDate, referenceId: e.referenceId, notes: e.notes }));
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'FINANCE_ENTRY_DELETED', entityType: 'FinanceEntry', entityId: id, metadata: JSON.stringify({ removed }) } });
      return { id, deleted: group.length };
    });
  }
  async cheques(businessId: string, branchId: string | undefined, page: PaginationQueryDto) {
    const records = await this.prisma.paymentRecord.findMany({ where: { method: 'cheque', invoice: { ...this.scope(businessId, branchId), deletedAt: null } }, include: { invoice: { select: { invoiceNumber: true, status: true, party: { select: { name: true } } } }, account: { select: { bankName: true } } }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], take: page.limit, skip: page.offset });
    const events = await this.prisma.chequeEvent.findMany({ where: { ...this.scope(businessId, branchId), paymentId: { in: records.map(r => r.id) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return records.map(r => ({ id: r.id, name: r.invoice.party.name, reference: r.reference, date: r.paidAt, amount: r.amount, accountId: r.accountId, bankName: r.account?.bankName, invoiceId: r.invoiceId, invoiceNumber: r.invoice.invoiceNumber, invoiceStatus: r.invoice.status, history: events.filter(e => e.paymentId === r.id) }));
  }
  async cheque(id: string, dto: ChequeActionDto, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async tx => {
      await lockBillingRecord(tx, 'branch', branchId);
      const previous = await tx.chequeEvent.findFirst({ where: { paymentId: id, businessId, branchId, requestId: dto.requestId } });
      if (previous) return previous;
      const record = await tx.paymentRecord.findFirst({ where: { id, method: 'cheque', invoice: { businessId, branchId, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } } } });
      if (!record) throw new NotFoundException('Cheque not found');
      if (dto.action === 'DEPOSIT' && !dto.accountId) throw new BadRequestException('Select a bank account for deposit');
      await this.account(tx, dto.accountId, businessId, branchId);
      if (dto.action === 'DEPOSIT' && record.accountId) throw new BadRequestException('Re-open the cheque before depositing it into another account');
      if (dto.action === 'REOPEN' && !record.accountId) throw new BadRequestException('This cheque is already open');
      await tx.paymentRecord.update({ where: { id }, data: { accountId: dto.action === 'DEPOSIT' ? dto.accountId : null } });
      const event = await tx.chequeEvent.create({ data: { businessId, branchId, paymentId: id, action: dto.action, accountId: dto.action === 'DEPOSIT' ? dto.accountId : record.accountId, requestId: dto.requestId, createdById: userId } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'CHEQUE_' + dto.action, entityType: 'PaymentRecord', entityId: id } });
      return event;
    });
  }
}
