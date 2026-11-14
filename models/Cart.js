// models/Cart.js
import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  originalPrice: {
    type: Number,
    default: null
  },
  variantId: {
    type: String,
    default: null
  },
  variantName: {
    type: String,
    default: ''
  },
  productName: {
    type: String,
    default: ''
  },
  productImage: {
    type: String,
    default: ''
  },
  // ✅ ADD THESE WEIGHT FIELDS
  weight: {
    type: Number,
    default: 0
  },
  weightUnit: {
    type: String,
    default: 'gram'
  }
}, {
  timestamps: true
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  guestId: {
    type: String,
    required: false,
    default: null
  },
  // Location the cart is priced for (null = default prices)
  location: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    default: null
  },
  items: [cartItemSchema],
  // Masala & other extras picked at checkout (price refreshed from the database)
  addons: [{
    addon: { type: mongoose.Schema.Types.ObjectId, ref: 'Addon', required: true },
    name: { type: String, default: '' },
    categoryName: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    image: { type: String, default: null }
  }],
  addonsTotal: {
    type: Number,
    default: 0
  },
  totalItems: {
    type: Number,
    default: 0
  },
  totalPrice: {
    type: Number,
    default: 0
  },
  totalOriginalPrice: {
    type: Number,
    default: 0
  },
  totalSavings: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// One place for totals, so every cart change counts add-ons the same way.
// Add-ons are only sold with fish: an empty cart drops them.
cartSchema.pre('save', function() {
  if (!this.items.length && this.addons.length) this.addons = [];
  const itemsTotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const itemsOriginal = this.items.reduce((sum, item) => sum + ((item.originalPrice || item.price) * item.quantity), 0);
  this.addonsTotal = this.addons.reduce((sum, a) => sum + (a.price * a.quantity), 0);
  this.totalItems = this.items.reduce((sum, item) => sum + item.quantity, 0);
  this.totalPrice = itemsTotal + this.addonsTotal;
  this.totalOriginalPrice = itemsOriginal + this.addonsTotal;
  this.totalSavings = this.totalOriginalPrice - this.totalPrice;
});

const Cart = mongoose.model('Cart', cartSchema);
export default Cart;