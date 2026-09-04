export type ProductionSummaryInput = {
  orderedQty: number;
  saleRate: number | string | { toString(): string };
  stages?: Array<{
    plannedQty: number;
    issuedQty: number;
    completedQty: number;
    rate: number | string | { toString(): string };
    otherCost: number | string | { toString(): string };
    status: string;
    type: string;
  }>;
  costs?: Array<{ amount: number | string | { toString(): string } }>;
};

const numeric = (value: number | string | { toString(): string } | null | undefined) =>
  Number(value?.toString() ?? 0) || 0;

export function calculateProductionSummary(input: ProductionSummaryInput) {
  const stages = input.stages ?? [];
  const costs = input.costs ?? [];
  const revenue = input.orderedQty * numeric(input.saleRate);
  const processCost = stages.reduce((total, stage) => {
    const chargeableQty = Math.max(stage.issuedQty, stage.completedQty);
    return total + chargeableQty * numeric(stage.rate) + numeric(stage.otherCost);
  }, 0);
  const materialCost = costs.reduce((total, cost) => total + numeric(cost.amount), 0);
  const totalMakingCost = processCost + materialCost;
  const packedQty = stages.find((stage) => stage.type === 'PACKING')?.completedQty ?? 0;
  const completedQty = packedQty || input.orderedQty;
  const profit = revenue - totalMakingCost;
  const progress = stages.length
    ? stages.reduce((total, stage) => {
        if (stage.status === 'COMPLETED') return total + 100;
        if (!stage.plannedQty) return total;
        return total + Math.min(100, (stage.completedQty / stage.plannedQty) * 100);
      }, 0) / stages.length
    : 0;

  return {
    revenue: Number(revenue.toFixed(2)),
    processCost: Number(processCost.toFixed(2)),
    materialCost: Number(materialCost.toFixed(2)),
    totalMakingCost: Number(totalMakingCost.toFixed(2)),
    costPerPiece: completedQty ? Number((totalMakingCost / completedQty).toFixed(2)) : 0,
    profit: Number(profit.toFixed(2)),
    marginPercent: revenue ? Number(((profit / revenue) * 100).toFixed(2)) : 0,
    packedQty,
    progressPercent: Number(progress.toFixed(1)),
  };
}
