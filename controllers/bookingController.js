import mongoose from 'mongoose';
import Order from '../models/Order.js';
import BookingDate from '../models/BookingDate.js';
import {
  getBookingConfig, getAvailability, getActiveNotices, evaluateDate, REASON_LABELS
} from '../services/bookingService.js';
import { istNow, addDays, diffDays, isValidDateString, TIME_PATTERN, timeToMinutes } from '../utils/istDate.js';
import Product from '../models/productModel.js';
import { buildDeliverySummary } from '../services/deliverySummary.js';

const publicConfig = (config) => ({
  bookingEnabled: config.bookingEnabled,
  cutoffTime: config.cutoffTime,
  maxAdvanceDays: config.maxAdvanceDays,
  closedMessage: config.closedMessage,
  timeSlotsEnabled: config.timeSlotsEnabled,
  slots: config.slots.filter(s => s.isActive).map(({ slotId, label, startTime, endTime }) => ({ slotId, label, startTime, endTime }))
});

const ORDER_LIST_FIELDS = 'orderId name shippingAddress.phone finalAmount paymentMethod paymentStatus orderStatus deliveryDate deliverySlot deliveryStatus bookingReview createdAt';

// ─────────────────────────── Public ───────────────────────────

// GET /booking/availability
export const getBookingAvailability = async (request, reply) => {
  try {
    const { config, now, dates, earliestDate } = await getAvailability();
    const notices = await getActiveNotices();

    reply.header('Cache-Control', 'no-store');
    return reply.send({
      success: true,
      data: {
        today: now.date,
        serverTime: now.time,
        timezone: 'Asia/Kolkata',
        earliestDate,
        config: publicConfig(config),
        dates: dates.map(({ date, available, reason, message, cutoffDate, cutoffTime, slots }) => ({
          date, available, reason, message, cutoffDate, cutoffTime, slots
        })),
        notices
      }
    });
  } catch (error) {
    console.error('Booking availability error:', error);
    return reply.status(500).send({ success: false, message: 'Could not load delivery dates' });
  }
};

