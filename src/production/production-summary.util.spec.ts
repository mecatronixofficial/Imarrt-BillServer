import { calculateProductionSummary } from './production-summary.util';

describe('calculateProductionSummary', () => {
  it('combines material and process costs and calculates profit', () => {
    expect(calculateProductionSummary({
      orderedQty: 100,
      saleRate: 325,
      stages: [
        { type: 'CUTTING', status: 'COMPLETED', plannedQty: 100, issuedQty: 100, completedQty: 100, rate: 4, otherCost: 100 },
        { type: 'PACKING', status: 'COMPLETED', plannedQty: 100, issuedQty: 100, completedQty: 98, rate: 5, otherCost: 0 },
      ],
      costs: [{ amount: 17500 }, { amount: 500 }],
    })).toMatchObject({
      revenue: 32500,
      processCost: 1000,
      materialCost: 18000,
      totalMakingCost: 19000,
      costPerPiece: 193.88,
      profit: 13500,
    });
  });
});
