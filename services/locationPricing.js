// services/locationPricing.js
// Pure helpers (no database) that turn a product's default prices into the
// prices for one location. A location without an override uses the default price.

const idOf = (value) => (value && value._id ? value._id : value)?.toString?.() ?? null;

export const discountPercent = (price, originalPrice) =>
  originalPrice > price && originalPrice > 0
    ? Math.round(((originalPrice - price) / originalPrice) * 100)
    : 0;

/**
 * Resolve the price of a priced thing (a variant, or the product itself) for a location.
 * @param {{price:number, originalPrice?:number, locationPrices?:Array}} entity
 * @param {string|ObjectId|null} locationId
 * @returns {{price:number, originalPrice:number, isAvailable:boolean, overridden:boolean}}
 */
export const resolvePrice = (entity, locationId) => {
  const defaultPrice = Number(entity?.price) || 0;
  const defaultOriginal = Number(entity?.originalPrice) || defaultPrice;
  const result = { price: defaultPrice, originalPrice: defaultOriginal, isAvailable: true, overridden: false };

  const locId = idOf(locationId);
  if (!locId) return result;

  const entry = (entity?.locationPrices || []).find(lp => idOf(lp.location) === locId);
  if (!entry) return result;

  result.isAvailable = entry.isAvailable !== false;
  if (entry.price !== null && entry.price !== undefined && !isNaN(Number(entry.price))) {
    result.price = Number(entry.price);
    // No MRP given for this location → show no strike-through price
    const original = Number(entry.originalPrice);
    result.originalPrice = original > 0 ? original : result.price;
    result.overridden = true;
  }
  return result;
};

/** Find a product's variant by id, then by name (packs re-created by an admin edit keep their name). */
export const findVariant = (product, variantId, variantName) => {
  const variants = product?.variants || [];
  if (!variants.length) return null;
  if (variantId && variantId !== 'null' && variantId !== 'undefined') {
    const byId = variants.find(v => v._id?.toString() === String(variantId));
    if (byId) return byId;
    const byName = variants.find(v => v.variantName === variantId);
    if (byName) return byName;
  }
  if (variantName) return variants.find(v => v.variantName === variantName) || null;
  return null;
};

/** Price of one product (+ optional variant) for a location — used by cart and orders. */
export const resolveItemPrice = (product, variant, locationId) =>
  variant
    ? resolvePrice(variant, locationId)
    : resolvePrice({ price: product.basePrice, originalPrice: product.originalPrice, locationPrices: product.locationPrices }, locationId);

/**
 * Return a plain product object priced for a location (for customer-facing APIs).
 * - variant prices replaced by the location price, unavailable variants removed
 * - basePrice/originalPrice (shown on product cards) follow the product-level override,
 *   otherwise the default pack's location price
 * - isAvailableInLocation=false when the product cannot be bought there
 * - per-location price lists are removed from the response
 */
export const applyLocationToProduct = (product, locationId) => {
  const p = typeof product?.toObject === 'function' ? product.toObject() : { ...product };
  if (!idOf(locationId)) return p;

  const hadVariants = Array.isArray(p.variants) && p.variants.length > 0;
  const variants = (p.variants || [])
    .map(v => {
      const r = resolvePrice(v, locationId);
      const { locationPrices, ...rest } = v;
      return {
        ...rest,
        price: r.price,
        originalPrice: r.originalPrice,
        discountPercentage: r.overridden ? discountPercent(r.price, r.originalPrice) : v.discountPercentage,
        _available: r.isAvailable,
        _overridden: r.overridden
      };
    })
    .filter(v => v._available);

  const productLevel = resolvePrice(
    { price: p.basePrice, originalPrice: p.originalPrice, locationPrices: p.locationPrices },
    locationId
  );

  let { basePrice, originalPrice, discountPercentage, hasOffer } = p;
  if (productLevel.overridden) {
    basePrice = productLevel.price;
    originalPrice = productLevel.originalPrice;
  } else {
    const defaultVariant = variants.find(v => v.isDefault) || variants[0];
    if (defaultVariant?._overridden) {
      basePrice = defaultVariant.price;
      originalPrice = defaultVariant.originalPrice;
    }
  }
  if (basePrice !== p.basePrice || originalPrice !== p.originalPrice) {
    discountPercentage = discountPercent(basePrice, originalPrice);
    hasOffer = discountPercentage > 0;
  }

  const isAvailableInLocation = productLevel.isAvailable && (!hadVariants || variants.length > 0);
  const { locationPrices, ...rest } = p;

  return {
    ...rest,
    basePrice,
    originalPrice,
    discountPercentage,
    hasOffer,
    variants: variants.map(({ _available, _overridden, ...v }) => v),
    isAvailableInLocation
  };
};

/**
 * Price a list of products for a location. Products not sold there are dropped.
 * Without a location the list is returned unchanged (admin panel / old apps).
 */
export const applyLocationToProducts = (products, locationId) => {
  if (!idOf(locationId)) return products;
  return products
    .map(p => applyLocationToProduct(p, locationId))
    .filter(p => p.isAvailableInLocation);
};

/**
 * Clean location prices sent by the admin panel.
 * Keeps valid ids only, one entry per location, numbers ≥ 0. A missing price means
 * "use the default price" (useful to only hide a product with isAvailable=false).
 */
export const normalizeLocationPrices = (input, isValidId) => {
  let list = input;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const location = idOf(raw?.location);
    if (!location || !isValidId(location) || seen.has(location)) continue;
    const price = raw.price === '' || raw.price === null || raw.price === undefined ? null : Number(raw.price);
    const originalPrice = raw.originalPrice === '' || raw.originalPrice === null || raw.originalPrice === undefined
      ? null : Number(raw.originalPrice);
    if (price !== null && (isNaN(price) || price < 0)) continue;
    const isAvailable = !(raw.isAvailable === false || raw.isAvailable === 'false');
    // An entry with no price that is still available changes nothing — skip it
    if (price === null && isAvailable) continue;
    seen.add(location);
    out.push({
      location,
      price,
      originalPrice: originalPrice !== null && !isNaN(originalPrice) && originalPrice >= 0 ? originalPrice : null,
      isAvailable
    });
  }
  return out;
};
