import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePrice,
  resolveItemPrice,
  findVariant,
  applyLocationToProduct,
  applyLocationToProducts,
  normalizeLocationPrices
} from '../services/locationPricing.js';
import { _test as locationControllerInternals } from '../controllers/locationController.js';

const TRICHY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const KARAIKUDI = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const PUDUKKOTTAI = 'cccccccccccccccccccccccc';

const seer = () => ({
  _id: 'p1',
  name: 'Seer Fish',
  basePrice: 300,
  originalPrice: 350,
  discountPercentage: 14,
  hasOffer: true,
  locationPrices: [],
  variants: [
    {
      _id: 'v500', variantName: '500 g', price: 300, originalPrice: 350, isDefault: true,
      locationPrices: [
        { location: TRICHY, price: 320, originalPrice: 380, isAvailable: true },
        { location: KARAIKUDI, price: 280, originalPrice: null, isAvailable: true }
      ]
    },
    {
      _id: 'v1kg', variantName: '1 kg', price: 580, originalPrice: 650,
      locationPrices: [{ location: KARAIKUDI, price: null, isAvailable: false }]
    }
  ]
});

test('no location or no override → default price', () => {
  const v = seer().variants[0];
  assert.deepEqual(resolvePrice(v, null), { price: 300, originalPrice: 350, isAvailable: true, overridden: false });
  assert.equal(resolvePrice(v, PUDUKKOTTAI).price, 300);
});

test('location override replaces price; missing MRP means no strike-through', () => {
  const v = seer().variants[0];
  assert.deepEqual(resolvePrice(v, TRICHY), { price: 320, originalPrice: 380, isAvailable: true, overridden: true });
  assert.deepEqual(resolvePrice(v, KARAIKUDI), { price: 280, originalPrice: 280, isAvailable: true, overridden: true });
});

test('isAvailable=false without a price hides the pack but keeps default price', () => {
  const r = resolvePrice(seer().variants[1], KARAIKUDI);
  assert.equal(r.isAvailable, false);
  assert.equal(r.price, 580);
});

test('applyLocationToProduct: card price follows default pack, hidden packs removed', () => {
  const p = applyLocationToProduct(seer(), KARAIKUDI);
  assert.equal(p.basePrice, 280);
  assert.equal(p.originalPrice, 280);
  assert.equal(p.hasOffer, false);
  assert.equal(p.variants.length, 1);
  assert.equal(p.variants[0].variantName, '500 g');
  assert.equal(p.variants[0].locationPrices, undefined);
  assert.equal(p.locationPrices, undefined);
  assert.equal(p.isAvailableInLocation, true);

  const t = applyLocationToProduct(seer(), TRICHY);
  assert.equal(t.basePrice, 320);
  assert.equal(t.originalPrice, 380);
  assert.equal(t.discountPercentage, 16);
  assert.equal(t.variants.length, 2);
  assert.equal(t.variants[1].price, 580);
});

test('product-level override wins for the card price', () => {
  const product = { ...seer(), locationPrices: [{ location: TRICHY, price: 299, originalPrice: 399 }] };
  assert.equal(applyLocationToProduct(product, TRICHY).basePrice, 299);
});

test('products not sold in a location are dropped from lists', () => {
  const hiddenEverywhere = {
    ...seer(),
    variants: seer().variants.map(v => ({ ...v, locationPrices: [{ location: PUDUKKOTTAI, isAvailable: false }] }))
  };
  const noPacksHidden = { _id: 'p2', name: 'Crab', basePrice: 400, variants: [], locationPrices: [{ location: PUDUKKOTTAI, isAvailable: false }] };
  const list = applyLocationToProducts([seer(), hiddenEverywhere, noPacksHidden], PUDUKKOTTAI);
  assert.deepEqual(list.map(p => p._id), ['p1']);
  // no location → list unchanged (admin panel / old apps)
  assert.equal(applyLocationToProducts([seer(), hiddenEverywhere], null).length, 2);
});

test('resolveItemPrice handles products without packs', () => {
  const crab = { basePrice: 400, originalPrice: 450, locationPrices: [{ location: TRICHY, price: 420 }] };
  assert.equal(resolveItemPrice(crab, null, TRICHY).price, 420);
  assert.equal(resolveItemPrice(crab, null, KARAIKUDI).price, 400);
});

test('findVariant matches by id, then by name', () => {
  const p = seer();
  assert.equal(findVariant(p, 'v1kg').variantName, '1 kg');
  assert.equal(findVariant(p, 'gone', '500 g')._id, 'v500');
  assert.equal(findVariant(p, '500 g')._id, 'v500');
  assert.equal(findVariant(p, 'gone', 'gone'), null);
});

test('normalizeLocationPrices cleans admin input', () => {
  const valid = (id) => /^[a-f0-9]{24}$/.test(id);
  const out = normalizeLocationPrices(JSON.stringify([
    { location: TRICHY, price: '320', originalPrice: '' },
    { location: TRICHY, price: 999 },                 // duplicate → ignored
    { location: 'bad', price: 10 },                   // invalid id → ignored
    { location: KARAIKUDI, price: -5 },               // negative → ignored
    { location: PUDUKKOTTAI, price: '', isAvailable: 'false' }, // hide only
    { location: 'dddddddddddddddddddddddd', price: '' } // nothing to change → ignored
  ]), valid);
  assert.deepEqual(out, [
    { location: TRICHY, price: 320, originalPrice: null, isAvailable: true },
    { location: PUDUKKOTTAI, price: null, originalPrice: null, isAvailable: false }
  ]);
  assert.deepEqual(normalizeLocationPrices('not json', valid), []);
});

test('app version compare and pincode parsing', () => {
  const { versionLess, parsePincodes } = locationControllerInternals;
  assert.equal(versionLess('1.4.0', '1.5.0'), true);
  assert.equal(versionLess('1.10.0', '1.9.0'), false);
  assert.equal(versionLess('1.5', '1.5.0'), false);
  assert.equal(versionLess(undefined, '1.0.0'), true);
  assert.deepEqual(parsePincodes('630001, 630002\n630001'), ['630001', '630002']);
  assert.deepEqual(parsePincodes(['630 001', '62001']), ['630001', '62001']);
});
