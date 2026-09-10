import { calculateProductionSummary } from './production-summary.util.js';

describe('calculateProductionSummary', () => {
  it('combines material and process costs and calculates profit', () => {
    expect(calculateProductionSummary({
      orderedQty: 100,
      saleRate: 325,
      stages: [
        { type: 'CUTTING', status: 'COMPLETED', plannedQty: 100, issuedQty: 100, completedQty: 100, rejectedQty: 0, rate: 4, otherCost: 100 },
        { type: 'PACKING', status: 'COMPLETED', plannedQty: 100, issuedQty: 100, completedQty: 98, rejectedQty: 2, rate: 5, otherCost: 0 },
      ],
      costs: [{ amount: 17500 }, { amount: 500 }],
    })).toMatchObject({
      revenue: 32500,
      processCost: 1000,
      materialCost: 18000,
      totalMakingCost: 19000,
      costPerPiece: 190,
      profit: 13500,
    });
  });

  it('matches projected profitability using recorded production quantities', () => {
    expect(calculateProductionSummary({
      orderedQty: 194,
      saleRate: 67,
      stages: [
        { type: 'CUTTING', status: 'COMPLETED', plannedQty: 194, issuedQty: 194, completedQty: 190, rejectedQty: 4, rate: 160, otherCost: 1447 },
      ],
      costs: [],
    })).toMatchObject({
      revenue: 12998,
      processCost: 32487,
      materialCost: 0,
      totalMakingCost: 32487,
      costPerPiece: 167.46,
      profit: -19489,
      marginPercent: -149.94,
    });
  });
});
