import { ProductionStageStatus, ProductionStageType } from '@prisma/client';
import {
  buildInitialProductionStages,
  getNextStageTransfer,
  getPreviousProductionStageType,
  PRODUCTION_PIPELINE,
} from './production-pipeline.util.js';

describe('production pipeline', () => {
  it('starts the ordered quantity in master only', () => {
    const stages = buildInitialProductionStages(100);

    expect(PRODUCTION_PIPELINE).toEqual([
      ProductionStageType.MASTER,
      ProductionStageType.FABRIC_PURCHASE,
      ProductionStageType.WASHING_COMPACTING,
      ProductionStageType.CUTTING,
      ProductionStageType.PRINT_EMBROIDERY,
      ProductionStageType.STITCHING,
      ProductionStageType.PACKING,
      ProductionStageType.FINAL,
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
      { id: 'print', type: ProductionStageType.PRINT_EMBROIDERY, status: ProductionStageStatus.PENDING, completedQty: 0, rejectedQty: 0 },
      { id: 'cut', type: ProductionStageType.CUTTING, status: ProductionStageStatus.COMPLETED, completedQty: 90, rejectedQty: 10 },
      { id: 'stitch', type: ProductionStageType.STITCHING, status: ProductionStageStatus.PENDING, completedQty: 0, rejectedQty: 0 },
    ], ProductionStageType.CUTTING, 90);

    expect(transfer).toMatchObject({
      stage: { id: 'print' },
      data: {
        plannedQty: 90,
        issuedQty: 90,
        status: ProductionStageStatus.IN_PROGRESS,
      },
    });
    expect(getPreviousProductionStageType(ProductionStageType.PRINT_EMBROIDERY))
      .toBe(ProductionStageType.CUTTING);
  });

  it('moves a confirmed master order into fabric purchase', () => {
    const transfer = getNextStageTransfer([
      { id: 'master', type: ProductionStageType.MASTER, sequence: 1, status: ProductionStageStatus.COMPLETED, completedQty: 100, rejectedQty: 0 },
      { id: 'fabric', type: ProductionStageType.FABRIC_PURCHASE, sequence: 2, status: ProductionStageStatus.PENDING, completedQty: 0, rejectedQty: 0 },
      { id: 'wash', type: ProductionStageType.WASHING_COMPACTING, sequence: 3, status: ProductionStageStatus.PENDING, completedQty: 0, rejectedQty: 0 },
    ], ProductionStageType.MASTER, 100);
    expect(transfer).toMatchObject({ stage: { id: 'fabric' }, data: { plannedQty: 100, issuedQty: 100, status: ProductionStageStatus.IN_PROGRESS } });
  });
});
