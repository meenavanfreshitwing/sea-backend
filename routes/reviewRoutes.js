import {
  getReviews,
  getReviewHighlights,
  getMyReviewables,
  submitReview,
  getAdminReviews,
  updateReviewStatus,
  deleteReview
} from '../controllers/reviewController.js';
import { requireAdmin, requireStrictAuth } from '../controllers/authController.js';

async function reviewRoutes(fastify, options) {
  // Public
  fastify.get('/reviews', getReviews);
  fastify.get('/reviews/highlights', getReviewHighlights);

  // Logged-in customers (verified purchases only)
  fastify.get('/reviews/mine', { preHandler: requireStrictAuth }, getMyReviewables);
  fastify.post('/reviews', { preHandler: requireStrictAuth }, submitReview);

  // Admin moderation
  fastify.get('/admin/reviews', { preHandler: requireAdmin }, getAdminReviews);
  fastify.patch('/admin/reviews/:id', { preHandler: requireAdmin }, updateReviewStatus);
  fastify.delete('/admin/reviews/:id', { preHandler: requireAdmin }, deleteReview);
}

export default reviewRoutes;
