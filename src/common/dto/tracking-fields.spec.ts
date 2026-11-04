import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { InvoiceItemDto } from '../../invoices/dto/invoice-item.dto.js';
import { trackingFields } from './tracking-fields.dto.js';

describe('reference tracking fields', () => {
  it('accepts tracking fields through inherited DTO validation and preserves decimal values', async () => {
    const dto = plainToInstance(InvoiceItemDto, { description: 'Cotton shirt', quantity: 2, unitPrice: 100, brand: 'IMC', lotNo: 'LOT-7', barcode: '8901234', serialNumbers: 'A1,A2', count: 2.125, mrp: 199.99, size: 'M' });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(trackingFields({ ...dto, count: new Prisma.Decimal('2.125'), mrp: new Prisma.Decimal('199.99') })).toMatchObject({ count: 2.125, mrp: 199.99, brand: 'IMC', lotNo: 'LOT-7', size: 'M' });
  });
  it('rejects negative, excessive and over-precise metadata without treating it as price or quantity', async () => {
    const dto = plainToInstance(InvoiceItemDto, { description: 'Shirt', quantity: 1, unitPrice: 100, count: -1, mrp: 1.123, brand: 'x'.repeat(121) });
    const errors = await validate(dto);
    expect(errors.map(e => e.property).sort()).toEqual(['brand', 'count', 'mrp']);
  });
  it('omits absent legacy fields rather than overwriting them with zero', () => {
    expect(trackingFields({})).toEqual({});
    expect(trackingFields({ mrp: null, count: null })).toEqual({});
  });
});
