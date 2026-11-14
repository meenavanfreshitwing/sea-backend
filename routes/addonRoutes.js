import {
  getCheckoutAddons,
  adminListAddonCategories,
  adminCreateAddonCategory,
  adminUpdateAddonCategory,
  adminDeleteAddonCategory,
  adminListAddons,
  adminCreateAddon,
  adminUpdateAddon,
  adminDeleteAddon
} from '../controllers/addonController.js';
import { requireAdmin } from '../controllers/authController.js';

async function addonRoutes(fastify, options) {
  // Public: what to show on the checkout page
  fastify.get('/addons', getCheckoutAddons);

  // Admin: categories
  fastify.get('/admin/addon-categories', { preHandler: requireAdmin }, adminListAddonCategories);
  fastify.post('/admin/addon-categories', { preHandler: requireAdmin }, adminCreateAddonCategory);
  fastify.put('/admin/addon-categories/:id', { preHandler: requireAdmin }, adminUpdateAddonCategory);
  fastify.delete('/admin/addon-categories/:id', { preHandler: requireAdmin }, adminDeleteAddonCategory);

  // Admin: add-ons (photo upload goes to backend-images/addons/)
  const withImage = {
    preHandler: [requireAdmin, fastify.uploadImages, fastify.optimizeImages],
    config: { uploadFolder: 'addons' }
  };
  fastify.get('/admin/addons', { preHandler: requireAdmin }, adminListAddons);
  fastify.post('/admin/addons', withImage, adminCreateAddon);
  fastify.put('/admin/addons/:id', withImage, adminUpdateAddon);
  fastify.delete('/admin/addons/:id', { preHandler: requireAdmin }, adminDeleteAddon);
}

export default addonRoutes;
