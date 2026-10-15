// Delivery-date booking rules shared by the calendar API and order validation.
//
// A delivery date D is bookable when ALL of these hold:
//   - bookings are switched on (BookingConfig.bookingEnabled)
//   - D is after today (no same-day orders)
//   - D is within maxAdvanceDays
//   - the admin has not blocked D
//   - it is before the cutoff time on the day before D
//     (e.g. cutoff 17:00 -> orders for the 11th close at 5 PM on the 10th)
//   - when time slots are on: at least one active, unblocked slot remains
import BookingConfig from '../models/BookingConfig.js';
import BookingDate from '../models/BookingDate.js';
import {
  istNow, addDays, diffDays, isValidDateString, timeToMinutes, formatTime12h, formatDateShort
} from '../utils/istDate.js';

export const REASON_LABELS = {
  cyclone: 'Cyclone',
  bad_weather: 'Bad weather',
  rough_sea: 'Rough sea',
  boats_unavailable: 'Fishing boats unable to go out',
  holiday: 'Holiday',
  stock_unavailable: 'Fresh stock unavailable',
  other: 'Other'
};

export const SAME_DAY_MESSAGE = 'Same-day orders are not available. Please select a future date for your delivery.';
const DEFAULT_BLOCKED_MESSAGE = 'Delivery is not available on this date. Please select another available date.';

export const getBookingConfig = async () => {
  let config = await BookingConfig.findOne();
  if (!config) config = await BookingConfig.create({});
  return config;
};

const loadOverrides = async (fromDate, toDate) => {
  const rows = await BookingDate.find({ date: { $gte: fromDate, $lte: toDate } }).lean();
  return new Map(rows.map(row => [row.date, row]));
};

// Evaluate one date. `override` is the BookingDate row for that date (or undefined).
export const evaluateDate = (date, { config, override, now }) => {
  const daysAhead = diffDays(now.date, date);
  const cutoffTime = override?.cutoffTime || config.cutoffTime;
  const cutoffDate = addDays(date, -1);
  const result = {
    date,
    available: false,
    reason: null,
    message: '',
    cutoffDate,
    cutoffTime,
    slots: []
  };

  if (daysAhead < 0) {
    result.reason = 'past';
    result.message = 'This date has already passed.';
    return result;
  }
  if (daysAhead === 0) {
    result.reason = 'same_day';
    result.message = SAME_DAY_MESSAGE;
    return result;
  }
  if (daysAhead > config.maxAdvanceDays) {
    result.reason = 'beyond_window';
    result.message = `Orders can be placed up to ${config.maxAdvanceDays} days in advance.`;
    return result;
  }
  if (!config.bookingEnabled) {
    result.reason = 'booking_closed';
    result.message = config.closedMessage;
    return result;
  }
  if (override?.isBlocked) {
    result.reason = 'blocked';
    result.blockReason = override.reason || 'other';
    result.message = override.message || DEFAULT_BLOCKED_MESSAGE;
    return result;
  }
  if (daysAhead === 1 && now.minutes >= timeToMinutes(cutoffTime)) {
    result.reason = 'cutoff_passed';
    result.message = `Orders for ${formatDateShort(date)} closed at ${formatTime12h(cutoffTime)} today. Please select a later date.`;
    return result;
  }

  if (config.timeSlotsEnabled) {
    const blockedSlots = new Set(override?.blockedSlots || []);
    result.slots = config.slots
      .filter(slot => slot.isActive)
      .map(slot => ({
        slotId: slot.slotId,
        label: slot.label,
        startTime: slot.startTime,
        endTime: slot.endTime,
        available: !blockedSlots.has(slot.slotId)
      }));
    if (!result.slots.some(slot => slot.available)) {
      result.reason = 'no_slots';
      result.message = override?.message || 'All delivery slots for this date are full or unavailable.';
      return result;
    }
  }

  result.available = true;
  return result;
};

