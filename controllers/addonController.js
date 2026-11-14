import mongoose from 'mongoose';
import Addon from '../models/Addon.js';
import AddonCategory from '../models/AddonCategory.js';
import { deleteFromR2 } from '../middleware/uploadMiddleware.js';
import { findAvailableAddons, groupByCategory } from '../services/addonService.js';

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const toBool = (v, fallback) => (v === undefined ? fallback : !(v === false || v === 'false' || v === '0'));
const duplicateMessage = (error) => (error?.code === 11000 ? 'A category with this name already exists' : null);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Same name ignoring capitals ("Marination" = "marination")
const categoryNameTaken = (name, exceptId) => AddonCategory.exists({
  name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  ...(exceptId ? { _id: { $ne: exceptId } } : {})
});

// ============ PUBLIC ============

// GET /api/addons — add-ons to show at checkout, grouped by category
// (only ON add-ons, in an ON category, with stock)
export const getCheckoutAddons = async (request, reply) => {
  try {
    const addons = await findAvailableAddons();
    return reply.send({ success: true, data: groupByCategory(addons) });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ============ ADMIN: CATEGORIES ============

export const adminListAddonCategories = async (request, reply) => {
  try {
    const [categories, counts] = await Promise.all([
      AddonCategory.find().sort({ sortOrder: 1, name: 1 }).lean(),
      Addon.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }])
    ]);
    const countBy = new Map(counts.map(c => [String(c._id), c.count]));
    return reply.send({ success: true, data: categories.map(c => ({ ...c, addonCount: countBy.get(String(c._id)) || 0 })) });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

export const adminCreateAddonCategory = async (request, reply) => {
  try {
    const name = String(request.body?.name || '').trim();
    if (!name) return reply.status(400).send({ success: false, message: 'Category name is required' });
    if (await categoryNameTaken(name)) return reply.status(400).send({ success: false, message: 'A category with this name already exists' });
    const category = await AddonCategory.create({
      name,
      isActive: toBool(request.body?.isActive, true),
      sortOrder: Number(request.body?.sortOrder) || 0
    });
    return reply.status(201).send({ success: true, message: 'Category created', data: category });
  } catch (error) {
    return reply.status(duplicateMessage(error) ? 400 : 500).send({ success: false, message: duplicateMessage(error) || error.message });
  }
};

export const adminUpdateAddonCategory = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid category ID' });
    const category = await AddonCategory.findById(id);
    if (!category) return reply.status(404).send({ success: false, message: 'Category not found' });

    const body = request.body || {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return reply.status(400).send({ success: false, message: 'Category name is required' });
      if (await categoryNameTaken(name, id)) return reply.status(400).send({ success: false, message: 'A category with this name already exists' });
      category.name = name;
    }
    if (body.isActive !== undefined) category.isActive = toBool(body.isActive, true);
    if (body.sortOrder !== undefined && !isNaN(Number(body.sortOrder))) category.sortOrder = Number(body.sortOrder);
    await category.save();
    return reply.send({ success: true, message: 'Category updated', data: category });
  } catch (error) {
    return reply.status(duplicateMessage(error) ? 400 : 500).send({ success: false, message: duplicateMessage(error) || error.message });
  }
};

export const adminDeleteAddonCategory = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid category ID' });
    const inUse = await Addon.countDocuments({ category: id });
    if (inUse) {
      return reply.status(400).send({
        success: false,
        message: `This category has ${inUse} add-on${inUse === 1 ? '' : 's'}. Move or delete them first, or turn the category off.`
      });
    }
    const category = await AddonCategory.findByIdAndDelete(id);
    if (!category) return reply.status(404).send({ success: false, message: 'Category not found' });
    return reply.send({ success: true, message: `Category "${category.name}" deleted` });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ============ ADMIN: ADD-ONS ============

export const adminListAddons = async (request, reply) => {
  try {
    const addons = await Addon.find()
      .populate('category', 'name isActive')
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return reply.send({ success: true, count: addons.length, data: addons });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// Shared validation for create/update. Only fields that were sent are checked.
const readAddonFields = async (body, { requireAll }) => {
  const data = {};
  if (requireAll || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return { error: 'Add-on name is required' };
    data.name = name;
  }
  if (requireAll || body.category !== undefined) {
    if (!isValidId(body.category)) return { error: 'Please select a category' };
    if (!(await AddonCategory.exists({ _id: body.category }))) return { error: 'Category not found' };
    data.category = body.category;
  }
  if (requireAll || body.price !== undefined) {
    const price = Number(body.price);
    if (body.price === '' || isNaN(price) || price < 0) return { error: 'Price must be a number of 0 or more' };
    data.price = price;
  }
  if (requireAll || body.stock !== undefined) {
    const stock = Number(body.stock === '' || body.stock === undefined ? 0 : body.stock);
    if (isNaN(stock) || stock < 0 || !Number.isInteger(stock)) return { error: 'Stock must be a whole number of 0 or more' };
    data.stock = stock;
  }
  if (body.description !== undefined) data.description = String(body.description).trim().slice(0, 500);
  if (body.isActive !== undefined) data.isActive = toBool(body.isActive, true);
  if (body.sortOrder !== undefined && !isNaN(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);
  return { data };
};

// POST /api/admin/addons (multipart: name, category, price, stock, description, isActive, image file)
export const adminCreateAddon = async (request, reply) => {
  const imageFile = (request.uploadedFiles || []).find(f => f.fieldname === 'image');
  try {
    const { data, error } = await readAddonFields(request.body || {}, { requireAll: true });
    if (error) {
      if (imageFile) await deleteFromR2(imageFile.key);
      return reply.status(400).send({ success: false, message: error });
    }
    const addon = await Addon.create({ ...data, image: imageFile ? imageFile.key : null });
    await addon.populate('category', 'name isActive');
    return reply.status(201).send({ success: true, message: 'Add-on created', data: addon });
  } catch (error) {
    if (imageFile) await deleteFromR2(imageFile.key);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// PUT /api/admin/addons/:id (multipart or JSON; deleteImage=true removes the photo)
export const adminUpdateAddon = async (request, reply) => {
  const imageFile = (request.uploadedFiles || []).find(f => f.fieldname === 'image');
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid add-on ID' });
    const addon = await Addon.findById(id);
    if (!addon) {
      if (imageFile) await deleteFromR2(imageFile.key);
      return reply.status(404).send({ success: false, message: 'Add-on not found' });
    }

    const body = request.body || {};
    const { data, error } = await readAddonFields(body, { requireAll: false });
    if (error) {
      if (imageFile) await deleteFromR2(imageFile.key);
      return reply.status(400).send({ success: false, message: error });
    }
    Object.assign(addon, data);

    if (imageFile || toBool(body.deleteImage, false)) {
      if (addon.image) await deleteFromR2(addon.image);
      addon.image = imageFile ? imageFile.key : null;
    }

    await addon.save();
    await addon.populate('category', 'name isActive');
    return reply.send({ success: true, message: 'Add-on updated', data: addon });
  } catch (error) {
    if (imageFile) await deleteFromR2(imageFile.key);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// DELETE /api/admin/addons/:id — past orders keep their copy of name & price
export const adminDeleteAddon = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!isValidId(id)) return reply.status(400).send({ success: false, message: 'Invalid add-on ID' });
    const addon = await Addon.findByIdAndDelete(id);
    if (!addon) return reply.status(404).send({ success: false, message: 'Add-on not found' });
    if (addon.image) await deleteFromR2(addon.image);
    return reply.send({ success: true, message: `"${addon.name}" deleted` });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};
