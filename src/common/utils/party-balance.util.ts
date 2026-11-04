import { subtractMoney, sumMoney } from './billing.util.js';
import { InvoiceStatus, PartyBalanceType } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';

type BalanceParty = { id: string; openingBalance: unknown; openingBalanceType: PartyBalanceType };

/** What the party owes right now: opening balance plus everything billed, minus everything received (cancelled invoices excluded). */
export async function currentPartyBalance(prisma: PrismaService, businessId: string, party: BalanceParty): Promise<number> {
  const totals = await prisma.invoice.aggregate({
    where: { businessId, partyId: party.id, deletedAt: null, status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] } },
    _sum: { grandTotal: true, amountPaid: true },
  });
  const credits = await prisma.businessDocument.aggregate({where:{businessId,partyId:party.id,type:'CREDIT_NOTE',deletedAt:null,status:{notIn:['DRAFT','CANCELLED','REJECTED']}},_sum:{grandTotal:true}});
  const opening = Number(party.openingBalance);
  const signedOpening = party.openingBalanceType === PartyBalanceType.PAYABLE ? -opening : opening;
  return subtractMoney(sumMoney([signedOpening,Number(totals._sum.grandTotal ?? 0)]),sumMoney([Number(totals._sum.amountPaid ?? 0),Number(credits._sum.grandTotal??0)]));
}
