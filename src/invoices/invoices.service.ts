import { transactionDetails } from '../common/dto/transaction-details.dto.js';
import { trackingFields } from '../common/dto/tracking-fields.dto.js';
import { adjustStock, billingTransaction, lockBillingRecord } from '../common/utils/billing-transaction.util.js';
import { money, sumMoney, subtractMoney } from '../common/utils/billing.util.js';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceAttachmentKind, InvoiceDeliveryChannel, InvoiceStatus, PartyBalanceType, PartyDeliveryChannel, PartyDeliveryMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { UpdatePaymentDto } from './dto/update-payment.dto.js';
import { computeInvoiceTotals, generateInvoiceNumber, invoiceNumberPrefix, NUMBERING_LABELS, totalsOptionsFor } from './invoice-calc.util.js';
import { resolvePreferences } from '../businesses/business-preferences.js';
import { currentPartyBalance } from '../common/utils/party-balance.util.js';
import { AuditService } from '../common/utils/audit.service.js';
import { decryptField } from '../common/utils/encryption.util.js';
import { InvoiceDeliveryService } from './invoice-delivery.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { getLogicalBranchIds, getWorkspaceBusinessIds } from '../common/utils/workspace-scope.util.js';

export interface UploadedInvoiceFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_ATTACHMENTS_PER_INVOICE = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private delivery: InvoiceDeliveryService,
  ) {}

  /** The party's running balance, only worked out when the company prints it on invoices. */
  async partyBalanceForPrint(businessId: string, invoice: { party: { id: string; openingBalance: unknown; openingBalanceType: PartyBalanceType }; business?: { preferences?: unknown } | null }) {
    const preferences=resolvePreferences(invoice.business?.preferences);
    if (!preferences.printRegular.currentBalanceOfParty && !preferences.printThermal.currentBalanceOfParty) return undefined;
    return currentPartyBalance(this.prisma, businessId, invoice.party);
  }

  async nextInvoiceNumber(businessId: string, branchId: string) {
    const [branch, business] = await Promise.all([
      this.prisma.branch.findFirst({ where: { id: branchId, businessId, isActive: true } }),
      this.prisma.business.findUnique({ where: { id: businessId }, select: { preferences: true } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    const { transaction } = resolvePreferences(business?.preferences);
    const year = new Date().getFullYear();
    const label = NUMBERING_LABELS[transaction.numberingPrefix as keyof typeof NUMBERING_LABELS];
    const countThisYear = await this.prisma.invoice.count({
      where: { branchId, invoiceNumber: { startsWith: `${branch.code}-${invoiceNumberPrefix(year, label)}` } },
    });
    return {
      invoiceNumber: `${branch.code}-${generateInvoiceNumber(year, countThisYear + 1, label)}`,
      manual: !transaction.autoNumbering,
    };
  }

  async create(dto: CreateInvoiceDto, userId: string, businessId: string, branchId: string, transaction?: Prisma.TransactionClient, stockAlreadyAdjusted = false) {
    const db = transaction ?? this.prisma;
    const draft = dto.status === 'DRAFT';
    if(draft && dto.initialPayment)throw new BadRequestException('Draft invoices cannot accept payments');
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const [party, business, branch] = await Promise.all([
      db.party.findFirst({
        where: { id: dto.partyId, branchId: { in: logicalBranchIds }, deletedAt: null },
      }),
      db.business.findUnique({ where: { id: businessId } }),
      db.branch.findFirst({ where: { id: branchId, businessId, isActive: true } }),
    ]);
    if (!party) throw new NotFoundException('Party not found');
    if (!business) throw new NotFoundException('Business not found');
    if (!branch) throw new NotFoundException('Branch not found');

    const itemIds = dto.items.flatMap((item) => (item.itemId ? [item.itemId] : []));
    if (itemIds.length > 0) {
      const validItems = await db.item.count({
        where: { id: { in: itemIds }, branchId: { in: logicalBranchIds }, deletedAt: null },
      });
      if (validItems !== new Set(itemIds).size) {
        throw new BadRequestException('One or more invoice items do not belong to this workspace');
      }
    }

    const normalizedItems = dto.items.map((item) => ({
      ...item,
      taxRate: business.gstRegistered ? item.taxRate ?? 0 : 0,
    }));

    const preferences = resolvePreferences(business.preferences);
    const manualNumber = dto.invoiceNumber?.trim();
    if (!preferences.transaction.autoNumbering && !manualNumber) {
      throw new BadRequestException('Enter an invoice number');
    }

    const totals = computeInvoiceTotals(
      normalizedItems.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        taxRate: i.taxRate ?? 0,
        taxInclusive: i.taxInclusive,
      })),
      dto.discount ?? 0,
      { ...totalsOptionsFor(preferences, true), ...(dto.roundOff === undefined ? {} : { roundOff: dto.roundOff }) },
    );

    if (totals.grandTotal < 0) throw new BadRequestException('Discount cannot exceed the invoice total');
    if (dto.dueDate && dto.issueDate && new Date(dto.dueDate) < new Date(dto.issueDate)) throw new BadRequestException('Due date cannot be before the invoice date');

    // Everything below happens in a single DB transaction:
    // if stock update or invoice-number generation fails, nothing is partially saved.
    let replayed=false;
    const persist = async (tx: Prisma.TransactionClient) => {
      await lockBillingRecord(tx, 'branch', branchId);
      if(dto.requestId){const previous=await tx.invoice.findFirst({where:{businessId,branchId,requestId:dto.requestId},include:{items:true,party:true,branch:true}});if(previous){replayed=true;return previous;}}
      if(dto.warehouseId && !await tx.warehouse.findFirst({where:{id:dto.warehouseId,businessId,branchId,isActive:true}}))throw new BadRequestException('Godown not found in this branch');

      if(dto.initialPayment?.accountId&&!await tx.cashAccount.findFirst({where:{id:dto.initialPayment.accountId,businessId,branchId,deletedAt:null}}))throw new BadRequestException('Payment account is outside this branch');
      const initialPaid = dto.initialPayment ? money(dto.initialPayment.amount) : 0;
      if (initialPaid < 0 || initialPaid > totals.grandTotal) throw new BadRequestException('Initial payment exceeds invoice total');
      if(!draft && Number(party.creditLimit)>0 && totals.grandTotal>initialPaid){
        await lockBillingRecord(tx,'party',party.id);
        const [currentParty,receivables,creditNotes]=await Promise.all([
          tx.party.findUniqueOrThrow({where:{id:party.id}}),
          tx.invoice.aggregate({where:{businessId,partyId:party.id,deletedAt:null,status:{notIn:['DRAFT','CANCELLED']}},_sum:{grandTotal:true,amountPaid:true}}),
          tx.businessDocument.aggregate({where:{businessId,partyId:party.id,type:'CREDIT_NOTE',deletedAt:null,status:{notIn:['DRAFT','CANCELLED','REJECTED']}},_sum:{grandTotal:true}}),
        ]);
        const opening=Number(currentParty.openingBalance)*(currentParty.openingBalanceType==='PAYABLE'?-1:1);
        const after=sumMoney([opening,Number(receivables._sum.grandTotal??0),-Number(receivables._sum.amountPaid??0),-Number(creditNotes._sum.grandTotal??0),totals.grandTotal,-initialPaid]);
        if(Number(currentParty.creditLimit)>0 && after>Number(currentParty.creditLimit))throw new BadRequestException('This sale exceeds the customer credit limit');
      }
      let invoiceNumber: string;
      if (!preferences.transaction.autoNumbering && manualNumber) {
        const duplicate = await tx.invoice.findFirst({ where: { branchId, invoiceNumber: manualNumber }, select: { id: true } });
        if (duplicate) throw new ConflictException(`Invoice number ${manualNumber} is already used in this branch`);
        invoiceNumber = manualNumber;
      } else {
        const year = new Date().getFullYear();
        const label = NUMBERING_LABELS[preferences.transaction.numberingPrefix as keyof typeof NUMBERING_LABELS];
        const countThisYear = await tx.invoice.count({
          where: { branchId, invoiceNumber: { startsWith: `${branch.code}-${invoiceNumberPrefix(year, label)}` } },
        });
        invoiceNumber = `${branch.code}-${generateInvoiceNumber(year, countThisYear + 1, label)}`;
      }

      const created = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          ...transactionDetails(dto),
          placeOfSupply: dto.placeOfSupply,
          requestId:dto.requestId,
          warehouseId: dto.warehouseId,
          invoiceNumber,
          partyId: dto.partyId,
          createdById: userId,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: draft ? InvoiceStatus.DRAFT : initialPaid === totals.grandTotal ? InvoiceStatus.PAID : initialPaid > 0 ? InvoiceStatus.PARTIALLY_PAID : InvoiceStatus.UNPAID,
          amountPaid: initialPaid,
          payments: dto.initialPayment ? { create: { amount: initialPaid, requestId:dto.initialPayment.requestId, accountId:dto.initialPayment.accountId, paidAt:dto.initialPayment.paidAt ? new Date(dto.initialPayment.paidAt) : undefined, method: dto.initialPayment.method, reference: dto.initialPayment.reference } } : undefined,
          subTotal: totals.subTotal,
          taxTotal: totals.taxTotal,
          discount: totals.discount,
          grandTotal: totals.grandTotal,
          notes: dto.notes,
          items: {
            create: totals.lines.map((line, idx) => ({
              ...trackingFields(normalizedItems[idx]),
              itemId: normalizedItems[idx].itemId,
              description: normalizedItems[idx].description,
              unit: normalizedItems[idx].unit || 'pcs',
              hsnSac: normalizedItems[idx].hsnSac,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              lineTotal: line.lineTotal,
              taxInclusive: Boolean(normalizedItems[idx].taxInclusive),
            })),
          },
        },
        include: { items: true, party: true, branch: true },
      });

      if (!draft && !stockAlreadyAdjusted) await adjustStock(tx, totals.lines.map((line, index) => ({ itemId: normalizedItems[index].itemId, quantity: line.quantity })), 'decrement', preferences.transaction.negativeStock, {businessId,branchId,warehouseId:dto.warehouseId,sourceId:created.id,kind:'SALE',userId});

      return created;
    };
    const invoice = transaction ? await persist(transaction) : await billingTransaction(this.prisma, persist);
    if (transaction || replayed) return { ...invoice, deliveryAttempts: [] };

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, grandTotal: totals.grandTotal },
    });

    const deliveryMode = dto.deliveryMode ?? party.invoiceDeliveryMode;
    const deliveryChannels = dto.deliveryChannels?.length
      ? dto.deliveryChannels
      : party.invoiceDeliveryChannel === PartyDeliveryChannel.BOTH
        ? [InvoiceDeliveryChannel.EMAIL, InvoiceDeliveryChannel.WHATSAPP]
        : [party.invoiceDeliveryChannel as InvoiceDeliveryChannel];
    const deliveryAttempts = !draft && deliveryMode === PartyDeliveryMode.AUTOMATIC
      ? await this.delivery.deliver(invoice.id, businessId, deliveryChannels, userId, branchId)
      : [];

    return { ...invoice, deliveryAttempts };
  }

  async update(id:string,dto:CreateInvoiceDto,userId:string,businessId:string,branchId:string){
    const result=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);await lockBillingRecord(tx,'invoice',id);
      const existing=await tx.invoice.findFirst({where:{id,businessId,branchId,deletedAt:null},include:{items:true}});
      if(!existing)throw new NotFoundException('Invoice not found');
      if(dto.requestId&&existing.lastEditRequestId===dto.requestId)return {...existing,party:await tx.party.findUniqueOrThrow({where:{id:existing.partyId}})};
      if(existing.status===InvoiceStatus.CANCELLED||Number(existing.amountPaid)>0)throw new BadRequestException('Only unpaid or draft invoices can be edited');
      if(existing.status!==InvoiceStatus.DRAFT&&dto.status==='DRAFT')throw new BadRequestException('An issued invoice cannot be reset to draft');
      if(await tx.businessDocument.count({where:{referenceInvoiceId:id,deletedAt:null,status:{notIn:['DRAFT','CANCELLED','REJECTED']}}}))throw new BadRequestException('Cancel linked adjustments before editing this invoice');
      const branches=await getLogicalBranchIds(this.prisma,businessId,branchId);
      const [business,party]=await Promise.all([tx.business.findUniqueOrThrow({where:{id:businessId}}),tx.party.findFirst({where:{id:dto.partyId,branchId:{in:branches},deletedAt:null}})]);
      if(!party)throw new BadRequestException('Party not found in this branch');
      const itemIds=[...new Set(dto.items.flatMap((line)=>line.itemId?[line.itemId]:[]))];
      if(itemIds.length&&await tx.item.count({where:{id:{in:itemIds},branchId:{in:branches},deletedAt:null}})!==itemIds.length)throw new BadRequestException('One or more items are outside this branch');
      if(dto.warehouseId&&!await tx.warehouse.findFirst({where:{id:dto.warehouseId,businessId,branchId,isActive:true}}))throw new BadRequestException('Godown not found in this branch');
      const prefs=resolvePreferences(business.preferences);
      const drafts=dto.items.map((line)=>({...line,taxRate:business.gstRegistered?line.taxRate??0:0}));
      const totals=computeInvoiceTotals(drafts.map((line)=>({quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate,taxInclusive:line.taxInclusive})),dto.discount??0,{...totalsOptionsFor(prefs,true),...(dto.roundOff===undefined?{}:{roundOff:dto.roundOff})});
      const draft=dto.status==='DRAFT',paid=dto.initialPayment?money(dto.initialPayment.amount):0;
      if(totals.grandTotal<0||paid>totals.grandTotal||paid<0||draft&&paid>0)throw new BadRequestException('Check invoice discount and payment totals');
      const issueDate=dto.issueDate?new Date(dto.issueDate):existing.issueDate;
      const dueDate=dto.dueDate?new Date(dto.dueDate):null;
      if(dueDate&&dueDate<issueDate)throw new BadRequestException('Due date cannot be before the invoice date');
      for(const partyId of [...new Set([existing.partyId,party.id])].sort())await lockBillingRecord(tx,'party',partyId);
      const oldDebt=existing.partyId===party.id&&existing.status!==InvoiceStatus.DRAFT?Number(existing.grandTotal):0;
      if(!draft&&Number(party.creditLimit)>0&&totals.grandTotal-paid>oldDebt){
        const [receivable,credits]=await Promise.all([tx.invoice.aggregate({where:{businessId,partyId:party.id,id:{not:id},deletedAt:null,status:{notIn:['DRAFT','CANCELLED']}},_sum:{grandTotal:true,amountPaid:true}}),tx.businessDocument.aggregate({where:{businessId,partyId:party.id,type:'CREDIT_NOTE',deletedAt:null,status:{notIn:['DRAFT','CANCELLED','REJECTED']}},_sum:{grandTotal:true}})]);
        const balance=sumMoney([Number(party.openingBalance)*(party.openingBalanceType==='PAYABLE'?-1:1),Number(receivable._sum.grandTotal??0),-Number(receivable._sum.amountPaid??0),-Number(credits._sum.grandTotal??0),totals.grandTotal,-paid]);
        if(balance>Number(party.creditLimit))throw new BadRequestException('This sale exceeds the customer credit limit');
      }
      if(dto.initialPayment?.accountId&&!await tx.cashAccount.findFirst({where:{id:dto.initialPayment.accountId,businessId,branchId,deletedAt:null}}))throw new BadRequestException('Payment account is outside this branch');
      if(existing.status!==InvoiceStatus.DRAFT)await adjustStock(tx,existing.items.map((line)=>({itemId:line.itemId,quantity:Number(line.quantity)})),'increment',true,{businessId,branchId,warehouseId:existing.warehouseId,kind:'SALE_EDIT_REVERSAL',sourceId:id,userId});
      if(!draft)await adjustStock(tx,drafts,'decrement',prefs.transaction.negativeStock,{businessId,branchId,warehouseId:dto.warehouseId,kind:'SALE_EDIT',sourceId:id,userId});
      const invoiceNumber=!prefs.transaction.autoNumbering&&dto.invoiceNumber?dto.invoiceNumber.trim():existing.invoiceNumber;
      if(invoiceNumber!==existing.invoiceNumber&&await tx.invoice.count({where:{branchId,invoiceNumber,id:{not:id}}}))throw new ConflictException('Invoice number is already used');
      const updated=await tx.invoice.update({where:{id},data:{...transactionDetails(dto),placeOfSupply:dto.placeOfSupply??null,lastEditRequestId:dto.requestId,partyId:party.id,warehouseId:dto.warehouseId??null,invoiceNumber,issueDate,dueDate,subTotal:totals.subTotal,taxTotal:totals.taxTotal,discount:totals.discount,grandTotal:totals.grandTotal,amountPaid:paid,notes:dto.notes,status:draft?InvoiceStatus.DRAFT:paid===totals.grandTotal?InvoiceStatus.PAID:paid>0?InvoiceStatus.PARTIALLY_PAID:InvoiceStatus.UNPAID,items:{deleteMany:{},create:totals.lines.map((line,index)=>({...trackingFields(drafts[index]),itemId:drafts[index].itemId,description:drafts[index].description,unit:drafts[index].unit||'pcs',hsnSac:drafts[index].hsnSac,quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate,taxInclusive:Boolean(line.taxInclusive),lineTotal:line.lineTotal}))},payments:dto.initialPayment?{create:{amount:paid,method:dto.initialPayment.method,reference:dto.initialPayment.reference,accountId:dto.initialPayment.accountId,paidAt:dto.initialPayment.paidAt ? new Date(dto.initialPayment.paidAt) : undefined}}:undefined},include:{items:true,party:true,branch:true}});
      return updated;
    });
    await this.audit.log({businessId,branchId,userId,action:'INVOICE_UPDATED',entityType:'Invoice',entityId:id});return result;
  }

  async findAll(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    const invoices = await this.prisma.invoice.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: { party: true, branch: true, relatedDocuments: { where: { type: 'CREDIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT','CANCELLED','REJECTED'] } }, select: { grandTotal: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    const sources = invoices.length ? await this.prisma.businessDocument.findMany({ where: { convertedInvoiceId: { in: invoices.map((invoice) => invoice.id) }, businessId, ...(branchId ? { branchId } : {}), deletedAt: null, status: 'CONVERTED', type: { in: ['QUOTATION', 'PROFORMA_INVOICE'] } }, select: { id: true, type: true, documentNumber: true, convertedInvoiceId: true } }) : [];
    return invoices.map((invoice) => ({ ...this.withCreditBalance(invoice), conversionSource: sources.find((source) => source.convertedInvoiceId === invoice.id) ?? null }));
  }

  private withCreditBalance<T extends {status:InvoiceStatus;grandTotal:Prisma.Decimal;amountPaid:Prisma.Decimal;relatedDocuments:Array<{grandTotal:Prisma.Decimal}>}>(invoice:T) {
    const creditTotal = sumMoney(invoice.relatedDocuments.map((note)=>Number(note.grandTotal)));
    const balanceDue = subtractMoney(subtractMoney(Number(invoice.grandTotal),creditTotal),Number(invoice.amountPaid));
    const status = [InvoiceStatus.DRAFT,InvoiceStatus.CANCELLED].includes(invoice.status as 'DRAFT'|'CANCELLED') ? invoice.status : balanceDue <= 0 ? InvoiceStatus.PAID : Number(invoice.amountPaid)>0 || creditTotal>0 ? InvoiceStatus.PARTIALLY_PAID : InvoiceStatus.UNPAID;
    return {...invoice,creditTotal,balanceDue,status};
  }

  async listPayments(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    const payments = await this.prisma.paymentRecord.findMany({
      where: { invoice: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null } },
      include: { invoice: { select: { id: true, invoiceNumber: true, grandTotal: true, amountPaid: true, status: true, relatedDocuments: { where: { type: 'CREDIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT','CANCELLED','REJECTED'] } }, select: { grandTotal: true } }, party: { select: { id: true, name: true, phone: true, email: true } } } }, account: { select: { id: true, bankName: true } } },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
    return payments.map((payment) => ({ ...payment, invoice: this.withCreditBalance(payment.invoice) }));
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: {
        items: { include: { item: { select: { sku: true, description: true } } } },
        party: true,
        payments: { orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] },
        relatedDocuments: { where: { type: 'CREDIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT','CANCELLED','REJECTED'] } }, select: { grandTotal: true } },
        deliveries: { orderBy: { createdAt: 'desc' } },
        attachments: {
          select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        createdBy: {select:{id:true,name:true,email:true}},
        business: { include: { createdBy: { select: { name: true } } } },
        branch: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const conversionSource = await this.prisma.businessDocument.findFirst({ where: { convertedInvoiceId: id, businessId, branchId: invoice.branchId, deletedAt: null, status: 'CONVERTED', type: { in: ['QUOTATION', 'PROFORMA_INVOICE'] } }, select: { id: true, type: true, documentNumber: true } });
    return {
      ...this.withCreditBalance(invoice), conversionSource,
      party: {
        ...invoice.party,
        gstin: invoice.party.gstin ? decryptField(invoice.party.gstin) : null,
      },
      business: invoice.business
        ? {
            ...invoice.business,
            gstin: invoice.business.gstin ? decryptField(invoice.business.gstin) : null,
          }
        : null,
    };
  }

  async addAttachments(
    invoiceId: string,
    files: UploadedInvoiceFile[],
    userId: string,
    businessId: string,
    branchId: string,
  ) {
    if (!files?.length) throw new BadRequestException('Select at least one file to upload');

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, businessId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const existing = await this.prisma.invoiceAttachment.aggregate({
      where: { invoiceId },
      _count: { id: true },
      _sum: { size: true },
    });
    if (existing._count.id + files.length > MAX_ATTACHMENTS_PER_INVOICE) {
      throw new BadRequestException(`An invoice can have up to ${MAX_ATTACHMENTS_PER_INVOICE} attachments`);
    }

    const totalNewBytes = files.reduce((sum, file) => sum + file.size, 0);
    if ((existing._sum.size ?? 0) + totalNewBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new BadRequestException('Invoice attachments cannot exceed 25 MB in total');
    }

    const uploads = files.map((file) => {
      if (!file.buffer || file.size <= 0) throw new BadRequestException('Empty files cannot be uploaded');
      if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException(`${file.originalname} exceeds the 10 MB file limit`);

      const kind = IMAGE_MIME_TYPES.has(file.mimetype)
        ? InvoiceAttachmentKind.IMAGE
        : DOCUMENT_MIME_TYPES.has(file.mimetype)
          ? InvoiceAttachmentKind.DOCUMENT
          : null;
      if (!kind) throw new BadRequestException(`${file.originalname} is not a supported image or document`);

      const fileName = file.originalname
        .replace(/[\r\n]/g, '')
        .replace(/[^\p{L}\p{N}._() -]/gu, '_')
        .slice(0, 191) || 'attachment';

      return { kind, fileName, mimeType: file.mimetype, size: file.size, data: Uint8Array.from(file.buffer) };
    });

    const created = await this.prisma.$transaction(
      uploads.map((upload) => this.prisma.invoiceAttachment.create({
        data: { invoiceId, ...upload },
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      })),
    );

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'INVOICE_ATTACHMENTS_ADDED',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { files: created.map(({ id, fileName, kind, size }) => ({ id, fileName, kind, size })) },
    });

    return created;
  }

  async listAttachments(invoiceId: string, businessId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return this.prisma.invoiceAttachment.findMany({
      where: { invoiceId },
      select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAttachment(invoiceId: string, attachmentId: string, businessId: string, branchId?: string) {
    const attachment = await this.prisma.invoiceAttachment.findFirst({
      where: {
        id: attachmentId,
        invoiceId,
        invoice: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto, userId: string, businessId: string, branchId: string) {
    const result = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'invoice', invoiceId);
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, businessId, branchId, deletedAt: null } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      const credits = await tx.businessDocument.aggregate({ where: { referenceInvoiceId: invoiceId, type: 'CREDIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT','CANCELLED','REJECTED'] } }, _sum: { grandTotal: true } });
      const creditTotal = Number(credits._sum.grandTotal ?? 0);
      const netTotal = subtractMoney(Number(invoice.grandTotal), creditTotal);
      const include = { items: true, party: true, branch: true, payments: { orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] } } satisfies Prisma.InvoiceInclude;
      if (dto.requestId && await tx.paymentRecord.findFirst({ where: { invoiceId, requestId: dto.requestId } })) {
        return { invoice: await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include }), creditTotal, netTotal, replayed: true };
      }
      if ([InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT].includes(invoice.status as 'CANCELLED' | 'DRAFT')) throw new BadRequestException('Issue an invoice before accepting payment');
      if (dto.accountId) await lockBillingRecord(tx, 'account', dto.accountId);
      if (dto.accountId && !await tx.cashAccount.findFirst({ where: { id: dto.accountId, businessId, branchId, deletedAt: null } })) throw new BadRequestException('Account not found in this branch');
      const amount = money(dto.amount);
      const remaining = subtractMoney(netTotal, Number(invoice.amountPaid));
      if (amount <= 0 || amount > remaining) throw new BadRequestException('Payment must be positive and cannot exceed the outstanding balance');
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('Enter a valid payment date and time');
      const newAmountPaid = sumMoney([Number(invoice.amountPaid), amount]);
      await tx.paymentRecord.create({ data: { invoiceId, amount, requestId: dto.requestId, accountId: dto.accountId, method: dto.method, reference: dto.reference, paidAt } });
      const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: newAmountPaid, status: newAmountPaid === netTotal ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID }, include });
      return { invoice: updated, creditTotal, netTotal, replayed: false };
    });
    if (!result.replayed) await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_RECORDED', entityType: 'Invoice', entityId: invoiceId, metadata: { amount: dto.amount, method: dto.method, paidAt: dto.paidAt } });
    const balanceDue = subtractMoney(result.netTotal, Number(result.invoice.amountPaid));
    const status = [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED].includes(result.invoice.status as 'DRAFT' | 'CANCELLED') ? result.invoice.status : balanceDue <= 0 ? InvoiceStatus.PAID : Number(result.invoice.amountPaid) > 0 || result.creditTotal > 0 ? InvoiceStatus.PARTIALLY_PAID : InvoiceStatus.UNPAID;
    return { ...result.invoice, creditTotal: result.creditTotal, balanceDue, status };
  }

  /** Locks the payment's invoice, then reads both with the invoice's total net of credit notes. */
  private async lockPayment(tx: Prisma.TransactionClient, paymentId: string, businessId: string, branchId: string) {
    const scoped = await tx.paymentRecord.findFirst({ where: { id: paymentId, invoice: { businessId, branchId, deletedAt: null } }, select: { invoiceId: true } });
    if (!scoped) throw new NotFoundException('Payment not found');
    await lockBillingRecord(tx, 'invoice', scoped.invoiceId);
    const payment = await tx.paymentRecord.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true } });
    const credits = await tx.businessDocument.aggregate({ where: { referenceInvoiceId: payment.invoiceId, type: 'CREDIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] } }, _sum: { grandTotal: true } });
    const chequeHistory = payment.method === 'cheque' ? await tx.chequeEvent.count({ where: { paymentId } }) : 0;
    return { payment, netTotal: subtractMoney(Number(payment.invoice.grandTotal), Number(credits._sum.grandTotal ?? 0)), chequeHistory };
  }

  private static paidStatus(paid: number, netTotal: number) {
    return paid <= 0 ? InvoiceStatus.UNPAID : paid >= netTotal ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
  }

  /** Corrects a received payment. The invoice's paid amount and status follow the new amount. */
  async updatePayment(paymentId: string, dto: UpdatePaymentDto, userId: string, businessId: string, branchId: string) {
    const result = await billingTransaction(this.prisma, async (tx) => {
      const { payment, netTotal, chequeHistory } = await this.lockPayment(tx, paymentId, businessId, branchId);
      if (payment.invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('Payments on a cancelled invoice cannot be changed');
      const amount = dto.amount === undefined ? Number(payment.amount) : money(dto.amount);
      const moneyChanged = amount !== Number(payment.amount) || (dto.method !== undefined && dto.method !== payment.method) || (dto.accountId !== undefined && dto.accountId !== payment.accountId);
      if (chequeHistory && moneyChanged) throw new BadRequestException('This cheque has deposit history. Reverse it in Cheques before changing its amount, method or account');
      if (dto.accountId) {
        await lockBillingRecord(tx, 'account', dto.accountId);
        if (!await tx.cashAccount.findFirst({ where: { id: dto.accountId, businessId, branchId, deletedAt: null } })) throw new BadRequestException('Account not found in this branch');
      }
      const paid = sumMoney([Number(payment.invoice.amountPaid), -Number(payment.amount), amount]);
      if (paid > netTotal) throw new BadRequestException('The new amount is more than the invoice balance');
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : undefined;
      if (paidAt && Number.isNaN(paidAt.getTime())) throw new BadRequestException('Enter a valid payment date and time');
      const updated = await tx.paymentRecord.update({ where: { id: paymentId }, data: { amount, method: dto.method, accountId: dto.accountId, reference: dto.reference === undefined ? undefined : dto.reference.trim() || null, paidAt } });
      await tx.invoice.update({ where: { id: payment.invoiceId }, data: { amountPaid: paid, status: InvoicesService.paidStatus(paid, netTotal) } });
      return { updated, previous: Number(payment.amount) };
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_UPDATED', entityType: 'PaymentRecord', entityId: paymentId, metadata: { invoiceId: result.updated.invoiceId, previousAmount: result.previous, amount: Number(result.updated.amount) } });
    return result.updated;
  }

  /** Removes a received payment and reopens that much of the invoice. The audit log keeps a copy. */
  async deletePayment(paymentId: string, userId: string, businessId: string, branchId: string) {
    const removed = await billingTransaction(this.prisma, async (tx) => {
      const { payment, netTotal, chequeHistory } = await this.lockPayment(tx, paymentId, businessId, branchId);
      if (chequeHistory) throw new BadRequestException('This cheque has deposit history. Reverse it in Cheques before deleting the payment');
      const paid = Math.max(0, subtractMoney(Number(payment.invoice.amountPaid), Number(payment.amount)));
      await tx.paymentRecord.delete({ where: { id: paymentId } });
      if (payment.invoice.status !== InvoiceStatus.CANCELLED) await tx.invoice.update({ where: { id: payment.invoiceId }, data: { amountPaid: paid, status: InvoicesService.paidStatus(paid, netTotal) } });
      else await tx.invoice.update({ where: { id: payment.invoiceId }, data: { amountPaid: paid } });
      return payment;
    });
    const { invoice, ...payment } = removed;
    await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_DELETED', entityType: 'PaymentRecord', entityId: paymentId, metadata: { ...payment, amount: Number(payment.amount), invoiceNumber: invoice.invoiceNumber } });
    return { id: paymentId, deleted: true };
  }

  /** Called only after the originating estimate/proforma has been locked and verified. */
  async reverseConvertedInvoice(tx: Prisma.TransactionClient, id: string, businessId: string, branchId: string) {
    await lockBillingRecord(tx, 'invoice', id);
    if (await tx.paymentRecord.count({ where: { invoiceId: id } })) throw new BadRequestException('An invoice with recorded payments cannot be returned. Reverse or refund its payments first');
    return this.reverseInvoice(tx, id, businessId, branchId, true);
  }

  private async reverseInvoice(tx: Prisma.TransactionClient, id: string, businessId: string, branchId: string, remove = false) {
    await lockBillingRecord(tx, 'invoice', id);
    const invoice = await tx.invoice.findFirst({ where: { id, businessId, branchId, deletedAt: null }, include: { items: true } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (Number(invoice.amountPaid) > 0) throw new BadRequestException('An invoice with recorded payments cannot be cancelled or deleted. Reverse or refund its payments first.');
    const returns = await tx.businessDocument.count({ where: { referenceInvoiceId: id, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] } } });
    if (returns) throw new BadRequestException('Cancel linked credit notes before reversing this invoice');
    if (invoice.status !== InvoiceStatus.CANCELLED && invoice.status !== InvoiceStatus.DRAFT) {
      await adjustStock(tx, invoice.items.map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity) })), 'increment', true, {businessId,branchId,warehouseId:invoice.warehouseId,sourceId:id,kind:'SALE_REVERSAL'});
    }
    return tx.invoice.update({ where: { id }, data: { status: InvoiceStatus.CANCELLED, ...(remove ? { deletedAt: new Date() } : {}) } });
  }

  async cancel(id: string, userId: string, businessId: string, branchId: string) {
    const invoice = await billingTransaction(this.prisma, (tx) => this.reverseInvoice(tx, id, businessId, branchId));
    await this.audit.log({ businessId, branchId, userId, action: 'INVOICE_CANCELLED', entityType: 'Invoice', entityId: id });
    return invoice;
  }

  async remove(id: string, userId: string, businessId: string, branchId: string) {
    await billingTransaction(this.prisma, (tx) => this.reverseInvoice(tx, id, businessId, branchId, true));
    await this.audit.log({ businessId, branchId, userId, action: 'INVOICE_DELETED', entityType: 'Invoice', entityId: id });
    return { success: true };
  }
}
