import mongoose from 'mongoose';
import slugify from 'slugify';
import Location from '../models/Location.js';
import Product from '../models/productModel.js';
import User from '../models/User.js';
import {
  cleanPincode,
  findLocationByPincode,
  isLocationPricingEnabled,
  publicLocation
} from '../services/locationService.js';
import { resolvePrice } from '../services/locationPricing.js';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const parsePincodes = (input) => {
  let list = input;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = list.split(/[\s,]+/); }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(cleanPincode).filter(Boolean))];
};

// Pincodes that already belong to another location (one pincode → one location)
const findPincodeConflicts = async (pincodes, excludeId) => {
  if (!pincodes.length) return [];
  const others = await Location.find({
    pincodes: { $in: pincodes },
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  }).select('name pincodes').lean();
  const conflicts = [];
  for (const other of others) {
    for (const pin of other.pincodes) {
      if (pincodes.includes(pin)) conflicts.push(`${pin} (${other.name})`);
    }
  }
  return conflicts;
};

const validateBody = async (body, existingId) => {
  const name = (body.name ?? '').toString().trim();
  if (!name) return { error: 'Location name is required' };

  const pincodes = parsePincodes(body.pincodes);
  const bad = pincodes.filter(p => p.length !== 6);
  if (bad.length) return { error: `Invalid pincode(s): ${bad.join(', ')}. Pincodes must be 6 digits.` };

  const conflicts = await findPincodeConflicts(pincodes, existingId);
  if (conflicts.length) return { error: `These pincodes already belong to another location: ${conflicts.join(', ')}` };

  const slug = slugify(body.slug || name, { lower: true, strict: true });
  if (!slug) return { error: 'Location name must contain letters or numbers' };
  // Don't rely only on the database index for duplicates ("Trichy" = "trichy")
  const taken = await Location.exists({ slug, ...(existingId ? { _id: { $ne: existingId } } : {}) });
  if (taken) return { error: 'A location with this name already exists' };

  const data = { name, slug, pincodes };
  if (body.isActive !== undefined) data.isActive = !(body.isActive === false || body.isActive === 'false');
  if (body.sortOrder !== undefined && !isNaN(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);
  return { data };
};

const duplicateKeyMessage = (error) =>
  error?.code === 11000 ? 'A location with this name already exists' : null;

// ============ PUBLIC ============

// GET /api/locations — active locations for the "Select your location" screen
export const getPublicLocations = async (request, reply) => {
  try {
    const locations = await Location.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    return reply.send({
      success: true,
      enabled: isLocationPricingEnabled(),
      data: locations.map(publicLocation)
    });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /api/locations/resolve?pincode=630001 — which location serves this pincode
export const resolvePincode = async (request, reply) => {
  try {
    const pincode = cleanPincode(request.query.pincode);
    if (pincode.length !== 6) {
      return reply.status(400).send({ success: false, code: 'INVALID_PINCODE', message: 'Please enter a valid 6-digit pincode' });
    }
    const location = await findLocationByPincode(pincode);
    if (!location) {
      return reply.status(404).send({
        success: false,
        code: 'NOT_SERVICEABLE',
        message: `Sorry, we don't deliver to ${pincode} yet`
      });
    }
    return reply.send({ success: true, enabled: isLocationPricingEnabled(), data: { ...publicLocation(location), pincode } });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ============ CUSTOMER (logged in) ============

// PUT /api/auth/location  { pincode, place } — save the customer's location to their account
export const saveMyLocation = async (request, reply) => {
  try {
    const userId = request.user?.userId || request.user?.id;
    const { pincode: rawPincode, place } = request.body || {};
    const pincode = cleanPincode(rawPincode);
    if (pincode.length !== 6) {
      return reply.status(400).send({ success: false, code: 'INVALID_PINCODE', message: 'Please enter a valid 6-digit pincode' });
    }
    if (!place || !String(place).trim()) {
      return reply.status(400).send({ success: false, message: 'Place / area is required' });
    }
    const location = await findLocationByPincode(pincode);
    if (!location) {
      return reply.status(404).send({ success: false, code: 'NOT_SERVICEABLE', message: `Sorry, we don't deliver to ${pincode} yet` });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { savedLocation: { location: location._id, pincode, place: String(place).trim().slice(0, 120) } } },
      { new: true }
    );
    if (!user) return reply.status(404).send({ success: false, message: 'User not found' });

    return reply.send({
      success: true,
      data: { location: publicLocation(location), pincode, place: user.savedLocation.place }
    });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /api/auth/location — the customer's saved location (null if not set or no longer served)
export const getMyLocation = async (request, reply) => {
  try {
    const userId = request.user?.userId || request.user?.id;
    const user = await User.findById(userId).populate('savedLocation.location', 'name slug isActive').lean();
    if (!user) return reply.status(404).send({ success: false, message: 'User not found' });

    const saved = user.savedLocation;
    const loc = saved?.location;
    if (!loc || !loc.isActive) return reply.send({ success: true, data: null });

    return reply.send({ success: true, data: { location: publicLocation(loc), pincode: saved.pincode, place: saved.place } });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ============ ADMIN ============

// GET /api/admin/locations
export const adminListLocations = async (request, reply) => {
  try {
    const locations = await Location.find().sort({ sortOrder: 1, name: 1 }).lean();
    return reply.send({ success: true, enabled: isLocationPricingEnabled(), data: locations });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// POST /api/admin/locations  { name, pincodes: ["630001", ...], isActive?, sortOrder? }
export const adminCreateLocation = async (request, reply) => {
  try {
    const { data, error } = await validateBody(request.body || {});
    if (error) return reply.status(400).send({ success: false, message: error });
    const location = await Location.create(data);
    return reply.status(201).send({ success: true, message: 'Location created', data: location });
  } catch (error) {
    return reply.status(duplicateKeyMessage(error) ? 400 : 500)
      .send({ success: false, message: duplicateKeyMessage(error) || error.message });
  }
};

// PUT /api/admin/locations/:id
export const adminUpdateLocation = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid location ID' });
    const existing = await Location.findById(id);
    if (!existing) return reply.status(404).send({ success: false, message: 'Location not found' });

    const body = { name: existing.name, pincodes: existing.pincodes, slug: existing.slug, ...request.body };
    const { data, error } = await validateBody(body, id);
    if (error) return reply.status(400).send({ success: false, message: error });

    Object.assign(existing, data);
    await existing.save();
    return reply.send({ success: true, message: 'Location updated', data: existing });
  } catch (error) {
    return reply.status(duplicateKeyMessage(error) ? 400 : 500)
      .send({ success: false, message: duplicateKeyMessage(error) || error.message });
  }
};

// DELETE /api/admin/locations/:id — also removes this location's prices from every product.
// Prefer setting isActive=false to pause a location without losing its prices.
export const adminDeleteLocation = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid location ID' });
    const location = await Location.findByIdAndDelete(id);
    if (!location) return reply.status(404).send({ success: false, message: 'Location not found' });

    const locId = new mongoose.Types.ObjectId(id);
    await Product.updateMany({}, {
      $pull: { locationPrices: { location: locId }, 'variants.$[].locationPrices': { location: locId } }
    });
    return reply.send({ success: true, message: `Location "${location.name}" deleted` });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

const overrideOf = (entity, locId) => {
  const entry = (entity.locationPrices || []).find(lp => lp.location?.toString() === locId);
  return entry
    ? { price: entry.price ?? null, originalPrice: entry.originalPrice ?? null, isAvailable: entry.isAvailable !== false }
    : null;
};

// GET /api/admin/locations/:id/prices — every product & pack with its default and location price
export const adminGetLocationPrices = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid location ID' });
    const location = await Location.findById(id).lean();
    if (!location) return reply.status(404).send({ success: false, message: 'Location not found' });

    const products = await Product.find()
      .select('name sNo status basePrice originalPrice locationPrices variants category')
      .populate('category', 'name')
      .sort({ sNo: 1 })
      .lean();

    const data = products.map(p => {
      const productEntity = { price: p.basePrice, originalPrice: p.originalPrice, locationPrices: p.locationPrices };
      return {
        productId: p._id,
        sNo: p.sNo,
        name: p.name,
        category: p.category?.name || '',
        status: p.status,
        defaultPrice: p.basePrice,
        defaultOriginalPrice: p.originalPrice ?? null,
        override: overrideOf(p, id),
        effective: resolvePrice(productEntity, id),
        variants: (p.variants || []).map(v => ({
          variantId: v._id,
          variantName: v.variantName,
          status: v.status,
          defaultPrice: v.price,
          defaultOriginalPrice: v.originalPrice ?? null,
          override: overrideOf(v, id),
          effective: resolvePrice(v, id)
        }))
      };
    });

    return reply.send({ success: true, location: publicLocation(location), count: data.length, data });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

const applyOverride = (entity, locId, change) => {
  const list = (entity.locationPrices || []).filter(lp => lp.location?.toString() !== locId);
  const clear = change.clear === true || change.clear === 'true';
  const price = change.price === '' || change.price === null || change.price === undefined ? null : Number(change.price);
  const originalPrice = change.originalPrice === '' || change.originalPrice === null || change.originalPrice === undefined
    ? null : Number(change.originalPrice);
  const isAvailable = !(change.isAvailable === false || change.isAvailable === 'false');

  if (!clear && (price !== null || !isAvailable)) {
    list.push({ location: locId, price, originalPrice, isAvailable });
  }
  entity.locationPrices = list;
};

// PUT /api/admin/locations/:id/prices
// { items: [{ productId, variantId?, price?, originalPrice?, isAvailable?, clear? }] }
//   variantId omitted → product-level (card) price; clear=true → back to the default price
export const adminUpdateLocationPrices = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid location ID' });
    const location = await Location.findById(id).lean();
    if (!location) return reply.status(404).send({ success: false, message: 'Location not found' });

    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    if (!items.length) return reply.status(400).send({ success: false, message: 'No price changes sent' });

    // Validate everything before saving anything
    for (const [i, item] of items.entries()) {
      if (!isValidId(item.productId)) return reply.status(400).send({ success: false, message: `Row ${i + 1}: invalid product` });
      for (const field of ['price', 'originalPrice']) {
        const v = item[field];
        if (v !== undefined && v !== null && v !== '' && (isNaN(Number(v)) || Number(v) < 0)) {
          return reply.status(400).send({ success: false, message: `Row ${i + 1}: ${field} must be a number ≥ 0` });
        }
      }
    }

    const productIds = [...new Set(items.map(i => String(i.productId)))];
    const products = await Product.find({ _id: { $in: productIds } });
    const byId = new Map(products.map(p => [p._id.toString(), p]));

    const notFound = [];
    const touchedProducts = new Set();
    const touchedVariants = new Map(); // "productId:variantId" → { product, variant }
    for (const item of items) {
      const product = byId.get(String(item.productId));
      if (!product) { notFound.push(item.productId); continue; }
      if (item.variantId) {
        const variant = product.variants.find(v => v._id.toString() === String(item.variantId));
        if (!variant) { notFound.push(`${product.name} / ${item.variantId}`); continue; }
        applyOverride(variant, id, item);
        touchedVariants.set(`${product._id}:${variant._id}`, { product, variant });
      } else {
        applyOverride(product, id, item);
        touchedProducts.add(product);
      }
    }
    if (notFound.length) {
      return reply.status(400).send({ success: false, message: `Not found: ${notFound.join(', ')}. Nothing was saved.` });
    }

    // Write only the price lists — never the whole variants array, so stock changed by
    // orders placed at the same moment is not overwritten (and slug/stock hooks are skipped)
    const plain = (list) => (list || []).map(lp => (lp.toObject ? lp.toObject() : lp));
    const ops = [
      ...[...touchedProducts].map(p => ({
        updateOne: { filter: { _id: p._id }, update: { $set: { locationPrices: plain(p.locationPrices) } } }
      })),
      ...[...touchedVariants.values()].map(({ product, variant }) => ({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { 'variants.$[v].locationPrices': plain(variant.locationPrices) } },
          arrayFilters: [{ 'v._id': variant._id }]
        }
      }))
    ];
    await Product.bulkWrite(ops);

    return reply.send({ success: true, message: `Prices saved for ${location.name}`, updatedProducts: products.length });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ============ APP VERSION ============

const versionLess = (a, b) => {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
};

// GET /api/app/version-check?platform=android&version=1.4.0
// New app builds call this on start and block with an "Update" screen when forceUpdate is true.
export const appVersionCheck = async (request, reply) => {
  const platform = request.query.platform === 'ios' ? 'ios' : 'android';
  const minVersion = platform === 'ios' ? process.env.MIN_APP_VERSION_IOS : process.env.MIN_APP_VERSION_ANDROID;
  const storeUrl = platform === 'ios' ? process.env.APP_STORE_URL_IOS : process.env.APP_STORE_URL_ANDROID;
  const forceUpdate = Boolean(minVersion) && versionLess(request.query.version, minVersion);
  return reply.send({
    success: true,
    forceUpdate,
    minVersion: minVersion || null,
    storeUrl: storeUrl || null,
    message: forceUpdate ? 'A new version of the app is available. Please update to continue.' : null
  });
};

export const _test = { versionLess, parsePincodes, applyOverride };