// GET /booking/notices
export const getBookingNotices = async (request, reply) => {
  try {
    reply.header('Cache-Control', 'no-store');
    return reply.send({ success: true, data: await getActiveNotices() });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────── Admin ───────────────────────────

// GET /admin/booking/config
export const getAdminBookingConfig = async (request, reply) => {
  try {
    const config = await getBookingConfig();
    return reply.send({ success: true, data: config, reasons: REASON_LABELS });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// PUT /admin/booking/config
export const updateAdminBookingConfig = async (request, reply) => {
  try {
    const body = request.body || {};
    const config = await getBookingConfig();

    if (body.cutoffTime !== undefined) {
      if (!TIME_PATTERN.test(body.cutoffTime)) {
        return reply.status(400).send({ success: false, message: 'Cutoff time must be in HH:mm (24-hour) format' });
      }
      config.cutoffTime = body.cutoffTime;
    }
    if (body.maxAdvanceDays !== undefined) {
      const days = parseInt(body.maxAdvanceDays);
      if (isNaN(days) || days < 1 || days > 365) {
        return reply.status(400).send({ success: false, message: 'Booking window must be between 1 and 365 days' });
      }
      config.maxAdvanceDays = days;
    }
    if (body.bookingEnabled !== undefined) config.bookingEnabled = Boolean(body.bookingEnabled);
    if (body.closedMessage !== undefined) config.closedMessage = String(body.closedMessage).slice(0, 500);
    if (body.timeSlotsEnabled !== undefined) config.timeSlotsEnabled = Boolean(body.timeSlotsEnabled);

    if (body.slots !== undefined) {
      if (!Array.isArray(body.slots)) {
        return reply.status(400).send({ success: false, message: 'Slots must be a list' });
      }
      const seen = new Set();
      for (const slot of body.slots) {
        if (!slot.slotId || !slot.label) {
          return reply.status(400).send({ success: false, message: 'Every slot needs an id and a label' });
        }
        if (seen.has(slot.slotId)) {
          return reply.status(400).send({ success: false, message: `Duplicate slot id "${slot.slotId}"` });
        }
        if (!TIME_PATTERN.test(slot.startTime) || !TIME_PATTERN.test(slot.endTime) ||
            timeToMinutes(slot.startTime) >= timeToMinutes(slot.endTime)) {
          return reply.status(400).send({ success: false, message: `Slot "${slot.label}" needs a valid start and end time` });
        }
        seen.add(slot.slotId);
      }
      config.slots = body.slots.map(({ slotId, label, startTime, endTime, isActive }) => ({
        slotId: String(slotId).trim(), label: String(label).trim(), startTime, endTime, isActive: isActive !== false
      }));
    }

    if (config.timeSlotsEnabled && !config.slots.some(s => s.isActive)) {
      return reply.status(400).send({ success: false, message: 'Add at least one active slot before enabling time slots' });
    }

    await config.save();
    return reply.send({ success: true, message: 'Booking settings saved', data: config });
  } catch (error) {
    console.error('Update booking config error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /admin/booking/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getAdminBookingCalendar = async (request, reply) => {
  try {
    const now = istNow();
    const from = isValidDateString(request.query.from) ? request.query.from : now.date;
    let to = isValidDateString(request.query.to) ? request.query.to : addDays(from, 41);
    if (diffDays(from, to) < 0) to = from;
    if (diffDays(from, to) > 92) to = addDays(from, 92);

    const config = await getBookingConfig();
    const [overrides, counts, reviewCounts] = await Promise.all([
      BookingDate.find({ date: { $gte: from, $lte: to } }).lean(),
      Order.aggregate([
        { $match: { deliveryDate: { $gte: from, $lte: to }, orderStatus: { $ne: 'cancelled' } } },
        { $group: { _id: '$deliveryDate', count: { $sum: 1 } } }
      ]),
      Order.aggregate([
        { $match: { deliveryDate: { $gte: from, $lte: to }, 'bookingReview.required': true, orderStatus: { $ne: 'cancelled' } } },
        { $group: { _id: '$deliveryDate', count: { $sum: 1 } } }
      ])
    ]);
    const overrideMap = new Map(overrides.map(o => [o.date, o]));
    const countMap = new Map(counts.map(c => [c._id, c.count]));
    const reviewMap = new Map(reviewCounts.map(c => [c._id, c.count]));

    const dates = [];
    for (let date = from; diffDays(date, to) >= 0; date = addDays(date, 1)) {
      const override = overrideMap.get(date) || null;
      const evaluation = evaluateDate(date, { config, override, now });
      dates.push({
        date,
        available: evaluation.available,
        reason: evaluation.reason,
        message: evaluation.message,
        cutoffTime: evaluation.cutoffTime,
        slots: evaluation.slots,
        override,
        orderCount: countMap.get(date) || 0,
        reviewCount: reviewMap.get(date) || 0
      });
    }

    return reply.send({
      success: true,
      data: { today: now.date, serverTime: now.time, from, to, config, reasons: REASON_LABELS, dates }
    });
  } catch (error) {
    console.error('Booking calendar error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// PUT /admin/booking/dates/:date  — block/unblock, slots, reason, notice, cutoff
export const upsertBookingDate = async (request, reply) => {
  try {
    const { date } = request.params;
    if (!isValidDateString(date)) {
      return reply.status(400).send({ success: false, message: 'Invalid date' });
    }
    if (diffDays(istNow().date, date) < 0) {
      return reply.status(400).send({ success: false, message: 'Past dates cannot be changed' });
    }

    const body = request.body || {};
    const config = await getBookingConfig();
    const update = {};

    if (body.isBlocked !== undefined) update.isBlocked = Boolean(body.isBlocked);
    if (body.blockedSlots !== undefined) {
      const known = new Set(config.slots.map(s => s.slotId));
      update.blockedSlots = (Array.isArray(body.blockedSlots) ? body.blockedSlots : []).filter(id => known.has(id));
    }
    if (body.reason !== undefined) {
      if (body.reason && !REASON_LABELS[body.reason]) {
        return reply.status(400).send({ success: false, message: 'Unknown reason' });
      }
      update.reason = body.reason || '';
    }
    if (body.message !== undefined) update.message = String(body.message).trim().slice(0, 1000);
    if (body.noticeTitle !== undefined) update.noticeTitle = String(body.noticeTitle).trim().slice(0, 120);
    if (body.showNotice !== undefined) update.showNotice = Boolean(body.showNotice);
    if (body.cutoffTime !== undefined) {
      if (body.cutoffTime && !TIME_PATTERN.test(body.cutoffTime)) {
        return reply.status(400).send({ success: false, message: 'Cutoff time must be in HH:mm (24-hour) format' });
      }
      update.cutoffTime = body.cutoffTime || '';
    }
    if (update.showNotice && update.message === '') {
      return reply.status(400).send({ success: false, message: 'Write a message before publishing a notice' });
    }
    update.updatedBy = request.user?.userId || null;

    let row = await BookingDate.findOneAndUpdate(
      { date },
      { $set: update, $setOnInsert: { date } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    if (row.showNotice && !row.message) {
      row.showNotice = false;
      await row.save();
    }

    // Nothing left to override: remove the row so the date follows the default rules
    const isEmpty = !row.isBlocked && !row.blockedSlots?.length && !row.showNotice && !row.cutoffTime;
    if (isEmpty) {
      await BookingDate.deleteOne({ _id: row._id });
      row = null;
    }

    const existingOrders = await Order.countDocuments({ deliveryDate: date, orderStatus: { $ne: 'cancelled' } });

    return reply.send({
      success: true,
      message: row?.isBlocked ? `${date} blocked for new orders` : `${date} updated`,
      data: row,
      existingOrders
    });
  } catch (error) {
    console.error('Update booking date error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// DELETE /admin/booking/dates/:date — restore default rules (unblock, clear notice)
export const clearBookingDate = async (request, reply) => {
  try {
    const { date } = request.params;
    if (!isValidDateString(date)) {
      return reply.status(400).send({ success: false, message: 'Invalid date' });
    }
    await BookingDate.deleteOne({ date });
    return reply.send({ success: true, message: `${date} is open for booking again` });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /admin/booking/dates/:date/orders — orders already booked for a date
export const getOrdersForDate = async (request, reply) => {
  try {
    const { date } = request.params;
    if (!isValidDateString(date)) {
      return reply.status(400).send({ success: false, message: 'Invalid date' });
    }
    const orders = await Order.find({ deliveryDate: date })
      .select(ORDER_LIST_FIELDS)
      .sort({ createdAt: 1 })
      .lean();
    return reply.send({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /admin/reports/delivery-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&pending=true
// Product-wise kg and order counts per delivery date (cancelled / unpaid online orders left out).
// pending=true: only orders still to deliver (a buying & packing list).
export const getDeliverySummary = async (request, reply) => {
  try {
    const today = istNow().date;
    const from = isValidDateString(request.query.from) ? request.query.from : today;
    let to = isValidDateString(request.query.to) ? request.query.to : addDays(from, 6);
    if (diffDays(from, to) < 0) to = from;
    if (diffDays(from, to) > 92) to = addDays(from, 92);
    const pendingOnly = String(request.query.pending) === 'true';

    const filter = { deliveryDate: { $gte: from, $lte: to }, orderStatus: { $ne: 'cancelled' } };
    if (pendingOnly) filter.orderStatus = { $nin: ['cancelled', 'delivered'] };

    const orders = await Order.find(filter)
      .select('orderId deliveryDate orderStatus paymentMethod paymentStatus finalAmount products')
      .lean();

    const productIds = [...new Set(orders.flatMap(o => (o.products || []).map(i => String(i.product))).filter(id => mongoose.Types.ObjectId.isValid(id)))];
    const products = await Product.find({ _id: { $in: productIds } }).select('name variants._id variants.variantName variants.weight variants.weightUnit').lean();

    const summary = buildDeliverySummary(orders, new Map(products.map(p => [String(p._id), p])));
    return reply.send({ success: true, data: { from, to, today, pendingOnly, ...summary } });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /admin/booking/review — paid orders whose date became unavailable
export const getOrdersNeedingReview = async (request, reply) => {
  try {
    const orders = await Order.find({ 'bookingReview.required': true, orderStatus: { $ne: 'cancelled' } })
      .select(ORDER_LIST_FIELDS)
      .sort({ deliveryDate: 1 })
      .lean();
    return reply.send({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// PATCH /admin/orders/:id/delivery-date — admin reschedule (ignores cutoff/blocks by design)
export const rescheduleOrder = async (request, reply) => {
  try {
    const { id } = request.params;
    const { deliveryDate, deliverySlotId } = request.body || {};

    if (!isValidDateString(deliveryDate)) {
      return reply.status(400).send({ success: false, message: 'Please choose a valid delivery date' });
    }
    if (diffDays(istNow().date, deliveryDate) < 0) {
      return reply.status(400).send({ success: false, message: 'Delivery date cannot be in the past' });
    }

    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { orderId: id };
    const order = await Order.findOne(filter);
    if (!order) return reply.status(404).send({ success: false, message: 'Order not found' });
    if (['delivered', 'cancelled'].includes(order.orderStatus)) {
      return reply.status(400).send({ success: false, message: `A ${order.orderStatus} order cannot be rescheduled` });
    }

    const config = await getBookingConfig();
    let deliverySlot;
    if (deliverySlotId) {
      const slot = config.slots.find(s => s.slotId === deliverySlotId);
      if (!slot) return reply.status(400).send({ success: false, message: 'Unknown delivery slot' });
      deliverySlot = { slotId: slot.slotId, label: slot.label, startTime: slot.startTime, endTime: slot.endTime };
    }

    const previousDate = order.deliveryDate;
    order.deliveryDate = deliveryDate;
    order.deliverySlot = deliverySlot;
    order.bookingReview = { required: false, reason: '', flaggedAt: null };
    await order.save();

    return reply.send({
      success: true,
      message: `Order ${order.orderId} moved${previousDate ? ` from ${previousDate}` : ''} to ${deliveryDate}`,
      data: { _id: order._id, orderId: order.orderId, deliveryDate: order.deliveryDate, deliverySlot: order.deliverySlot }
    });
  } catch (error) {
    console.error('Reschedule order error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};
