import { ProductionStageStatus, ProductionStageType } from '@prisma/client';
import {
  buildInitialProductionStages,
  getNextStageTransfer,
  getPreviousProductionStageType,
  PRODUCTION_PIPELINE,
} from './production-pipeline.util.js';

describe('production pipeline', () => {
  it('starts the ordered quantity in cutting only', () => {
    const stages = buildInitialProductionStages(100);

    expect(PRODUCTION_PIPELINE).toEqual([
      ProductionStageType.CUTTING,
      ProductionStageType.STITCHING,
      ProductionStageType.PRINT_EMBROIDERY,
      ProductionStageType.PACKING,
    ]);
    expect(stages[0]).toMatchObject({
      plannedQty: 100,
      issuedQty: 100,
      status: ProductionStageStatus.IN_PROGRESS,
    });
    expect(stages.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ plannedQty: 0, issuedQty: 0, status: ProductionStageStatus.PENDING }),
      ]),
    );
  });

  it('transfers only completed good pieces to the next stage', () => {
    const transfer = getNextStageTransfer([
      { id: 'cut', type: ProductionStageType.CUTTING, status: ProductionStageStatus.COMPLETED, completedQty: 90, rejectedQty: 10 },
      { id: 'stitch', type: ProductionStageType.STITCHING, status: ProductionStageStatus.PENDING, completedQty: 0, rejectedQty: 0 },
      { id: 'print', type: ProductionStageType.PRINT_EMBROIDERY, status: ProductionStageStatus.PENDING, completedQty: 0, rejectedQty: 0 },
    ], ProductionStageType.CUTTING, 90);

    expect(transfer).toMatchObject({
      stage: { id: 'stitch' },
      data: {
        plannedQty: 90,
        issuedQty: 90,
        status: ProductionStageStatus.IN_PROGRESS,
      },
    });
    expect(getPreviousProductionStageType(ProductionStageType.PRINT_EMBROIDERY))
      .toBe(ProductionStageType.STITCHING);
  });
});
