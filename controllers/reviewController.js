import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Order from '../models/Order.js';
import Product from '../models/productModel.js';
import User from '../models/User.js';

const MAX_COMMENT = 1000;

// "Priya Sharma" -> "Priya S."; never expose phone numbers
const displayName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || /^\+?\d[\d\s-]{5,}$/.test(parts.join(' '))) return 'Customer';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

const publicReview = (r) => ({
  _id: r._id,
  rating: r.rating,
  comment: r.comment,
  customerName: r.customerName,
  productName: r.productName,
  product: r.product,
  createdAt: r.createdAt,
  verifiedPurchase: true
});

// Keep Product.rating / numberOfReviews in sync with published reviews
export const refreshProductRating = async (productId) => {
  const [stats] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), status: 'published' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  await Product.updateOne(
    { _id: productId },
    { $set: { rating: stats ? Math.round(stats.avg * 10) / 10 : 0, numberOfReviews: stats?.count || 0 } }
  );
};

const summarize = async (match) => {
  const rows = await Review.aggregate([
    { $match: match },
    { $group: { _id: '$rating', count: { $sum: 1 } } }
  ]);
  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let total = 0;
  let sum = 0;
  rows.forEach(r => { breakdown[r._id] = r.count; total += r.count; sum += r._id * r.count; });
  return { average: total ? Math.round((sum / total) * 10) / 10 : 0, count: total, breakdown };
};

// ─────────────────────────── Public ───────────────────────────

// GET /reviews?product=<id>&page=1&limit=10
export const getReviews = async (request, reply) => {
  try {
    const { product, page = 1, limit = 10 } = request.query;
    const match = { status: 'published' };
    if (product) {
      if (!mongoose.Types.ObjectId.isValid(product)) {
        return reply.status(400).send({ success: false, message: 'Invalid product' });
      }
      match.product = new mongoose.Types.ObjectId(product);
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 10));

    const [reviews, summary] = await Promise.all([
      Review.find(match).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      summarize(match)
    ]);

    reply.header('Cache-Control', 'no-store');
    return reply.send({
      success: true,
      summary,
      page: pageNum,
      totalPages: Math.ceil(summary.count / limitNum),
      data: reviews.map(publicReview)
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    return reply.status(500).send({ success: false, message: 'Could not load reviews' });
  }
};

// GET /reviews/highlights?limit=6 — recent good reviews with a comment, for the homepage
export const getReviewHighlights = async (request, reply) => {
  try {
    const limit = Math.min(12, Math.max(1, parseInt(request.query.limit) || 6));
    const [reviews, summary] = await Promise.all([
      Review.find({ status: 'published', rating: { $gte: 4 }, comment: { $ne: '' } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      summarize({ status: 'published' })
    ]);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ success: true, summary, data: reviews.map(publicReview) });
  } catch (error) {
    return reply.status(500).send({ success: false, message: 'Could not load reviews' });
  }
};

// ─────────────────────────── Customer ───────────────────────────

// GET /reviews/mine — delivered items with the customer's review (if any)
export const getMyReviewables = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const orders = await Order.find({ user: userId, orderStatus: 'delivered' })
      .select('orderId products deliveredAt deliveryDeliveredAt createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const reviews = await Review.find({ user: userId }).lean();
    const byKey = new Map(reviews.map(r => [`${r.order}_${r.product}`, r]));

    const items = [];
    orders.forEach(order => {
      order.products.forEach(p => {
        const review = byKey.get(`${order._id}_${p.product}`);
        items.push({
          orderId: order._id,
          orderNumber: order.orderId,
          productId: p.product,
          productName: p.name,
          image: p.image || '',
          deliveredAt: order.deliveryDeliveredAt || order.deliveredAt || order.createdAt,
          review: review ? { _id: review._id, rating: review.rating, comment: review.comment, status: review.status } : null
        });
      });
    });

    return reply.send({ success: true, data: items });
  } catch (error) {
    console.error('Get my reviewables error:', error);
    return reply.status(500).send({ success: false, message: 'Could not load your orders' });
  }
};

// POST /reviews — create or update the review for one product of one delivered order
export const submitReview = async (request, reply) => {
  try {
    const userId = request.user.userId;
    const { orderId, productId, rating, comment = '' } = request.body || {};

    const stars = Number(rating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return reply.status(400).send({ success: false, message: 'Please choose 1 to 5 stars' });
    }
    if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(productId)) {
      return reply.status(400).send({ success: false, message: 'Invalid order or product' });
    }
    const text = String(comment).trim().slice(0, MAX_COMMENT);

    const order = await Order.findOne({ _id: orderId, user: userId }).lean();
    if (!order) return reply.status(404).send({ success: false, message: 'Order not found' });
    if (order.orderStatus !== 'delivered') {
      return reply.status(400).send({ success: false, message: 'You can review items after they are delivered' });
    }
    const item = order.products.find(p => String(p.product) === String(productId));
    if (!item) return reply.status(400).send({ success: false, message: 'This item is not in your order' });

    const user = await User.findById(userId).select('name').lean();
    const name = displayName(user?.name || order.name || order.shippingAddress?.name);

    const review = await Review.findOneAndUpdate(
      { order: orderId, product: productId },
      {
        $set: { rating: stars, comment: text, customerName: name, productName: item.name },
        $setOnInsert: { user: userId, order: orderId, product: productId, status: 'published' }
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    await refreshProductRating(productId);

    return reply.status(201).send({ success: true, message: 'Thank you for your review!', data: publicReview(review) });
  } catch (error) {
    console.error('Submit review error:', error);
    return reply.status(500).send({ success: false, message: 'Could not save your review' });
  }
};

// ─────────────────────────── Admin ───────────────────────────

// GET /admin/reviews?status=&rating=&page=
export const getAdminReviews = async (request, reply) => {
  try {
    const { status, rating, page = 1, limit = 20 } = request.query;
    const filter = {};
    if (status) filter.status = status;
    if (rating) filter.rating = Number(rating);
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const [reviews, total, summary] = await Promise.all([
      Review.find(filter)
        .populate('order', 'orderId')
        .populate('user', 'phoneNumber name')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Review.countDocuments(filter),
      summarize({ status: 'published' })
    ]);

    return reply.send({ success: true, data: reviews, total, page: pageNum, totalPages: Math.ceil(total / limitNum), summary });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// PATCH /admin/reviews/:id  { status: 'published' | 'hidden' }
export const updateReviewStatus = async (request, reply) => {
  try {
    const { status } = request.body || {};
    if (!['published', 'hidden'].includes(status)) {
      return reply.status(400).send({ success: false, message: 'Status must be published or hidden' });
    }
    const review = await Review.findByIdAndUpdate(request.params.id, { status }, { returnDocument: 'after' });
    if (!review) return reply.status(404).send({ success: false, message: 'Review not found' });
    await refreshProductRating(review.product);
    return reply.send({ success: true, message: status === 'hidden' ? 'Review hidden' : 'Review published', data: review });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// DELETE /admin/reviews/:id
export const deleteReview = async (request, reply) => {
  try {
    const review = await Review.findByIdAndDelete(request.params.id);
    if (!review) return reply.status(404).send({ success: false, message: 'Review not found' });
    await refreshProductRating(review.product);
    return reply.send({ success: true, message: 'Review deleted' });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};
