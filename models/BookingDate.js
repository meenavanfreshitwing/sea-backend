import mongoose from 'mongoose';

// Admin override for one delivery date: block it (fully or per slot),
// change its order cutoff, and optionally publish a notice to customers.
const bookingDateSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },   // 'YYYY-MM-DD' (IST)

  isBlocked: { type: Boolean, default: false },
  blockedSlots: [{ type: String }],                       // slotIds blocked on this date

  reason: {
    type: String,
    enum: ['cyclone', 'bad_weather', 'rough_sea', 'boats_unavailable', 'holiday', 'stock_unavailable', 'other', ''],
    default: ''
  },
  // Customer-facing explanation (shown when they tap the date / in notices)
  message: { type: String, default: '', maxlength: 1000 },

  // Publish message as a site/app notice until the date has passed
  showNotice: { type: Boolean, default: false },
  noticeTitle: { type: String, default: '', maxlength: 120 },

  // Overrides BookingConfig.cutoffTime for this date only ('HH:mm' or '')
  cutoffTime: { type: String, default: '' },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, {
  timestamps: true
});

bookingDateSchema.index({ showNotice: 1, date: 1 });

const BookingDate = mongoose.model('BookingDate', bookingDateSchema);
export default BookingDate;
