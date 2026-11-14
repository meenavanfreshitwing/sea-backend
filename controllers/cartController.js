import Cart from '../models/Cart.js';
import Product from '../models/productModel.js';
import mongoose from 'mongoose';
import Addon from '../models/Addon.js';
import { isAddonAvailable } from '../services/addonService.js';
import { findVariant, resolveItemPrice } from '../services/locationPricing.js';
import { findActiveLocation, getRequestLocation, isLocationPricingEnabled } from '../services/locationService.js';

// Keep the cart's add-ons in line with the admin's settings: drop ones turned off or
// out of stock, update changed names/prices, and cap quantities at the stock left.
// Returns the names of removed add-ons (shown once on the cart page).
const refreshCartAddons = async (cart) => {
  if (!cart.addons?.length) return [];
  const ids = cart.addons.map(a => a.addon);
  const docs = await Addon.find({ _id: { $in: ids } }).populate('category', 'name isActive').lean();
  const byId = new Map(docs.map(d => [d._id.toString(), d]));
  const removed = [];
  cart.addons = cart.addons.filter(line => {
    const doc = byId.get(line.addon.toString());
    if (!isAddonAvailable(doc)) {
      removed.push(line.name || 'Add-on');
      return false;
    }
    if (line.price !== doc.price) line.price = doc.price;
    if (line.name !== doc.name) line.name = doc.name;
    if (line.categoryName !== doc.category.name) line.categoryName = doc.category.name;
    if ((line.image || null) !== (doc.image || null)) line.image = doc.image || null;
    if (line.quantity > doc.stock) line.quantity = doc.stock;
    return true;
  });
  return removed;
};

const recalcTotals = (cart) => {
  cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  cart.totalOriginalPrice = cart.items.reduce((sum, item) => sum + ((item.originalPrice || item.price) * item.quantity), 0);
  cart.totalSavings = cart.totalOriginalPrice - cart.totalPrice;
};

// Which location this cart is priced for: the one the app sent now, else the one saved
// on the cart (if still active). Updates cart.location. Returns the location id or null.
const pickCartLocation = async (request, cart) => {
  const requested = await getRequestLocation(request);
  if (requested) {
    if (String(cart.location || '') !== String(requested._id)) cart.location = requested._id;
    return requested._id;
  }
  if (cart.location) {
    const still = await findActiveLocation(cart.location);
    if (!still) cart.location = null;
    return still?._id || null;
  }
  return null;
};

// Re-price every cart item from the database for a location; drop items not sold there.
// Returns { pricesUpdated, removedItems } for the "Prices updated for your location" message.
const repriceCart = async (cart, locationId) => {
  const idOfItemProduct = (item) => (item.product?._id || item.product)?.toString();
  const ids = [...new Set(cart.items.map(idOfItemProduct).filter(Boolean))];
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map(p => [p._id.toString(), p]));

  const removedItems = [];
  let pricesUpdated = false;
  cart.items = cart.items.filter(item => {
    const product = byId.get(idOfItemProduct(item));
    if (!product) return true; // missing products are handled by getCart / checkout
    const variant = findVariant(product, item.variantId, item.variantName);
    if (product.variants?.length && item.variantId && !variant) return true;

    const priced = resolveItemPrice(product, variant, locationId);
    if (!priced.isAvailable) {
      removedItems.push(`${item.productName || product.name}${item.variantName ? ` (${item.variantName})` : ''}`);
      return false;
    }
    if (item.price !== priced.price) {
      item.price = priced.price;
      pricesUpdated = true;
    }
    item.originalPrice = priced.originalPrice;
    return true;
  });
  recalcTotals(cart);
  return { pricesUpdated, removedItems };
};

// Helper function to get product details
const getProductDetails = async (productId, variantId) => {
  const product = await Product.findById(productId);
  if (!product) return null;

  let price = product.basePrice;
  let originalPrice = product.originalPrice || product.basePrice;
  let variantName = '';
  let productName = product.name;
  let productImage = product.images?.[0]?.image || '';

  if (variantId) {
    const variant = product.variants?.find(v => 
      v._id?.toString() === variantId || v.variantName === variantId
    );
    if (variant) {
      price = variant.price;
      originalPrice = variant.originalPrice || variant.price;
      variantName = variant.variantName;
      productImage = variant.images?.[0]?.image || product.images?.[0]?.image || '';
    }
  }

  return { price, originalPrice, variantName, productName, productImage };
};