// Availability for every date from today to today + maxAdvanceDays
export const getAvailability = async (nowDate = new Date()) => {
  const config = await getBookingConfig();
  const now = istNow(nowDate);
  const lastDate = addDays(now.date, config.maxAdvanceDays);
  const overrides = await loadOverrides(now.date, lastDate);

  const dates = [];
  for (let i = 0; i <= config.maxAdvanceDays; i++) {
    const date = addDays(now.date, i);
    dates.push(evaluateDate(date, { config, override: overrides.get(date), now }));
  }

  return {
    config,
    now,
    dates,
    earliestDate: dates.find(d => d.available)?.date || null
  };
};

// Active customer notices: published messages for today or later
export const getActiveNotices = async (nowDate = new Date()) => {
  const today = istNow(nowDate).date;
  const rows = await BookingDate.find({ showNotice: true, date: { $gte: today } })
    .sort({ date: 1 })
    .lean();

  return rows
    .filter(row => row.message)
    .map(row => ({
      date: row.date,
      title: row.noticeTitle || (row.isBlocked ? `No delivery on ${formatDateShort(row.date)}` : `Delivery update for ${formatDateShort(row.date)}`),
      message: row.message,
      reason: row.reason || 'other',
      isBlocked: row.isBlocked,
      updatedAt: row.updatedAt
    }));
};

// Validate a customer's choice. Returns { ok, deliveryDate, deliverySlot, code, message }.
// When no date is sent (older app versions), the earliest available date is used.
export const validateDeliverySelection = async ({ deliveryDate, deliverySlotId } = {}, nowDate = new Date()) => {
  const config = await getBookingConfig();
  const now = istNow(nowDate);

  let date = deliveryDate;
  if (!date) {
    const { earliestDate } = await getAvailability(nowDate);
    if (!earliestDate) {
      return { ok: false, code: 'NO_DELIVERY_DATES', message: config.bookingEnabled ? 'No delivery dates are available right now. Please try again later.' : config.closedMessage };
    }
    date = earliestDate;
  }

  if (!isValidDateString(date)) {
    return { ok: false, code: 'INVALID_DELIVERY_DATE', message: 'Please select a valid delivery date.' };
  }

  const override = await BookingDate.findOne({ date }).lean();
  const evaluation = evaluateDate(date, { config, override, now });

  if (!evaluation.available) {
    return {
      ok: false,
      code: evaluation.reason === 'same_day' ? 'SAME_DAY_NOT_ALLOWED' : 'DELIVERY_DATE_UNAVAILABLE',
      reason: evaluation.reason,
      message: evaluation.message
    };
  }

  let deliverySlot = null;
  if (config.timeSlotsEnabled) {
    const slot = evaluation.slots.find(s => s.slotId === deliverySlotId);
    if (!deliverySlotId || !slot) {
      // Older clients can't pick a slot: use the first open one
      const firstOpen = evaluation.slots.find(s => s.available);
      if (deliverySlotId) {
        return { ok: false, code: 'INVALID_DELIVERY_SLOT', message: 'Please select a valid delivery time slot.' };
      }
      deliverySlot = firstOpen;
    } else if (!slot.available) {
      return { ok: false, code: 'DELIVERY_SLOT_UNAVAILABLE', message: 'This delivery slot is no longer available. Please choose another slot.' };
    } else {
      deliverySlot = slot;
    }
    deliverySlot = {
      slotId: deliverySlot.slotId,
      label: deliverySlot.label,
      startTime: deliverySlot.startTime,
      endTime: deliverySlot.endTime
    };
  }

  return { ok: true, deliveryDate: date, deliverySlot };
};

// Re-check an existing order's date. Used before payment and after it succeeds.
export const checkOrderDeliveryStillValid = async (order) => {
  if (!order?.deliveryDate) return { ok: true };
  return validateDeliverySelection({
    deliveryDate: order.deliveryDate,
    deliverySlotId: order.deliverySlot?.slotId
  });
};

// After a payment is captured, never reject it: flag the order for admin review instead.
export const flagOrderIfDateUnavailable = async (order) => {
  const check = await checkOrderDeliveryStillValid(order);
  // The cutoff was already enforced when the order was created; passing it while
  // the customer was paying is not a reason for review.
  if (!check.ok && check.reason !== 'cutoff_passed') {
    order.bookingReview = {
      required: true,
      reason: check.message,
      flaggedAt: new Date()
    };
  }
  return check;
};
