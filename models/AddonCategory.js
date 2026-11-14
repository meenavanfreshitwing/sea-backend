// models/AddonCategory.js — groups of add-ons (e.g. Marination, Curry Masala, Ready-to-Cook Kits)
import mongoose from 'mongoose';

const addonCategorySchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Please enter category name'], trim: true, unique: true },
  // Off → none of its add-ons show at checkout
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model('AddonCategory', addonCategorySchema);
