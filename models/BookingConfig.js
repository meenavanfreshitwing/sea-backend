import mongoose from 'mongoose';

// Single document holding the store-wide delivery booking rules
const slotSchema = new mongoose.Schema({
  slotId: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  startTime: { type: String, required: true },   // 'HH:mm'
  endTime: { type: String, required: true },     // 'HH:mm'
  isActive: { type: Boolean, default: true }
}, { _id: false });

const bookingConfigSchema = new mongoose.Schema({
  // Master switch: when false no new orders can be booked for any date
  bookingEnabled: { type: Boolean, default: true },

  // Orders for date D close at this time (IST) on the day before D
  cutoffTime: { type: String, default: '17:00' },

  // How many days ahead customers may book
  maxAdvanceDays: { type: Number, default: 30, min: 1, max: 365 },

  // Message shown when bookings are switched off
  closedMessage: {
    type: String,
    default: 'We are not accepting new orders at the moment. Please check back soon.'
  },

  timeSlotsEnabled: { type: Boolean, default: false },
  slots: {
    type: [slotSchema],
    default: () => ([
      { slotId: 'morning', label: 'Morning (6 AM - 9 AM)', startTime: '06:00', endTime: '09:00', isActive: true },
      { slotId: 'late-morning', label: 'Late Morning (9 AM - 12 PM)', startTime: '09:00', endTime: '12:00', isActive: true }
    ])
  }
}, {
  timestamps: true
});

const BookingConfig = mongoose.model('BookingConfig', bookingConfigSchema);
export default BookingConfig;
