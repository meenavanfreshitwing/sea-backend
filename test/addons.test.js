import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAddonAvailable, groupByCategory, addonsTotal } from '../services/addonService.js';
import { buildDeliverySummary } from '../services/deliverySummary.js';

const marination = { _id: 'c1', name: 'Marination', isActive: true, sortOrder: 1 };
const curry = { _id: 'c2', name: 'Curry Masala', isActive: true, sortOrder: 0 };
const addon = (over = {}) => ({ _id: 'a1', name: 'Fish Fry Masala', price: 30, stock: 10, isActive: true, category: marination, ...over });

test('add-on shows only when ON, its category ON and in stock', () => {
  assert.equal(isAddonAvailable(addon()), true);
  assert.equal(isAddonAvailable(addon({ isActive: false })), false);
  assert.equal(isAddonAvailable(addon({ category: { ...marination, isActive: false } })), false);
  assert.equal(isAddonAvailable(addon({ stock: 0 })), false);
  assert.equal(isAddonAvailable(null), false);
});

test('checkout list is grouped by category in admin order', () => {
  const groups = groupByCategory([
    addon(),
    addon({ _id: 'a2', name: 'Prawn Masala', price: 35 }),
    addon({ _id: 'a3', name: 'Fish Curry Masala', price: 40, category: curry })
  ]);
  assert.deepEqual(groups.map(g => g.category.name), ['Curry Masala', 'Marination']);
  assert.deepEqual(groups[1].addons.map(a => a.name), ['Fish Fry Masala', 'Prawn Masala']);
  assert.equal(groups[1].addons[0].isActive, undefined); // admin-only fields not sent
});

test('add-ons total', () => {
  assert.equal(addonsTotal([{ price: 30, quantity: 2 }, { price: 35, quantity: 1 }]), 95);
  assert.equal(addonsTotal([]), 0);
});

test('delivery summary counts masala packets per day', () => {
  const order = (id, date, addons) => ({
    orderId: id, deliveryDate: date, orderStatus: 'confirmed', paymentMethod: 'cod', paymentStatus: 'pending',
    finalAmount: 100, products: [], addons
  });
  const summary = buildDeliverySummary([
    order('A', '2026-11-20', [{ name: 'Fish Fry Masala', quantity: 2 }]),
    order('B', '2026-11-20', [{ name: 'Fish Fry Masala', quantity: 1 }, { name: 'Prawn Masala', quantity: 1 }]),
    order('C', '2026-11-21', [{ name: 'Prawn Masala', quantity: 3 }])
  ]);
  assert.deepEqual(summary.dates[0].addons, [{ name: 'Fish Fry Masala', quantity: 3 }, { name: 'Prawn Masala', quantity: 1 }]);
  assert.deepEqual(summary.overall.addons, [{ name: 'Prawn Masala', quantity: 4 }, { name: 'Fish Fry Masala', quantity: 3 }]);
});
