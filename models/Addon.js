// models/Addon.js — extras offered at checkout with fish (e.g. Fish Fry Masala 50 g)
import mongoose from 'mongoose';

const addonSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Please enter add-on name'], trim: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'AddonCategory', required: [true, 'Please select a category'] },
  description: { type: String, trim: true, default: '' },
  price: { type: Number, required: [true, 'Please enter price'], min: [0, 'Price cannot be negative'] },
  image: { type: String, default: null }, // R2 key
  // Packets in stock. 0 → hidden at checkout automatically.
  stock: { type: Number, default: 0, min: 0 },
  // Off → never shown at checkout
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

addonSchema.index({ isActive: 1, category: 1, sortOrder: 1 });

export default mongoose.model('Addon', addonSchema);
