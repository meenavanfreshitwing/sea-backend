import {
  getBookingAvailability,
  getBookingNotices,
  getAdminBookingConfig,
  updateAdminBookingConfig,
  getAdminBookingCalendar,
  upsertBookingDate,
  clearBookingDate,
  getOrdersForDate,
  getOrdersNeedingReview,
  rescheduleOrder,
  getDeliverySummary
} from '../controllers/bookingController.js';
import { requireAdmin } from '../controllers/authController.js';

async function bookingRoutes(fastify, options) {
  // Public: customer calendar + emergency notices (website and app)
  fastify.get('/booking/availability', getBookingAvailability);
  fastify.get('/booking/notices', getBookingNotices);

  // Admin: rules, calendar, date blocking, affected orders
  fastify.get('/admin/booking/config', { preHandler: requireAdmin }, getAdminBookingConfig);
  fastify.put('/admin/booking/config', { preHandler: requireAdmin }, updateAdminBookingConfig);
  fastify.get('/admin/booking/calendar', { preHandler: requireAdmin }, getAdminBookingCalendar);
  fastify.put('/admin/booking/dates/:date', { preHandler: requireAdmin }, upsertBookingDate);
  fastify.delete('/admin/booking/dates/:date', { preHandler: requireAdmin }, clearBookingDate);
  fastify.get('/admin/booking/dates/:date/orders', { preHandler: requireAdmin }, getOrdersForDate);
  fastify.get('/admin/booking/review', { preHandler: requireAdmin }, getOrdersNeedingReview);
  fastify.patch('/admin/orders/:id/delivery-date', { preHandler: requireAdmin }, rescheduleOrder);

  // Admin: product-wise kg per delivery date (buying / packing list)
  fastify.get('/admin/reports/delivery-summary', { preHandler: requireAdmin }, getDeliverySummary);
}

export default bookingRoutes;
