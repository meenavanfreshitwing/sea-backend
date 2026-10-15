import mongoose from 'mongoose';
import slugify from 'slugify';

const blogSchema = new mongoose.Schema({
  title: { type: String, required: [true, 'Title is required'], trim: true },
  slug: { type: String, unique: true, sparse: true },
  description: { type: String, required: [true, 'Description is required'], trim: true },
  content: { type: String, required: [true, 'Content is required'] },

  // R2 keys (clients prefix them with the R2 public URL)
  image: { type: String, default: '' },
  imageAlt: { type: String, default: '' },
  excerpt: { type: String, default: '' },

  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  authorName: { type: String, default: '' },
  category: { type: String, trim: true, default: '' },
  tags: [{ type: String, trim: true }],
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },

  // SEO
  metaTitle: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  metaKeywords: [{ type: String, trim: true }],
  canonicalUrl: { type: String, default: '' },
  ogTitle: { type: String, default: '' },
  ogDescription: { type: String, default: '' },
  ogImage: { type: String, default: '' },

  // Stats
  readTime: { type: Number, default: 1 },
  views: { type: Number, default: 0 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [{ type: mongoose.Schema.Types.Mixed }],

  publishedAt: { type: Date, default: null }
}, {
  timestamps: true
});

blogSchema.pre('save', async function () {
  if (this.isModified('title')) {
    const baseSlug = slugify(this.title, { lower: true, strict: true }) || 'blog';
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const existing = await this.constructor.findOne({ slug });
      if (!existing || existing._id.equals(this._id)) break;
      slug = `${baseSlug}-${counter++}`;
    }
    this.slug = slug;
  }

  if (this.isModified('content')) {
    const words = this.content.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
    this.readTime = Math.max(1, Math.ceil(words / 200));
  }

  if (this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
});

blogSchema.index({ status: 1, createdAt: -1 });
blogSchema.index({ tags: 1 });

const Blog = mongoose.model('Blog', blogSchema);
export default Blog;
