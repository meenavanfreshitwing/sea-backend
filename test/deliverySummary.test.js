import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverySummary, isCountableOrder, weightFromPackName } from '../services/deliverySummary.js';

const order = (orderId, deliveryDate, products, extra = {}) => ({
  orderId, deliveryDate, products,
  orderStatus: 'confirmed', paymentMethod: 'cod', paymentStatus: 'pending', finalAmount: 100,
  ...extra,
});
const line = (product, name, variantName, weight, weightUnit, quantity, variantId) =>
  ({ product, name, variantName, weight, weightUnit, quantity, variantId });

test('adds up kg per fish and per date, with pack breakdown', () => {
  const summary = buildDeliverySummary([
    order('A', '2026-10-14', [line('seer', 'Seer', '1 kg', 1000, 'gram', 2), line('prawn', 'Prawns', '500 g', 500, 'gram', 1)]),
    order('B', '2026-10-14', [line('seer', 'Seer', '500 g', 500, 'gram', 3)]),
    order('C', '2026-10-15', [line('seer', 'Seer', '1 kg', 1, 'kg', 1)]),
  ]);

  const day1 = summary.dates.find(d => d.date === '2026-10-14');
  assert.equal(day1.orderCount, 2);
  assert.equal(day1.totalKg, 4);
  const seer = day1.products.find(p => p.name === 'Seer');
  assert.equal(seer.totalKg, 3.5);
  assert.equal(seer.orderCount, 2);
  assert.deepEqual(seer.packs, [{ label: '1 kg', qty: 2 }, { label: '500 g', qty: 3 }]);

  assert.equal(summary.overall.totalKg, 5);
  assert.equal(summary.overall.products[0].name, 'Seer');
  assert.equal(summary.overall.products[0].totalKg, 4.5);
  assert.equal(summary.overall.orderCount, 3);
});

test('leaves out cancelled orders and unpaid online orders', () => {
  assert.equal(isCountableOrder({ orderStatus: 'cancelled', paymentMethod: 'cod' }), false);
  assert.equal(isCountableOrder({ orderStatus: 'pending', paymentMethod: 'razorpay', paymentStatus: 'pending' }), false);
  assert.equal(isCountableOrder({ orderStatus: 'confirmed', paymentMethod: 'razorpay', paymentStatus: 'completed' }), true);

  const summary = buildDeliverySummary([
    order('A', '2026-10-14', [line('seer', 'Seer', '1 kg', 1000, 'gram', 1)], { orderStatus: 'cancelled' }),
    order('B', '2026-10-14', [line('seer', 'Seer', '1 kg', 1000, 'gram', 1)], { paymentMethod: 'razorpay', paymentStatus: 'failed' }),
    order('C', '2026-10-14', [line('seer', 'Seer', '1 kg', 1000, 'gram', 1)], { paymentMethod: 'razorpay', paymentStatus: 'completed', finalAmount: 650 }),
  ]);
  assert.equal(summary.dates[0].orderCount, 1);
  assert.equal(summary.dates[0].totalKg, 1);
  assert.equal(summary.dates[0].paidOnline, 650);
  assert.equal(summary.dates[0].cashToCollect, 0);
});

test('pieces stay separate and missing weights are counted, not hidden', () => {
  const summary = buildDeliverySummary([
    order('A', '2026-10-14', [line('crab', 'Crab', '2 pcs', 2, 'piece', 3), line('sura', 'Sura', 'Pack 1', 0, 'gram', 2)]),
  ]);
  const crab = summary.dates[0].products.find(p => p.name === 'Crab');
  assert.equal(crab.pieces, 6);
  assert.equal(crab.totalKg, 0);
  const sura = summary.dates[0].products.find(p => p.name === 'Sura');
  assert.equal(sura.noWeightQty, 2);
});

test('old orders without a stored weight use the pack weight of the product', () => {
  const products = new Map([['seer', { name: 'Seer Fish', variants: [{ _id: 'v1', variantName: '1 kg', weight: 1000, weightUnit: 'gram' }] }]]);
  const summary = buildDeliverySummary([
    order('A', '2026-10-14', [line('seer', 'Seer', '1 kg', 0, 'gram', 2, 'v1')]),
  ], products);
  const seer = summary.dates[0].products[0];
  assert.equal(seer.name, 'Seer Fish');
  assert.equal(seer.totalKg, 2);
  assert.equal(seer.noWeightQty, 0);
});

test('reads the weight from the pack name when no weight is set', () => {
  assert.deepEqual(weightFromPackName('500g'), { weight: 500, unit: 'gram' });
  assert.deepEqual(weightFromPackName('1 kg'), { weight: 1000, unit: 'gram' });
  assert.deepEqual(weightFromPackName('1.5Kg pack'), { weight: 1500, unit: 'gram' });
  assert.deepEqual(weightFromPackName('750 gm'), { weight: 750, unit: 'gram' });
  assert.deepEqual(weightFromPackName('2 pcs'), { weight: 2, unit: 'piece' });
  assert.equal(weightFromPackName('Pack 1'), null);

  const summary = buildDeliverySummary([
    order('A', '2026-10-13', [line('sura', 'Sura', '500g', 0, 'gram', 2)]),
  ]);
  assert.equal(summary.dates[0].products[0].totalKg, 1);
  assert.equal(summary.dates[0].products[0].noWeightQty, 0);
});
