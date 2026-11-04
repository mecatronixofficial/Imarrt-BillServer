import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinanceService } from '../accounting/finance.service.js';
import { sumMoney, subtractMoney } from '../common/utils/billing.util.js';

const LIVE_INVOICE = { deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] as Array<'DRAFT' | 'CANCELLED'> } };
const LIVE_BILL = { deletedAt: null, type: 'PURCHASE_INVOICE' as const, status: { in: ['ISSUED', 'ACCEPTED', 'CONVERTED'] as Array<'ISSUED' | 'ACCEPTED' | 'CONVERTED'> } };
const LIVE_NOTE = { deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] as Array<'DRAFT' | 'CANCELLED' | 'REJECTED'> } };

/** Figures for one sub company: period totals, plus what is owed and held right now. */
export type CompanyFigures = {
  sales: number; salesCount: number; salesReturns: number; received: number; receivable: number;
  purchases: number; purchasesCount: number; purchaseReturns: number; paid: number; payable: number;
  expenses: number; otherIncome: number; profit: number; cash: number; bank: number;
};
const FIGURES: Array<keyof CompanyFigures> = ['sales', 'salesCount', 'salesReturns', 'received', 'receivable', 'purchases', 'purchasesCount', 'purchaseReturns', 'paid', 'payable', 'expenses', 'otherIncome', 'profit', 'cash', 'bank'];

/** Inclusive YYYY-MM-DD bounds; dates are stored as UTC midnight. */
function range(from: string, to: string) {
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: new Date(`${from}T00:00:00.000Z`), lt: end };
}

/** The main company's view: its sub companies' figures side by side and added up. */
@Injectable()
export class GroupSummaryService {
  constructor(private readonly prisma: PrismaService, private readonly finance: FinanceService) {}

  async summary(id: string, from: string, to: string, actor: { id: string; role: Role }) {
    if (from > to) throw new BadRequestException('From date must be on or before the To date');
    const group = await this.prisma.workspaceBranch.findFirst({
      where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { createdById: actor.id }) },
      include: { businesses: { where: { isActive: true }, select: { id: true, name: true, gstin: true, gstRegistered: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!group) throw new NotFoundException('Main company not found');
    const companies = await Promise.all(group.businesses.map(async (company) => ({ ...company, ...(await this.figures(company.id, from, to)) })));
    const totals = Object.fromEntries(FIGURES.map((key) => [key, sumMoney(companies.map((company) => company[key]))])) as CompanyFigures;
    return { id: group.id, name: group.name, code: group.code, from, to, companies, totals };
  }

  private async figures(businessId: string, from: string, to: string): Promise<CompanyFigures> {
    const dates = range(from, to);
    const [sales, salesReturns, received, openInvoices, purchases, purchaseReturns, paid, openBills, expenses, otherIncome, money] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { businessId, ...LIVE_INVOICE, issueDate: dates }, _sum: { grandTotal: true }, _count: true }),
      this.prisma.businessDocument.aggregate({ where: { businessId, ...LIVE_NOTE, type: 'CREDIT_NOTE', issueDate: dates }, _sum: { grandTotal: true } }),
      this.prisma.paymentRecord.aggregate({ where: { paidAt: dates, invoice: { businessId, ...LIVE_INVOICE } }, _sum: { amount: true } }),
      this.prisma.invoice.findMany({ where: { businessId, ...LIVE_INVOICE, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } }, select: { grandTotal: true, amountPaid: true, relatedDocuments: { where: { type: 'CREDIT_NOTE', ...LIVE_NOTE }, select: { grandTotal: true } } } }),
      this.prisma.businessDocument.aggregate({ where: { businessId, ...LIVE_BILL, issueDate: dates }, _sum: { grandTotal: true }, _count: true }),
      this.prisma.businessDocument.aggregate({ where: { businessId, ...LIVE_NOTE, type: 'DEBIT_NOTE', issueDate: dates }, _sum: { grandTotal: true } }),
      this.prisma.purchasePayment.aggregate({ where: { paidAt: dates, voidedAt: null, document: { businessId, ...LIVE_BILL } }, _sum: { amount: true } }),
      this.prisma.businessDocument.findMany({ where: { businessId, ...LIVE_BILL }, select: { grandTotal: true, paidAmount: true, convertedDocuments: { where: { type: 'DEBIT_NOTE', ...LIVE_NOTE }, select: { grandTotal: true } } } }),
      this.prisma.expense.aggregate({ where: { businessId, status: 'ISSUED', expenseDate: dates }, _sum: { total: true } }),
      this.prisma.financeEntry.aggregate({ where: { businessId, kind: 'OTHER_INCOME', entryDate: dates }, _sum: { amount: true } }),
      this.finance.cashAndBank(businessId),
    ]);
    // What is still owed today, net of returns, whatever the period.
    const outstanding = (rows: Array<{ grandTotal: unknown; paid: unknown; notes: Array<{ grandTotal: unknown }> }>) =>
      sumMoney(rows.map((row) => Math.max(0, subtractMoney(subtractMoney(Number(row.grandTotal), sumMoney(row.notes.map((note) => Number(note.grandTotal)))), Number(row.paid)))));
    const figures = {
      sales: Number(sales._sum.grandTotal ?? 0),
      salesCount: sales._count,
      salesReturns: Number(salesReturns._sum.grandTotal ?? 0),
      received: Number(received._sum.amount ?? 0),
      receivable: outstanding(openInvoices.map((row) => ({ grandTotal: row.grandTotal, paid: row.amountPaid, notes: row.relatedDocuments }))),
      purchases: Number(purchases._sum.grandTotal ?? 0),
      purchasesCount: purchases._count,
      purchaseReturns: Number(purchaseReturns._sum.grandTotal ?? 0),
      paid: Number(paid._sum.amount ?? 0),
      payable: outstanding(openBills.map((row) => ({ grandTotal: row.grandTotal, paid: row.paidAmount, notes: row.convertedDocuments }))),
      expenses: Number(expenses._sum.total ?? 0),
      otherIncome: Number(otherIncome._sum.amount ?? 0),
      cash: money.cash,
      bank: money.bank,
    };
    // Purchase-basis estimate, the same as the Reports overview: net sales and income less net purchases and expenses.
    const profit = sumMoney([figures.sales, -figures.salesReturns, figures.otherIncome, -figures.purchases, figures.purchaseReturns, -figures.expenses]);
    return { ...figures, profit };
  }
}
