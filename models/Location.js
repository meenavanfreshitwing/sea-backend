// models/Location.js
// A delivery area the business serves (e.g. "Karaikudi", "Trichy").
// Not the government district: each area is simply the list of pincodes it covers.
// Product prices can be overridden per location (see Product.locationPrices).
import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Please enter location name'], trim: true, unique: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  // 6-digit Indian pincodes covered by this location. One pincode belongs to one location.
  pincodes: [{ type: String, trim: true, match: [/^\d{6}$/, 'Pincode must be 6 digits'] }],
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

locationSchema.index({ pincodes: 1 });
locationSchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model('Location', locationSchema);
