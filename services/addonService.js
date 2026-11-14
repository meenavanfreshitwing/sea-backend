// services/addonService.js — rules for add-ons in carts and orders
import mongoose from 'mongoose';
import Addon from '../models/Addon.js';

// Shown at checkout only when: add-on ON, its category ON, and in stock
export const isAddonAvailable = (addon) =>
  Boolean(addon && addon.isActive && addon.category && addon.category.isActive !== false && addon.stock > 0);

/** Add-ons customers can pick now, with their category, sorted for display. */
export const findAvailableAddons = async () => {
  const addons = await Addon.find({ isActive: true, stock: { $gt: 0 } })
    .populate('category', 'name isActive sortOrder')
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return addons.filter(isAddonAvailable);
};

/** Group add-ons by category for the checkout page. */
export const groupByCategory = (addons) => {
  const groups = new Map();
  for (const a of addons) {
    const key = a.category._id.toString();
    if (!groups.has(key)) {
      groups.set(key, { category: { _id: a.category._id, name: a.category.name, sortOrder: a.category.sortOrder || 0 }, addons: [] });
    }
    groups.get(key).addons.push({
      _id: a._id, name: a.name, description: a.description, price: a.price, image: a.image, stock: a.stock
    });
  }
  return [...groups.values()].sort((x, y) => x.category.sortOrder - y.category.sortOrder || x.category.name.localeCompare(y.category.name));
};

/**
 * Turn requested add-ons [{ addon|addonId, quantity }] into order lines priced from the database.
 * Returns { lines } or { error, code } if one is off, out of stock or doesn't exist.
 */
export const priceAddonLines = async (requested) => {
  const wanted = new Map();
  for (const r of requested || []) {
    const id = String(r?.addon?._id || r?.addon || r?.addonId || '');
    const qty = parseInt(r?.quantity, 10);
    if (!mongoose.Types.ObjectId.isValid(id) || !(qty > 0)) continue;
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (!wanted.size) return { lines: [] };

  const addons = await Addon.find({ _id: { $in: [...wanted.keys()] } }).populate('category', 'name isActive').lean();
  const byId = new Map(addons.map(a => [a._id.toString(), a]));

  const lines = [];
  for (const [id, quantity] of wanted) {
    const addon = byId.get(id);
    if (!isAddonAvailable(addon)) {
      return { code: 'ADDON_UNAVAILABLE', error: `${addon?.name || 'An add-on'} is no longer available. Please remove it and try again.` };
    }
    if (addon.stock < quantity) {
      return { code: 'ADDON_OUT_OF_STOCK', error: `Only ${addon.stock} ${addon.name} left. Please reduce the quantity.` };
    }
    lines.push({
      addon: addon._id,
      name: addon.name,
      categoryName: addon.category.name,
      price: addon.price,
      quantity,
      image: addon.image || null
    });
  }
  return { lines };
};

export const addonsTotal = (lines) => (lines || []).reduce((sum, l) => sum + (l.price * l.quantity), 0);

/** Take add-on packets out of stock (never below 0). */
export const reduceAddonStock = async (lines) => {
  for (const l of lines || []) {
    if (!l?.addon || !(l.quantity > 0)) continue;
    await Addon.updateOne({ _id: l.addon }, { $inc: { stock: -l.quantity } });
    await Addon.updateOne({ _id: l.addon, stock: { $lt: 0 } }, { $set: { stock: 0 } });
  }
};

/** Put add-on packets back (order cancelled). */
export const restoreAddonStock = async (lines) => {
  for (const l of lines || []) {
    if (!l?.addon || !(l.quantity > 0)) continue;
    await Addon.updateOne({ _id: l.addon }, { $inc: { stock: l.quantity } });
  }
};
