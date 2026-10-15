import mongoose from 'mongoose';

// Customer review of a product they received (verified purchase only).
const reviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },

  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, trim: true, default: '', maxlength: 1000 },

  // Shown publicly as e.g. "Priya S." (no phone numbers)
  customerName: { type: String, trim: true, default: 'Customer' },
  productName: { type: String, trim: true, default: '' },

  // Reviews go live immediately; admins can hide inappropriate ones
  status: { type: String, enum: ['published', 'hidden'], default: 'published', index: true }
}, {
  timestamps: true
});

// One review per product per order
reviewSchema.index({ order: 1, product: 1 }, { unique: true });
reviewSchema.index({ status: 1, createdAt: -1 });

const Review = mongoose.model('Review', reviewSchema);
export default Review;
