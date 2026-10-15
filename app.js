// Load .env before any other module reads process.env
import './config/env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rawBody from 'fastify-raw-body';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import productRoutes from './routes/productRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import { requireAdmin } from './controllers/authController.js';
import { uploadImages, optimizeImages } from './middleware/uploadMiddleware.js';
import cartRoutes from './routes/cartRoutes.js';
import termsRoutes from './routes/termsRoutes.js';
import privacyRoutes from './routes/privacyRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import adminUserRoutes from './routes/adminUserRoutes.js';
import wardRoutes from './routes/wardRoutes.js';
import blogRoutes from './routes/blogRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';

// ✅ ADD THESE IMPORTS FOR DELIVERY BOY
import deliveryRoutes from './routes/deliveryRoutes.js';
import adminDeliveryRoutes from './routes/adminDeliveryRoutes.js';

// ✅ ADD THESE IMPORTS FOR SHIPPING & RETURNS
import shippingRoutes from './routes/shippingRoutes.js';
import returnRoutes from './routes/returnRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fail fast with a clear message instead of crashing later
const missingEnv = ['MONGODB_URI', 'JWT_SECRET'].filter(key => !process.env[key]);
if (missingEnv.length) {
  console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')} (see .env.example)`);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT) || 5000;

const fastify = Fastify({
  logger: true
});

await fastify.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});

// Connect to MongoDB
connectDB();

// Parse CORS origins from environment variable.
// "*" (or unset) reflects the request origin, which also works with credentials.
const getAllowedOrigins = () => {
  const origins = (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return origins.includes('*') ? ['*'] : origins;
};
const allowedOrigins = getAllowedOrigins();

// Register plugins
await fastify.register(cors, {
  origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET
});

await fastify.register(multipart, {
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024
  }
});

// Decorate middleware globally
fastify.decorate('requireAdmin', requireAdmin);
fastify.decorate('uploadImages', uploadImages);
fastify.decorate('optimizeImages', optimizeImages);

// ADD TEST ROUTE HERE
fastify.get('/api/test', async (request, reply) => {
  return {
    success: true,
    message: 'Server working'
  };
});

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(categoryRoutes, { prefix: '/api' });
await fastify.register(productRoutes, { prefix: '/api' });
await fastify.register(cartRoutes, { prefix: '/api' });
await fastify.register(contactRoutes, { prefix: '/api' });
await fastify.register(termsRoutes, { prefix: '/api' });
await fastify.register(privacyRoutes, { prefix: '/api' });
await fastify.register(orderRoutes, { prefix: '/api' });
await fastify.register(paymentRoutes, { prefix: '/api' });
await fastify.register(settingsRoutes, { prefix: '/api' });
await fastify.register(statsRoutes, { prefix: '/api' });
await fastify.register(adminUserRoutes, { prefix: '/api' });
await fastify.register(wardRoutes, { prefix: '/api' });
await fastify.register(blogRoutes, { prefix: '/api' });
await fastify.register(bookingRoutes, { prefix: '/api' });
await fastify.register(reviewRoutes, { prefix: '/api' });

// ✅ ADD DELIVERY BOY ROUTES
await fastify.register(deliveryRoutes, { prefix: '/api' });
await fastify.register(adminDeliveryRoutes, { prefix: '/api' });

// ✅ ADD SHIPPING & RETURNS ROUTES
await fastify.register(shippingRoutes, { prefix: '/api' });
await fastify.register(returnRoutes, { prefix: '/api' });

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
  console.error(error);
  reply.status(error.statusCode || 500).send({
    success: false,
    message: error.message || 'Internal server error'
  });
});

const start = async () => {
  try {
    await fastify.listen({
      port: PORT,
      host: process.env.HOST || '0.0.0.0'
    });
    console.log(`Server running on port ${PORT}`);
    console.log(`CORS enabled for origins: ${allowedOrigins.join(', ')}`);
    console.log(`✅ Images served from Cloudflare R2`);
    console.log(`Contact routes registered at: /api/contacts`);
    console.log(`Stats routes registered at: /api/stats`);
    console.log(`✅ Delivery boy routes registered at: /api/delivery`);
    console.log(`✅ Admin delivery routes registered at: /api/admin/delivery-boys`);
    console.log(`✅ Shipping routes registered at: /api/shipping`);
    console.log(`✅ Returns routes registered at: /api/returns`);
    console.log(`✅ Blog routes registered at: /api/blogs`);
    console.log(`✅ Booking routes registered at: /api/booking`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();