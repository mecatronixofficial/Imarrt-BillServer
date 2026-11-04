import { describe, expect, it } from 'vitest';
import { buildThermalHtml, thermalWidth, taxBreakup, type PrintModel } from './pdf.service.js';
import { resolvePreferences } from '../businesses/business-preferences.js';
const model:PrintModel={invoiceLike:true,sale:true,nameKey:'saleInvoice',number:'INV-1',status:'PARTIALLY_PAID',issueDate:'2026-10-31',logistics:[],business:{name:'Company',gstRegistered:true},party:{name:'<script>bad</script>'},partyLabel:'billedTo',lines:[{description:'Item',quantity:1,unitPrice:100,taxRate:18,taxInclusive:true,lineTotal:100}],subTotal:84.75,taxTotal:15.25,discount:0,grandTotal:100,paid:40,paymentMode:'cash'};
describe('thermal receipt output',()=>{
 it('uses actual totals, escapes party data, repeats requested copies and supports 58/80mm widths',()=>{
  const preferences=resolvePreferences({printThermal:{pageSize:'3in',numberOfCopies:2}});
  const html=buildThermalHtml(model,preferences);
  expect(thermalWidth(preferences)).toBe(80);expect(thermalWidth(resolvePreferences({}))).toBe(58);
  expect(html.match(/<article\b/g)).toHaveLength(2);expect(html).toContain('60.00');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
 });
 it('does not tax inclusive prices twice in the tax summary',()=>{
  const rows=taxBreakup(model,'igst');expect(rows).toEqual([{kind:'igst',rate:18,amount:15.25}]);
 });
});

describe('printed adjusted balances',()=>{it('shows the net pending amount after credit notes',()=>{const out=buildThermalHtml({...model,creditAmount:20,balanceDue:40},resolvePreferences({}));expect(out).toContain('Credit / debit adjustments');expect(out).not.toContain('60.00');expect(out).toContain('40.00');});});
