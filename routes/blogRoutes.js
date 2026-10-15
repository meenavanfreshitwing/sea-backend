import {
  getBlogs,
  getBlogCategories,
  getBlogTags,
  getBlogById,
  getBlogBySlug,
  getRelatedBlogs,
  createBlog,
  updateBlog,
  deleteBlog,
  toggleLike
} from '../controllers/blogController.js';
import { requireAdmin, requireStrictAuth } from '../controllers/authController.js';

// Blog images go to backend-images/blogs/ and keep more detail than product thumbnails
const uploadConfig = { uploadFolder: 'blogs', imageMaxSize: 1200 };

async function blogRoutes(fastify, options) {
  // Public routes (static paths before /blogs/:slug)
  fastify.get('/blogs', getBlogs);
  fastify.get('/blogs/categories', getBlogCategories);
  fastify.get('/blogs/tags', getBlogTags);
  fastify.get('/blogs/id/:id', { preHandler: requireAdmin }, getBlogById);
  fastify.get('/blogs/:id/related', getRelatedBlogs);
  fastify.get('/blogs/:slug', getBlogBySlug);

  // Logged-in users
  fastify.post('/blogs/:id/like', { preHandler: requireStrictAuth }, toggleLike);

  // Admin only
  fastify.post('/blogs', {
    config: uploadConfig,
    preHandler: [requireAdmin, fastify.uploadImages, fastify.optimizeImages]
  }, createBlog);

  fastify.put('/blogs/:id', {
    config: uploadConfig,
    preHandler: [requireAdmin, fastify.uploadImages, fastify.optimizeImages]
  }, updateBlog);

  fastify.delete('/blogs/:id', { preHandler: requireAdmin }, deleteBlog);
}

export default blogRoutes;
