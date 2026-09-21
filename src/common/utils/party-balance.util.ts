import { InvoiceStatus, PartyBalanceType } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';

type BalanceParty = { id: string; openingBalance: unknown; openingBalanceType: PartyBalanceType };

/** What the party owes right now: opening balance plus everything billed, minus everything received (cancelled invoices excluded). */
export async function currentPartyBalance(prisma: PrismaService, businessId: string, party: BalanceParty): Promise<number> {
  const totals = await prisma.invoice.aggregate({
    where: { businessId, partyId: party.id, deletedAt: null, status: { not: InvoiceStatus.CANCELLED } },
    _sum: { grandTotal: true, amountPaid: true },
  });
  const opening = Number(party.openingBalance);
  const signedOpening = party.openingBalanceType === PartyBalanceType.PAYABLE ? -opening : opening;
  return signedOpening + Number(totals._sum.grandTotal ?? 0) - Number(totals._sum.amountPaid ?? 0);
}
