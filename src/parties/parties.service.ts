import { sumMoney, subtractMoney } from '../common/utils/billing.util.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PartyBalanceType, PartyGstType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePartyDto } from './dto/create-party.dto.js';
import { UpdatePartyDto } from './dto/update-party.dto.js';
import { encryptField, decryptField } from '../common/utils/encryption.util.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { getLogicalBranchIds } from '../common/utils/workspace-scope.util.js';

@Injectable()
export class PartiesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private redact(party: any) {
    if (!party) return party;
    return {
      ...party,
      gstin: party.gstin ? decryptField(party.gstin) : null,
    };
  }

  async nextPartyCode(businessId: string) {
    return { code: await this.generatePartyCode(this.prisma, businessId) };
  }

  /** Next free "P-0001" code. Codes are unique per business and parties can be deleted, so use the highest number, not a count. */
  private async generatePartyCode(tx: PrismaService | Prisma.TransactionClient, businessId: string) {
    const parties = await tx.party.findMany({ where: { businessId, code: { startsWith: 'P-' } }, select: { code: true } });
    const highest = parties.reduce((max, { code }) => {
      const number = Number(/^P-(\d+)$/.exec(code ?? '')?.[1]);
      return Number.isFinite(number) && number > max ? number : max;
    }, 0);
    return `P-${String(highest + 1).padStart(4, '0')}`;
  }

  async create(dto: CreatePartyDto, userId: string, businessId: string, branchId: string) {
    const gstType = dto.gstType ?? PartyGstType.UNREGISTERED;
    const party = await this.prisma.$transaction(async (tx) => {
      const code = dto.code?.trim() || await this.generatePartyCode(tx, businessId);
      return tx.party.create({
        data: {
          ...dto,
          code,
          businessId,
          branchId,
          gstType,
          gstin: usesGstin(gstType) && dto.gstin ? encryptField(dto.gstin.toUpperCase()) : undefined,
        },
      });
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const requested = dto.code?.trim();
        throw new ConflictException(requested ? `Party code ${requested} is already used by another party. Enter a different code.` : 'Could not assign a party code. Please try again.');
      }
      throw error;
    });
    await this.audit.log({
      businessId,
      userId,
      action: 'PARTY_CREATED',
      entityType: 'Party',
      entityId: party.id,
    });
    return this.redact(party);
  }

  async findAll(businessId: string, branchId: string, { limit, offset }: PaginationQueryDto) {
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const parties = await this.prisma.party.findMany({
      where: { branchId: { in: logicalBranchIds }, deletedAt: null },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    });
    const invoiceTotals = parties.length
      ? await this.prisma.invoice.groupBy({
          by: ['partyId'],
          where: {
            businessId,
            partyId: { in: parties.map(({ id }) => id) },
            deletedAt: null,
            status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] },
          },
          _sum: { grandTotal: true, amountPaid: true },
        })
      : [];
    const creditTotals = parties.length ? await this.prisma.businessDocument.groupBy({ by:['partyId'], where:{businessId,partyId:{in:parties.map(({id})=>id)},type:'CREDIT_NOTE',deletedAt:null,status:{notIn:['DRAFT','CANCELLED','REJECTED']}},_sum:{grandTotal:true}}) : [];
    const creditsByParty = new Map(creditTotals.map((row)=>[row.partyId,Number(row._sum.grandTotal??0)]));
    const totalsByParty = new Map(invoiceTotals.map((total) => [total.partyId, total._sum]));
    return parties.map((party) => {
      const totals = totalsByParty.get(party.id);
      const openingBalance = Number(party.openingBalance);
      const signedOpening = party.openingBalanceType === PartyBalanceType.PAYABLE ? -openingBalance : openingBalance;
      const totalBilled = subtractMoney(Number(totals?.grandTotal ?? 0),creditsByParty.get(party.id)??0);
      const totalReceived = Number(totals?.amountPaid ?? 0);
      const balanceDue = subtractMoney(sumMoney([signedOpening,totalBilled]),totalReceived);
      const creditLimit = Number(party.creditLimit);
      return {
        ...this.redact(party),
        totalBilled,
        totalReceived,
        balanceDue,
        creditAvailable: Math.max(0, creditLimit - Math.max(0, balanceDue)),
      };
    });
  }

  async findOne(id: string, businessId: string, branchId: string) {
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const party = await this.prisma.party.findFirst({ where: { id, branchId: { in: logicalBranchIds }, deletedAt: null } });
    if (!party) throw new NotFoundException('Party not found');
    return this.redact(party);
  }

  async ledger(id: string, businessId: string, branchId: string) {
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const party = await this.prisma.party.findFirst({
      where: { id, branchId: { in: logicalBranchIds }, deletedAt: null },
    });
    if (!party) throw new NotFoundException('Party not found');

    const invoices = await this.prisma.invoice.findMany({
      where: {
        partyId: id,
        businessId,
        deletedAt: null,
        status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] },
      },
      include: { payments: true },
      orderBy: { issueDate: 'asc' },
    });

    const openingAmount = Number(party.openingBalance);
    const signedOpening = party.openingBalanceType === PartyBalanceType.PAYABLE ? -openingAmount : openingAmount;
    const events: Array<{
      id: string;
      type: 'OPENING_BALANCE' | 'SALE_INVOICE' | 'PAYMENT_IN' | 'CREDIT_NOTE';
      number: string;
      date: Date;
      amount: number;
      status?: string;
      invoiceId?: string;
    }> = [];

    if (openingAmount > 0) {
      events.push({
        id: `opening-${party.id}`,
        type: 'OPENING_BALANCE',
        number: 'Opening balance',
        date: party.createdAt,
        amount: signedOpening,
      });
    }

    for (const invoice of invoices) {
      events.push({
        id: invoice.id,
        type: 'SALE_INVOICE',
        number: invoice.invoiceNumber,
        date: invoice.issueDate,
        amount: Number(invoice.grandTotal),
        status: invoice.status,
        invoiceId: invoice.id,
      });
      for (const payment of invoice.payments) {
        events.push({
          id: payment.id,
          type: 'PAYMENT_IN',
          number: payment.reference || `Payment for ${invoice.invoiceNumber}`,
          date: payment.paidAt,
          amount: -Number(payment.amount),
          invoiceId: invoice.id,
        });
      }
    }

    const creditNotes = await this.prisma.businessDocument.findMany({where:{businessId,partyId:id,type:'CREDIT_NOTE',deletedAt:null,status:{notIn:['DRAFT','CANCELLED','REJECTED']}}});
    for (const note of creditNotes) events.push({id:note.id,type:'CREDIT_NOTE',number:note.documentNumber,date:note.issueDate,amount:-Number(note.grandTotal)});
    events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
    let runningBalance = 0;
    const transactions = events.map((event) => {
      runningBalance = sumMoney([runningBalance,event.amount]);
      return { ...event, balance: runningBalance };
    }).reverse();
    const totalBilled = subtractMoney(sumMoney(invoices.map((invoice)=>Number(invoice.grandTotal))),sumMoney(creditNotes.map((note)=>Number(note.grandTotal))));
    const totalReceived = invoices.reduce((sum, invoice) => sum + Number(invoice.amountPaid), 0);
    const balanceDue = subtractMoney(sumMoney([signedOpening,totalBilled]),totalReceived);
    const creditLimit = Number(party.creditLimit);

    return {
      party: this.redact(party),
      summary: {
        openingBalance: signedOpening,
        totalBilled,
        totalReceived,
        balanceDue,
        creditLimit,
        creditAvailable: Math.max(0, creditLimit - Math.max(0, balanceDue)),
      },
      transactions,
    };
  }

  async update(id: string, dto: UpdatePartyDto, userId: string, businessId: string, branchId: string) {
    const existing = await this.findOne(id, businessId, branchId);
    const gstType = dto.gstType ?? existing.gstType;
    const party = await this.prisma.party.update({
      where: { id },
      data: {
        ...dto,
        gstin: usesGstin(gstType)
          ? dto.gstin ? encryptField(dto.gstin.toUpperCase()) : undefined
          : null,
      },
    });
    await this.audit.log({
      businessId,
      userId,
      action: 'PARTY_UPDATED',
      entityType: 'Party',
      entityId: id,
    });
    return this.redact(party);
  }

  // Soft delete only - financial-adjacent records are never hard-deleted
  async remove(id: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const linked = await this.prisma.party.findUnique({ where: { id }, select: { _count: { select: { invoices: true, documents: true, productionOrders: true } } } });
    if (linked && Object.values(linked._count).some((count) => count > 0)) throw new BadRequestException('This record has linked transactions and must be retained');
    await this.prisma.party.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      businessId,
      userId,
      action: 'PARTY_DELETED',
      entityType: 'Party',
      entityId: id,
    });
    return { success: true };
  }
}

function usesGstin(type: PartyGstType) {
  return type === PartyGstType.REGISTERED_REGULAR
    || type === PartyGstType.REGISTERED_COMPOSITION
    || type === PartyGstType.SEZ;
}
