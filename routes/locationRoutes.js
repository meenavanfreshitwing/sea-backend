import {
  getPublicLocations,
  resolvePincode,
  saveMyLocation,
  getMyLocation,
  adminListLocations,
  adminCreateLocation,
  adminUpdateLocation,
  adminDeleteLocation,
  adminGetLocationPrices,
  adminUpdateLocationPrices,
  appVersionCheck
} from '../controllers/locationController.js';
import { requireAdmin, requireStrictAuth } from '../controllers/authController.js';

async function locationRoutes(fastify, options) {
  // Public
  fastify.get('/locations', getPublicLocations);
  fastify.get('/locations/resolve', resolvePincode);
  fastify.get('/app/version-check', appVersionCheck);

  // Logged-in customer: saved location
  fastify.get('/auth/location', { preHandler: requireStrictAuth }, getMyLocation);
  fastify.put('/auth/location', { preHandler: requireStrictAuth }, saveMyLocation);

  // Admin
  fastify.get('/admin/locations', { preHandler: requireAdmin }, adminListLocations);
  fastify.post('/admin/locations', { preHandler: requireAdmin }, adminCreateLocation);
  fastify.put('/admin/locations/:id', { preHandler: requireAdmin }, adminUpdateLocation);
  fastify.delete('/admin/locations/:id', { preHandler: requireAdmin }, adminDeleteLocation);
  fastify.get('/admin/locations/:id/prices', { preHandler: requireAdmin }, adminGetLocationPrices);
  fastify.put('/admin/locations/:id/prices', { preHandler: requireAdmin }, adminUpdateLocationPrices);
}

export default locationRoutes;