export const addToCart = async (request, reply) => {
  try {
    console.log('\n=== ADD TO CART DEBUG START ===');
    
    const { productId, quantity = 1, variantId, guestId } = request.body;
    console.log('Request body:', { productId, quantity, variantId, guestId });
    
    let userId = null;
    if (request.user) {
      userId = request.user.id || request.user.userId || request.user._id;
      console.log('Authenticated userId:', userId);
    }
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid product ID'
      });
    }
    
    const product = await Product.findById(productId);
    if (!product) {
      return reply.status(404).send({
        success: false,
        message: 'Product not found'
      });
    }
    console.log('Product found:', product.name);
    
    let selectedPrice = product.basePrice;
    let availableStock = product.stock;
    let variantName = '';
    let variantImage = '';
    let selectedVariant = null;
    // ✅ ADD WEIGHT VARIABLES
    let variantWeight = 0;
    let variantWeightUnit = 'gram';
    
    if (variantId && variantId !== '' && variantId !== 'undefined') {
      console.log('Looking for variant with ID:', variantId);
      
      selectedVariant = product.variants?.find(v => v._id?.toString() === variantId);
      if (!selectedVariant) {
        selectedVariant = product.variants?.find(v => v.variantName === variantId);
      }
      if (!selectedVariant) {
        const variantIndex = parseInt(variantId);
        if (!isNaN(variantIndex) && product.variants[variantIndex]) {
          selectedVariant = product.variants[variantIndex];
        }
      }
      
      if (selectedVariant) {
        selectedPrice = selectedVariant.price;
        availableStock = selectedVariant.stock;
        variantName = selectedVariant.variantName || selectedVariant.name || '';
        variantImage = selectedVariant.images?.[0]?.image || '';
        // ✅ ADD WEIGHT
        variantWeight = selectedVariant.weight || 0;
        variantWeightUnit = selectedVariant.weightUnit || 'gram';
        console.log('Variant found - Name:', variantName, 'Price:', selectedPrice, 'Stock:', availableStock, 'Weight:', variantWeight, variantWeightUnit);
      } else {
        console.log('⚠️ Variant NOT found for ID:', variantId);
      }
    }
    
    if (availableStock < quantity) {
      return reply.status(400).send({
        success: false,
        message: 'Insufficient stock'
      });
    }
    
    let cart;
    if (userId) {
      cart = await Cart.findOne({ user: userId });
    } else if (guestId) {
      cart = await Cart.findOne({ guestId });
    }
    
    if (!cart) {
      cart = new Cart({
        user: userId || null,
        guestId: guestId || null,
        items: []
      });
      console.log('Created new cart:', cart._id);
    } else {
      console.log('Found existing cart:', cart._id);
    }

    // Location price (falls back to the default price when the location has no override)
    let selectedOriginalPrice = selectedPrice;
    const locationPricing = isLocationPricingEnabled();
    if (locationPricing) {
      const locationId = await pickCartLocation(request, cart);
      const priced = resolveItemPrice(product, selectedVariant, locationId);
      if (!priced.isAvailable) {
        return reply.status(400).send({
          success: false,
          code: 'NOT_AVAILABLE_IN_LOCATION',
          message: `${product.name}${variantName ? ` (${variantName})` : ''} is not available in your location`
        });
      }
      selectedPrice = priced.price;
      selectedOriginalPrice = priced.originalPrice;
    }

    let finalProductImage = '';
    if (variantImage) {
      finalProductImage = variantImage;
      console.log('Using variant image:', finalProductImage);
    } else if (product.images && product.images.length > 0 && product.images[0].image) {
      finalProductImage = product.images[0].image;
      console.log('Using main product image:', finalProductImage);
    } else if (product.ogImage) {
      finalProductImage = product.ogImage;
      console.log('Using OG image:', finalProductImage);
    }
    
    const existingItemIndex = cart.items.findIndex(item => {
      const sameProduct = item.product.toString() === productId;
      const sameVariant = item.variantId === (variantId || '');
      return sameProduct && sameVariant;
    });
    
    if (existingItemIndex > -1) {
      console.log('Updating existing item at index:', existingItemIndex);
      cart.items[existingItemIndex].quantity = quantity;
      cart.items[existingItemIndex].price = selectedPrice;
      if (locationPricing) cart.items[existingItemIndex].originalPrice = selectedOriginalPrice;
      if (finalProductImage) {
        cart.items[existingItemIndex].productImage = finalProductImage;
      }
      if (variantName) {
        cart.items[existingItemIndex].variantName = variantName;
      }
      if (product.name) {
        cart.items[existingItemIndex].productName = product.name;
      }
      // ✅ ADD WEIGHT TO EXISTING ITEM
      if (selectedVariant) {
        cart.items[existingItemIndex].weight = variantWeight;
        cart.items[existingItemIndex].weightUnit = variantWeightUnit;
      }
    } else {
      console.log('Adding new item to cart');
      const newItem = {
        product: productId,
        quantity,
        price: selectedPrice,
        originalPrice: selectedOriginalPrice,
        variantId: variantId || '',
        variantName: variantName,
        productName: product.name,
        productImage: finalProductImage,
        // ✅ ADD WEIGHT TO NEW ITEM
        weight: variantWeight,
        weightUnit: variantWeightUnit
      };
      console.log('New item being added:', newItem);
      cart.items.push(newItem);
    }
    
    // The location may have changed: re-price the items already in the cart too
    let pricing = { pricesUpdated: false, removedItems: [] };
    if (locationPricing) {
      pricing = await repriceCart(cart, cart.location);
    } else {
      recalcTotals(cart);
    }

    await cart.save();
    console.log('Cart saved with', cart.items.length, 'items');
    
    await cart.populate('items.product', 'name basePrice images slug stock seller variants');
    
    for (const item of cart.items) {
      if (item.variantId && !item.productImage && item.product) {
        const populatedProduct = item.product;
        if (populatedProduct.variants && populatedProduct.variants.length > 0) {
          const variant = populatedProduct.variants.find(v => 
            v._id?.toString() === item.variantId || v.variantName === item.variantId
          );
          if (variant && variant.images && variant.images.length > 0) {
            item.productImage = variant.images[0].image;
          }
        }
      }
    }
    
    console.log('=== ADD TO CART DEBUG END ===\n');
    
    return reply.status(200).send({
      success: true,
      data: cart,
      guestId: guestId,
      pricesUpdated: pricing.pricesUpdated,
      ...(pricing.removedItems.length ? { removedItems: pricing.removedItems } : {})
    });
    
  } catch (error) {
    console.error('!!! ADD TO CART ERROR !!!');
    console.error('Error message:', error.message);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

// Get Cart (authenticated or guest)
export const getCart = async (request, reply) => {
  try {
    console.log('\n=== GET CART DEBUG START ===');
    
    let cart;
    
    // Try all possible user ID fields
    const userId = request.user?.id || request.user?.userId || request.user?._id;
    
    if (userId) {
      console.log('Fetching cart for userId:', userId);
      cart = await Cart.findOne({ user: userId })
        .populate('items.product', 'name basePrice images slug stock seller variants');
      console.log('Cart found:', cart ? 'YES' : 'NO');
    } else {
      console.log('No authenticated user, checking guest');
      const { guestId } = request.query;
      console.log('GuestId from query:', guestId);
      
      if (!guestId) {
        return reply.status(200).send({
          success: true,
          data: {
            items: [],
            totalItems: 0,
            totalPrice: 0
          }
        });
      }
      cart = await Cart.findOne({ guestId })
        .populate('items.product', 'name basePrice images slug stock seller variants');
      console.log('Guest cart found:', cart ? 'YES' : 'NO');
    }

    if (!cart) {
      return reply.status(200).send({
        success: true,
        data: {
          items: [],
          totalItems: 0,
          totalPrice: 0
        }
      });
    }

    console.log(`Cart has ${cart.items.length} items`);

    // Fish and packs change when admin edits a product. Re-link items to a pack with the
    // same name, and drop items whose fish or pack no longer exists (instead of failing at checkout).
    const removedItems = [];
    let cartChanged = false;
    cart.items = cart.items.filter(item => {
      const product = item.product;
      if (!product || !product._id) {
        removedItems.push(item.productName || 'Item');
        cartChanged = true;
        return false;
      }
      const variants = product.variants || [];
      if (!variants.length || !item.variantId) return true;
      if (variants.some(v => v._id?.toString() === String(item.variantId))) return true;
      const sameName = item.variantName && variants.find(v => v.variantName === item.variantName);
      if (sameName) {
        item.variantId = sameName._id.toString();
        item.price = sameName.price;
        item.weight = sameName.weight || 0;
        item.weightUnit = sameName.weightUnit || 'gram';
        cartChanged = true;
        return true;
      }
      removedItems.push(`${item.productName || product.name}${item.variantName ? ` (${item.variantName})` : ''}`);
      cartChanged = true;
      return false;
    });
    if (cartChanged) {
      cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      await cart.save();
    }

    // Location prices: re-price for the location the app sent (or the cart's saved one).
    // Also picks up price changes the admin made after the item was added.
    let pricesUpdated = false;
    if (isLocationPricingEnabled()) {
      const locationId = await pickCartLocation(request, cart);
      const pricing = await repriceCart(cart, locationId);
      pricesUpdated = pricing.pricesUpdated;
      removedItems.push(...pricing.removedItems);
      if (cart.isModified()) await cart.save();
    }

    // Add-ons: drop ones the admin turned off / sold out, refresh prices
    const removedAddons = await refreshCartAddons(cart);
    if (removedAddons.length || cart.isModified()) await cart.save();
    removedItems.push(...removedAddons);

    // Enrich cart items with variant images
    for (const item of cart.items) {
      console.log(`\nProcessing cart item ${item._id}:`);
      console.log(`  - variantId: ${item.variantId}`);
      console.log(`  - productImage: ${item.productImage}`);
      console.log(`  - variantName: ${item.variantName}`);
      
      // If item has variantId but no productImage, try to get from product variants
      if (item.variantId && !item.productImage && item.product) {
        const product = item.product;
        if (product.variants && product.variants.length > 0) {
          const variant = product.variants.find(v => 
            v._id?.toString() === item.variantId || v.variantName === item.variantId
          );
          if (variant && variant.images && variant.images.length > 0) {
            item.productImage = variant.images[0].image;
            console.log(`  ✅ Enriched with variant image: ${item.productImage}`);
          } else {
            console.log(`  ⚠️ Variant found but has no images`);
          }
        } else {
          console.log(`  ⚠️ Product has no variants`);
        }
      } else if (item.productImage) {
        console.log(`  ✅ Already has productImage: ${item.productImage}`);
      } else if (item.product && item.product.images && item.product.images.length > 0) {
        item.productImage = item.product.images[0].image;
        console.log(`  ✅ Using main product image: ${item.productImage}`);
      } else {
        console.log(`  ❌ No image found for this item`);
      }
    }

    console.log('=== GET CART DEBUG END ===\n');
    
    const data = cart.toObject();
    if (removedItems.length) data.removedItems = removedItems; // shown once on the cart page
    if (pricesUpdated) data.pricesUpdated = true;              // "Prices updated for your location"

    return reply.status(200).send({
      success: true,
      data
    });

  } catch (error) {
    console.error('!!! GET CART ERROR !!!');
    console.error(error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

// Merge guest cart with user cart after login
export const mergeCart = async (request, reply) => {
  try {
    const userId = request.user?.id || request.user?.userId || request.user?._id;
    const { guestId } = request.body;

    console.log('Merge Cart - UserId:', userId, 'GuestId:', guestId);

    if (!guestId) {
      return reply.status(400).send({
        success: false,
        message: 'Guest ID is required'
      });
    }

    // Get guest cart
    const guestCart = await Cart.findOne({ guestId });
    if (!guestCart || guestCart.items.length === 0) {
      return reply.status(200).send({
        success: true,
        message: 'No items to merge',
        data: await Cart.findOne({ user: userId })
      });
    }

    // Get or create user cart
    let userCart = await Cart.findOne({ user: userId });
    if (!userCart) {
      userCart = new Cart({
        user: userId,
        items: [],
        totalItems: 0,
        totalPrice: 0
      });
    }

    // Merge guest items into user cart
    for (const guestItem of guestCart.items) {
      const existingItemIndex = userCart.items.findIndex(item => {
        const sameProduct = item.product.toString() === guestItem.product.toString();
        const sameVariant = item.variantId === guestItem.variantId;
        return sameProduct && sameVariant;
      });

      if (existingItemIndex > -1) {
        userCart.items[existingItemIndex].quantity += guestItem.quantity;
      } else {
        userCart.items.push({
          product: guestItem.product,
          quantity: guestItem.quantity,
          price: guestItem.price,
          originalPrice: guestItem.originalPrice,
          variantId: guestItem.variantId,
          variantName: guestItem.variantName,
          productName: guestItem.productName,
          productImage: guestItem.productImage
        });
      }
    }

    // Merge add-ons picked as a guest, then re-check them (stock / turned off)
    for (const guestAddon of guestCart.addons || []) {
      const existing = userCart.addons.find(a => String(a.addon) === String(guestAddon.addon));
      if (existing) existing.quantity += guestAddon.quantity;
      else userCart.addons.push(guestAddon.toObject ? guestAddon.toObject() : guestAddon);
    }
    await refreshCartAddons(userCart);

    // Recalculate totals (with location prices: the guest's location wins, it is the latest choice)
    if (isLocationPricingEnabled()) {
      if (guestCart.location) userCart.location = guestCart.location;
      const locationId = await pickCartLocation(request, userCart);
      await repriceCart(userCart, locationId);
    } else {
      recalcTotals(userCart);
    }

    await userCart.save();
    
    // Delete guest cart
    await Cart.deleteOne({ guestId });

    await userCart.populate('items.product', 'name basePrice images slug stock seller variants');

    // Enrich merged cart items with variant images
    for (const item of userCart.items) {
      if (item.variantId && !item.productImage && item.product) {
        const product = item.product;
        if (product.variants && product.variants.length > 0) {
          const variant = product.variants.find(v => 
            v._id?.toString() === item.variantId || v.variantName === item.variantId
          );
          if (variant && variant.images && variant.images.length > 0) {
            item.productImage = variant.images[0].image;
          }
        }
      }
    }

    return reply.status(200).send({
      success: true,
      message: 'Cart merged successfully',
      data: userCart
    });

  } catch (error) {
    console.error('Merge Cart Error:', error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

// Update Cart Item Quantity
export const updateCartItem = async (request, reply) => {
  try {
    const { itemId } = request.params;
    const { quantity } = request.body;
    const userId = request.user?.id || request.user?.userId || request.user?._id;
    const { guestId } = request.body;

    if (!quantity || quantity < 1) {
      return reply.status(400).send({
        success: false,
        message: 'Quantity must be at least 1'
      });
    }

    let cart;
    if (userId) {
      cart = await Cart.findOne({ user: userId });
    } else if (guestId) {
      cart = await Cart.findOne({ guestId });
    }

    if (!cart) {
      return reply.status(404).send({
        success: false,
        message: 'Cart not found'
      });
    }

    const cartItem = cart.items.id(itemId);
    if (!cartItem) {
      return reply.status(404).send({
        success: false,
        message: 'Cart item not found'
      });
    }

    // Check stock
    const product = await Product.findById(cartItem.product);
    let availableStock = product.stock;
    if (cartItem.variantId) {
      const variant = product.variants?.find(v => 
        v._id?.toString() === cartItem.variantId || v.variantName === cartItem.variantId
      );
      if (variant) availableStock = variant.stock;
    }

    if (availableStock < quantity) {
      return reply.status(400).send({
        success: false,
        message: 'Insufficient stock'
      });
    }

    cartItem.quantity = quantity;
    
    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    cart.totalOriginalPrice = cart.items.reduce((sum, item) => sum + ((item.originalPrice || item.price) * item.quantity), 0);
    cart.totalSavings = cart.totalOriginalPrice - cart.totalPrice;
    
    await cart.save();
    
    await cart.populate('items.product', 'name basePrice images slug stock seller variants');

    // Enrich with variant images
    for (const item of cart.items) {
      if (item.variantId && !item.productImage && item.product) {
        const populatedProduct = item.product;
        if (populatedProduct.variants && populatedProduct.variants.length > 0) {
          const variant = populatedProduct.variants.find(v => 
            v._id?.toString() === item.variantId || v.variantName === item.variantId
          );
          if (variant && variant.images && variant.images.length > 0) {
            item.productImage = variant.images[0].image;
          }
        }
      }
    }

    return reply.status(200).send({
      success: true,
      data: cart
    });

  } catch (error) {
    console.error('Update Cart Error:', error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

// Remove Item from Cart
export const removeFromCart = async (request, reply) => {
  try {
    const { itemId } = request.params;
    const userId = request.user?.id || request.user?.userId || request.user?._id;
const { guestId } = request.body || {};
    let cart;
    if (userId) {
      cart = await Cart.findOne({ user: userId });
    } else if (guestId) {
      cart = await Cart.findOne({ guestId });
    }

    if (!cart) {
      return reply.status(404).send({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items.pull(itemId);
    
    cart.totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    cart.totalPrice = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    cart.totalOriginalPrice = cart.items.reduce((sum, item) => sum + ((item.originalPrice || item.price) * item.quantity), 0);
    cart.totalSavings = cart.totalOriginalPrice - cart.totalPrice;
    
    await cart.save();
    
    await cart.populate('items.product', 'name basePrice images slug stock seller variants');

    // Enrich with variant images
    for (const item of cart.items) {
      if (item.variantId && !item.productImage && item.product) {
        const populatedProduct = item.product;
        if (populatedProduct.variants && populatedProduct.variants.length > 0) {
          const variant = populatedProduct.variants.find(v => 
            v._id?.toString() === item.variantId || v.variantName === item.variantId
          );
          if (variant && variant.images && variant.images.length > 0) {
            item.productImage = variant.images[0].image;
          }
        }
      }
    }

    return reply.status(200).send({
      success: true,
      data: cart
    });

  } catch (error) {
    console.error('Remove from Cart Error:', error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

// Clear Cart
export const clearCart = async (request, reply) => {
  try {
    const userId = request.user?.id || request.user?.userId || request.user?._id;
const { guestId } = request.body || {};
    let cart;
    if (userId) {
      cart = await Cart.findOne({ user: userId });
    } else if (guestId) {
      cart = await Cart.findOne({ guestId });
    }

    if (!cart) {
      return reply.status(404).send({
        success: false,
        message: 'Cart not found'
      });
    }

    cart.items = [];
    cart.totalItems = 0;
    cart.totalPrice = 0;
    cart.totalOriginalPrice = 0;
    cart.totalSavings = 0;
    
    await cart.save();

    return reply.status(200).send({
      success: true,
      message: 'Cart cleared successfully',
      data: cart
    });

  } catch (error) {
    console.error('Clear Cart Error:', error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};

export const clearGuestCart = async (request, reply) => {
  try {
    const { guestId } = request.body;
    
    if (!guestId) {
      return reply.status(400).send({
        success: false,
        message: 'Guest ID required'
      });
    }
    
    const cart = await Cart.findOne({ guestId });
    if (!cart) {
      return reply.status(200).send({
        success: true,
        message: 'No cart found'
      });
    }
    
    // Clear all items
    cart.items = [];
    cart.totalItems = 0;
    cart.totalPrice = 0;
    cart.totalOriginalPrice = 0;
    cart.totalSavings = 0;
    
    await cart.save();
    
    return reply.status(200).send({
      success: true,
      message: 'Cart cleared successfully',
      data: cart
    });
    
  } catch (error) {
    console.error('Clear Guest Cart Error:', error);
    return reply.status(500).send({
      success: false,
      message: error.message
    });
  }
};
// PUT /api/cart/addons  { addonId, quantity, guestId? }
// Sets how many of one add-on are in the cart (quantity 0 removes it).
// Add-ons are only sold with fish, so the cart must have at least one fish.
export const setCartAddon = async (request, reply) => {
  try {
    const userId = request.user?.id || request.user?.userId || request.user?._id;
    const { addonId, guestId } = request.body || {};
    const quantity = parseInt(request.body?.quantity, 10);

    if (!mongoose.Types.ObjectId.isValid(addonId)) {
      return reply.status(400).send({ success: false, message: 'Invalid add-on' });
    }
    if (isNaN(quantity) || quantity < 0) {
      return reply.status(400).send({ success: false, message: 'Quantity must be 0 or more' });
    }

    let cart = null;
    if (userId) cart = await Cart.findOne({ user: userId });
    else if (guestId) cart = await Cart.findOne({ guestId });
    if (!cart || !cart.items.length) {
      return reply.status(400).send({ success: false, code: 'CART_EMPTY', message: 'Add fish to your cart first' });
    }

    const index = cart.addons.findIndex(a => String(a.addon) === String(addonId));
    if (quantity === 0) {
      if (index > -1) cart.addons.splice(index, 1);
    } else {
      const addon = await Addon.findById(addonId).populate('category', 'name isActive').lean();
      if (!isAddonAvailable(addon)) {
        return reply.status(400).send({ success: false, code: 'ADDON_UNAVAILABLE', message: `${addon?.name || 'This add-on'} is not available right now` });
      }
      if (addon.stock < quantity) {
        return reply.status(400).send({ success: false, code: 'ADDON_OUT_OF_STOCK', message: `Only ${addon.stock} ${addon.name} left` });
      }
      const line = {
        addon: addon._id,
        name: addon.name,
        categoryName: addon.category.name,
        price: addon.price,
        quantity,
        image: addon.image || null
      };
      if (index > -1) Object.assign(cart.addons[index], line);
      else cart.addons.push(line);
    }

    await cart.save(); // totals (incl. add-ons) are worked out by the Cart model
    await cart.populate('items.product', 'name basePrice images slug stock seller variants');
    return reply.send({ success: true, data: cart });
  } catch (error) {
    console.error('Set cart add-on error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};
