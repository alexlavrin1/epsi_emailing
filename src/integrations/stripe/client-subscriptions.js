function objectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function timestamp(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}

function normalizeSubscription(subscription, products = new Map()) {
  const item = subscription.items?.data?.[0] || null;
  const price = item?.price || null;
  const productRef = price?.product || null;
  const product = typeof productRef === 'string' ? products.get(productRef) || null : productRef;
  const latestInvoice = subscription.latest_invoice;
  return {
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    product_name: product && typeof product === 'object' && !product.deleted ? product.name || null : null,
    price_nickname: price?.nickname || null,
    quantity: Number.isInteger(item?.quantity) ? item.quantity : null,
    unit_amount: Number.isSafeInteger(price?.unit_amount) ? price.unit_amount : null,
    currency: price?.currency || null,
    billing_interval: price?.recurring?.interval || null,
    interval_count: Number.isInteger(price?.recurring?.interval_count) ? price.recurring.interval_count : null,
    current_period_start: timestamp(subscription.current_period_start),
    current_period_end: timestamp(subscription.current_period_end),
    trial_end: timestamp(subscription.trial_end),
    cancel_at: timestamp(subscription.cancel_at),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    canceled_at: timestamp(subscription.canceled_at),
    latest_invoice_status: latestInvoice && typeof latestInvoice === 'object' ? latestInvoice.status || null : null,
  };
}

async function syncClientSubscriptions({ clientAppId, stripeCustomerId, stripe, db }) {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (!customer || customer.deleted) {
      const error = new Error('Stripe customer is deleted or unavailable');
      error.code = 'stripe_customer_unavailable';
      throw error;
    }
    const subscriptions = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 100,
      expand: ['data.latest_invoice'],
    });
    const products = new Map();
    const productIds = [...new Set((subscriptions.data || []).map(subscription => {
      const product = subscription.items?.data?.[0]?.price?.product;
      return typeof product === 'string' ? product : null;
    }).filter(Boolean))];
    if (stripe.products?.retrieve) {
      for (const productId of productIds) {
        try {
          const product = await stripe.products.retrieve(productId);
          if (product && !product.deleted) products.set(productId, product);
        } catch {
          // Product names are optional display metadata. A restricted key may
          // still synchronize the authoritative subscription and price state.
        }
      }
    }
    const snapshot = (subscriptions.data || []).map(subscription => normalizeSubscription(subscription, products));
    await db.replaceClientSubscriptions({
      clientAppId,
      stripeCustomerId,
      customerEmail: customer.email || null,
      customerName: customer.name || null,
      subscriptions: snapshot,
    });
    return { subscriptions: snapshot.length };
  } catch (error) {
    const code = /^[a-z0-9_.:-]{1,100}$/.test(String(error.code || '')) ? error.code : 'stripe_sync_failed';
    await db.failClientStripeSync(clientAppId, code);
    throw error;
  }
}

module.exports = { normalizeSubscription, syncClientSubscriptions, objectId };
