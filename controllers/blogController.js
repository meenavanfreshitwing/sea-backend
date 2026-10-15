import mongoose from 'mongoose';
import Blog from '../models/Blog.js';
import { deleteFromR2 } from '../middleware/uploadMiddleware.js';

const TEXT_FIELDS = [
  'title', 'description', 'content', 'imageAlt', 'excerpt', 'category', 'status',
  'metaTitle', 'metaDescription', 'canonicalUrl', 'ogTitle', 'ogDescription'
];

// Accepts "a, b", '["a","b"]' or an array
const parseList = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  const str = String(value).trim();
  if (str.startsWith('[')) {
    try { return parseList(JSON.parse(str)); } catch { /* fall through to CSV */ }
  }
  return str.split(',').map(v => v.trim()).filter(Boolean);
};

// Admin token is optional on public routes; it unlocks drafts/archived posts
const isAdminRequest = async (request) => {
  try {
    await request.jwtVerify();
    return request.user?.role === 'admin';
  } catch {
    return false;
  }
};

const applyFields = (blog, body) => {
  TEXT_FIELDS.forEach(field => {
    if (body[field] !== undefined) blog[field] = body[field];
  });
  if (body.tags !== undefined) blog.tags = parseList(body.tags);
  if (body.metaKeywords !== undefined) blog.metaKeywords = parseList(body.metaKeywords);
};

const applyUploadedImages = async (blog, files) => {
  const image = files.find(f => f.fieldname === 'image');
  const ogImage = files.find(f => f.fieldname === 'ogImage');

  if (image) {
    if (blog.image) await deleteFromR2(blog.image);
    blog.image = image.key;
  }
  if (ogImage) {
    if (blog.ogImage && blog.ogImage !== blog.image) await deleteFromR2(blog.ogImage);
    blog.ogImage = ogImage.key;
  }
};

// GET /blogs
export const getBlogs = async (request, reply) => {
  try {
    const { page = 1, limit = 12, status, category, tag, search, sort = '-createdAt' } = request.query;
    const admin = await isAdminRequest(request);

    const filter = {};
    if (admin) {
      // Admin panel sends status='' to list everything
      if (status) filter.status = status;
    } else {
      filter.status = 'published';
    }
    if (category) filter.category = category;
    if (tag) filter.tags = tag;
    if (search && search.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }, { tags: regex }];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 12));
    const sortField = String(sort).replace(/^-/, '');
    const sortConfig = { [sortField]: String(sort).startsWith('-') ? -1 : 1 };

    const [blogs, total] = await Promise.all([
      Blog.find(filter).sort(sortConfig).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Blog.countDocuments(filter)
    ]);

    return reply.send({
      success: true,
      count: blogs.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: blogs
    });
  } catch (error) {
    console.error('Get blogs error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /blogs/categories
export const getBlogCategories = async (request, reply) => {
  try {
    const categories = (await Blog.distinct('category', { status: 'published' })).filter(Boolean).sort();
    return reply.send({ success: true, count: categories.length, data: categories });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /blogs/tags
export const getBlogTags = async (request, reply) => {
  try {
    const tags = await Blog.aggregate([
      { $match: { status: 'published' } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $project: { _id: 0, tag: '$_id', count: 1 } }
    ]);
    return reply.send({ success: true, count: tags.length, data: tags });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /blogs/id/:id
export const getBlogById = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Invalid blog ID' });
    }
    const blog = await Blog.findById(id).lean();
    if (!blog) return reply.status(404).send({ success: false, message: 'Blog not found' });
    return reply.send({ success: true, data: blog });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /blogs/:slug
export const getBlogBySlug = async (request, reply) => {
  try {
    const admin = await isAdminRequest(request);
    const filter = { slug: request.params.slug };
    if (!admin) filter.status = 'published';

    const blog = await Blog.findOneAndUpdate(filter, { $inc: { views: 1 } }, { returnDocument: 'after' }).lean();
    if (!blog) return reply.status(404).send({ success: false, message: 'Blog not found' });
    return reply.send({ success: true, data: blog });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// GET /blogs/:id/related
export const getRelatedBlogs = async (request, reply) => {
  try {
    const { id } = request.params;
    const limit = Math.min(20, parseInt(request.query.limit) || 3);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Invalid blog ID' });
    }
    const blog = await Blog.findById(id).lean();
    if (!blog) return reply.status(404).send({ success: false, message: 'Blog not found' });

    const or = [];
    if (blog.category) or.push({ category: blog.category });
    if (blog.tags?.length) or.push({ tags: { $in: blog.tags } });

    const filter = { _id: { $ne: blog._id }, status: 'published' };
    if (or.length) filter.$or = or;

    let related = await Blog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    if (related.length === 0) {
      related = await Blog.find({ _id: { $ne: blog._id }, status: 'published' })
        .sort({ createdAt: -1 }).limit(limit).lean();
    }

    return reply.send({
      success: true,
      count: related.length,
      total: related.length,
      totalPages: 1,
      currentPage: 1,
      data: related
    });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// POST /blogs (admin)
export const createBlog = async (request, reply) => {
  try {
    const body = request.body || {};
    const blog = new Blog({ author: request.user?.userId || null, authorName: request.user?.name || 'Admin' });
    applyFields(blog, body);
    await applyUploadedImages(blog, request.uploadedFiles || []);

    await blog.save();
    return reply.status(201).send({ success: true, message: 'Blog created successfully', data: blog });
  } catch (error) {
    console.error('Create blog error:', error);
    const status = error.name === 'ValidationError' ? 400 : 500;
    return reply.status(status).send({ success: false, message: error.message });
  }
};

// PUT /blogs/:id (admin)
export const updateBlog = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Invalid blog ID' });
    }
    const blog = await Blog.findById(id);
    if (!blog) return reply.status(404).send({ success: false, message: 'Blog not found' });

    applyFields(blog, request.body || {});
    await applyUploadedImages(blog, request.uploadedFiles || []);

    await blog.save();
    return reply.send({ success: true, message: 'Blog updated successfully', data: blog });
  } catch (error) {
    console.error('Update blog error:', error);
    const status = error.name === 'ValidationError' ? 400 : 500;
    return reply.status(status).send({ success: false, message: error.message });
  }
};

// DELETE /blogs/:id (admin)
export const deleteBlog = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Invalid blog ID' });
    }
    const blog = await Blog.findByIdAndDelete(id);
    if (!blog) return reply.status(404).send({ success: false, message: 'Blog not found' });

    if (blog.image) await deleteFromR2(blog.image);
    if (blog.ogImage && blog.ogImage !== blog.image) await deleteFromR2(blog.ogImage);

    return reply.send({ success: true, message: 'Blog deleted successfully' });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// POST /blogs/:id/like (logged-in users)
export const toggleLike = async (request, reply) => {
  try {
    const { id } = request.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Invalid blog ID' });
    }
    const blog = await Blog.findById(id);
    if (!blog) return reply.status(404).send({ success: false, message: 'Blog not found' });

    const userId = String(request.user.userId);
    const index = blog.likes.findIndex(u => String(u) === userId);
    const isLiked = index === -1;
    if (isLiked) blog.likes.push(userId);
    else blog.likes.splice(index, 1);

    await blog.save();
    return reply.send({
      success: true,
      message: isLiked ? 'Blog liked' : 'Blog unliked',
      likesCount: blog.likes.length,
      isLiked
    });
  } catch (error) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};
