// services/locationService.js
// Database helpers for delivery locations.
import mongoose from 'mongoose';
import Location from '../models/Location.js';

// Launch switch: admins can add locations and prices before customers see them.
export const isLocationPricingEnabled = () => process.env.LOCATION_PRICING_ENABLED === 'true';

// When true, orders from apps that don't send a location (old installs) are refused
// with an "update the app" message. Turn on once the new app is live in the stores.
export const isLocationRequiredForOrders = () => process.env.LOCATION_REQUIRED_FOR_ORDERS === 'true';

export const publicLocation = (loc) => loc ? { _id: loc._id, name: loc.name, slug: loc.slug } : null;

export const cleanPincode = (value) => String(value ?? '').replace(/\D/g, '');

/** Active location by id or slug, or null. */
export const findActiveLocation = async (idOrSlug) => {
  if (!idOrSlug) return null;
  const key = String(idOrSlug).trim();
  if (!key) return null;
  const filter = mongoose.Types.ObjectId.isValid(key) && key.length === 24
    ? { _id: key, isActive: true }
    : { slug: key.toLowerCase(), isActive: true };
  return Location.findOne(filter).lean();
};

/** Active location that covers a pincode, or null (= we don't deliver there). */
export const findLocationByPincode = async (pincode) => {
  const pin = cleanPincode(pincode);
  if (pin.length !== 6) return null;
  return Location.findOne({ pincodes: pin, isActive: true }).lean();
};

/**
 * The location the customer selected, sent by the website/app as
 * `?location=<slug|id>`, the `X-Location` header, or `location` in the JSON body.
 * Returns null when location pricing is off or nothing valid was sent.
 */
export const getRequestLocation = async (request) => {
  if (!isLocationPricingEnabled()) return null;
  const sent = request.query?.location || request.headers?.['x-location'] ||
    (typeof request.body?.location === 'string' ? request.body.location : null);
  return findActiveLocation(sent);
};

/**
 * Location an order is priced for. The delivery pincode decides — never the price the app sent.
 * - pincode not served                       → NOT_SERVICEABLE
 * - app sent no location (old install)        → priced by pincode, or APP_UPDATE_REQUIRED
 *                                               when LOCATION_REQUIRED_FOR_ORDERS=true
 * - app's selected location ≠ address location → LOCATION_MISMATCH (app switches location,
 *                                               reloads the cart with new prices, retries)
 */
export const resolveOrderLocation = async (request, postalCode) => {
  const pin = cleanPincode(postalCode);
  const pinLocation = await findLocationByPincode(pin);
  if (!pinLocation) {
    return { ok: false, status: 400, code: 'NOT_SERVICEABLE', message: `Sorry, we don't deliver to pincode ${pin || postalCode} yet` };
  }
  if (!requestSentLocation(request)) {
    if (isLocationRequiredForOrders()) {
      return {
        ok: false, status: 400, code: 'APP_UPDATE_REQUIRED',
        message: 'Please update the Meenavan app to the latest version to place your order.'
      };
    }
    return { ok: true, location: pinLocation };
  }
  const selected = await getRequestLocation(request);
  if (!selected || String(selected._id) !== String(pinLocation._id)) {
    return {
      ok: false, status: 409, code: 'LOCATION_MISMATCH',
      message: `Your delivery address is in ${pinLocation.name}. Prices have been updated for ${pinLocation.name} — please check your cart and place the order again.`,
      location: publicLocation(pinLocation)
    };
  }
  return { ok: true, location: pinLocation };
};

/** Did the client send any location at all (valid or not)? Old apps never do. */
export const requestSentLocation = (request) =>
  Boolean(request.query?.location || request.headers?.['x-location'] ||
    (typeof request.body?.location === 'string' && request.body.location));
