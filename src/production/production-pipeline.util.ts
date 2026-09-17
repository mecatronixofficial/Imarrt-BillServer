import { ProductionStageStatus, ProductionStageType } from '@prisma/client';

export const PRODUCTION_PIPELINE: ProductionStageType[] = [
  ProductionStageType.MASTER,
  ProductionStageType.FABRIC_PURCHASE,
  ProductionStageType.WASHING_COMPACTING,
  ProductionStageType.CUTTING,
  ProductionStageType.PRINT_EMBROIDERY,
  ProductionStageType.STITCHING,
  ProductionStageType.PACKING,
  ProductionStageType.FINAL,
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
    rateUnit: type === ProductionStageType.FABRIC_PURCHASE ? 'KG' : 'PIECE',
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
  sequence?: number;
};

export function getNextStageTransfer(
  stages: TransferStage[],
  currentType: ProductionStageType,
  completedQty: number,
) {
  const ordered = [...stages].sort((left, right) => (left.sequence ?? PRODUCTION_PIPELINE.indexOf(left.type)) - (right.sequence ?? PRODUCTION_PIPELINE.indexOf(right.type)));
  const currentIndex = ordered.findIndex((entry) => entry.type === currentType);
  const stage = ordered[currentIndex + 1];
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
