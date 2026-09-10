import { ProductionStageStatus, ProductionStageType } from '@prisma/client';

export const PRODUCTION_PIPELINE: ProductionStageType[] = [
  ProductionStageType.CUTTING,
  ProductionStageType.STITCHING,
  ProductionStageType.PRINT_EMBROIDERY,
  ProductionStageType.PACKING,
];

export function getPreviousProductionStageType(currentType: ProductionStageType) {
  const currentIndex = PRODUCTION_PIPELINE.indexOf(currentType);
  return currentIndex > 0 ? PRODUCTION_PIPELINE[currentIndex - 1] : null;
}

export function buildInitialProductionStages(orderedQty: number) {
  return PRODUCTION_PIPELINE.map((type, index) => ({
    type,
    sequence: index + 1,
    plannedQty: index === 0 ? orderedQty : 0,
    issuedQty: index === 0 ? orderedQty : 0,
    status: index === 0
      ? ProductionStageStatus.IN_PROGRESS
      : ProductionStageStatus.PENDING,
  }));
}

type TransferStage = {
  id: string;
  type: ProductionStageType;
  status: ProductionStageStatus;
  completedQty: number;
  rejectedQty: number;
};

export function getNextStageTransfer(
  stages: TransferStage[],
  currentType: ProductionStageType,
  completedQty: number,
) {
  const currentIndex = PRODUCTION_PIPELINE.indexOf(currentType);
  const nextType = PRODUCTION_PIPELINE[currentIndex + 1];
  if (!nextType) return null;

  const stage = stages.find((entry) => entry.type === nextType);
  if (!stage) return null;

  return {
    stage,
    processedQty: stage.completedQty + stage.rejectedQty,
    data: {
      plannedQty: completedQty,
      issuedQty: completedQty,
      status:
        stage.status === ProductionStageStatus.PENDING && completedQty > 0
          ? ProductionStageStatus.IN_PROGRESS
          : stage.status,
    },
  };
}
