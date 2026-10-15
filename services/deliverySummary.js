// Product-wise totals per delivery date: how much of each fish to buy, pack and deliver.
// Pure functions (no database), so they are easy to test.

const toGrams = (weight, unit) => {
  if (!weight || weight <= 0) return null;
  if (unit === 'kg') return weight * 1000;
  if (unit === 'gram' || !unit) return weight;
  return null;
};

const toMl = (weight, unit) => {
  if (!weight || weight <= 0) return null;
  if (unit === 'liter') return weight * 1000;
  if (unit === 'ml') return weight;
  return null;
};

// "500g", "1 kg", "1.5kg", "750 gm", "2 pcs" -> { weight, unit } (used when a pack has no weight set)
export const weightFromPackName = name => {
  const text = String(name || '').toLowerCase().replace(',', '.');
  const kg = text.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|kilogram|kilograms)\b/);
  if (kg) return { weight: parseFloat(kg[1]) * 1000, unit: 'gram' };
  const g = text.match(/(\d+(?:\.\d+)?)\s*(g|gm|gms|gram|grams)\b/);
  if (g) return { weight: parseFloat(g[1]), unit: 'gram' };
  const pc = text.match(/(\d+)\s*(pc|pcs|piece|pieces|nos?)\b/);
  if (pc) return { weight: parseInt(pc[1], 10), unit: 'piece' };
  return null;
};

// Orders that will really be delivered: not cancelled, and online orders only once paid
export const isCountableOrder = order =>
  order.orderStatus !== 'cancelled' &&
  !(order.paymentMethod !== 'cod' && order.paymentStatus !== 'completed');

const packLabel = (item, weight, unit) => {
  if (item.variantName) return item.variantName;
  if (weight > 0) return unit === 'piece' ? `${weight} pc` : `${weight} ${unit === 'gram' ? 'g' : unit}`;
  return 'No pack chosen';
};

/**
 * @param orders   orders with { orderId, deliveryDate, orderStatus, paymentMethod, paymentStatus, products[] }
 * @param products Map of productId -> current product (used for names and for weights that
 *                 old orders did not store)
 */
export const buildDeliverySummary = (orders, products = new Map()) => {
  const byDate = new Map();
  const overall = new Map();

  const bucket = (map, key, item, product) => {
    if (!map.has(key)) {
      map.set(key, {
        productId: key,
        name: product?.name || item.name || 'Unknown fish',
        orders: new Set(),
        quantity: 0,
        grams: 0,
        ml: 0,
        pieces: 0,
        noWeightQty: 0,
        packs: new Map(),
      });
    }
    return map.get(key);
  };

  const addLine = (entry, order, item, weight, unit) => {
    const qty = Number(item.quantity) || 0;
    entry.orders.add(order.orderId || String(order._id));
    entry.quantity += qty;
    const grams = toGrams(weight, unit);
    const ml = toMl(weight, unit);
    if (grams !== null) entry.grams += grams * qty;
    else if (ml !== null) entry.ml += ml * qty;
    else if (unit === 'piece' && weight > 0) entry.pieces += weight * qty;
    else entry.noWeightQty += qty;
    const label = packLabel(item, weight, unit);
    entry.packs.set(label, (entry.packs.get(label) || 0) + qty);
  };

  for (const order of orders) {
    if (!isCountableOrder(order)) continue;
    const date = order.deliveryDate || 'no-date';
    if (!byDate.has(date)) byDate.set(date, { date, orders: new Set(), cashToCollect: 0, paidOnline: 0, delivered: 0, products: new Map() });
    const day = byDate.get(date);
    const orderKey = order.orderId || String(order._id);
    if (!day.orders.has(orderKey)) {
      day.orders.add(orderKey);
      const amount = Number(order.finalAmount) || 0;
      if (order.paymentMethod === 'cod' && order.paymentStatus !== 'completed') day.cashToCollect += amount;
      else day.paidOnline += amount;
      if (order.orderStatus === 'delivered') day.delivered += 1;
    }

    for (const item of order.products || []) {
      const productId = String(item.product?._id || item.product || item.name);
      const product = products.get(productId);
      let weight = Number(item.weight) || 0;
      let unit = item.weightUnit || 'gram';
      // Older orders were saved without the pack weight: use the pack's current weight
      if (!weight && product?.variants?.length) {
        const pack = product.variants.find(v => String(v._id) === String(item.variantId)) ||
          product.variants.find(v => item.variantName && v.variantName === item.variantName);
        if (pack?.weight) {
          weight = pack.weight;
          unit = pack.weightUnit || 'gram';
        }
      }
      // Pack without a weight set: read it from the pack name ("500g", "1 kg")
      if (!weight) {
        const fromName = weightFromPackName(item.variantName);
        if (fromName) ({ weight, unit } = fromName);
      }
      addLine(bucket(day.products, productId, item, product), order, item, weight, unit);
      addLine(bucket(overall, productId, item, product), order, item, weight, unit);
    }
  }

  const finishProducts = map =>
    [...map.values()]
      .map(p => ({
        productId: p.productId,
        name: p.name,
        orderCount: p.orders.size,
        quantity: p.quantity,
        totalKg: Math.round(p.grams) / 1000,
        totalLitres: Math.round(p.ml) / 1000,
        pieces: p.pieces,
        noWeightQty: p.noWeightQty,
        packs: [...p.packs.entries()].map(([label, qty]) => ({ label, qty })),
      }))
      .sort((a, b) => b.totalKg - a.totalKg || b.quantity - a.quantity || a.name.localeCompare(b.name));

  const sumKg = list => Math.round(list.reduce((s, p) => s + p.totalKg * 1000, 0)) / 1000;

  const dates = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const productsList = finishProducts(d.products);
      return {
        date: d.date,
        orderCount: d.orders.size,
        deliveredCount: d.delivered,
        cashToCollect: Math.round(d.cashToCollect * 100) / 100,
        paidOnline: Math.round(d.paidOnline * 100) / 100,
        totalKg: sumKg(productsList),
        products: productsList,
      };
    });

  const overallProducts = finishProducts(overall);
  return {
    dates,
    overall: {
      orderCount: dates.reduce((s, d) => s + d.orderCount, 0),
      totalKg: sumKg(overallProducts),
      products: overallProducts,
    },
  };
};
