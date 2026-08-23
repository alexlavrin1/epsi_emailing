const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubscription, syncClientSubscriptions } = require('../src/integrations/stripe/client-subscriptions');
const { createClientStripeSyncHandler } = require('../api/client-stripe-sync');
const config = require('../src/config');
const { processStripeEventRow, reconcileClientSubscriptions } = require('../src/payment-recovery/engine');

function responseRecorder() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('normalizes a Stripe subscription without retaining the provider payload', () => {
  const snapshot = normalizeSubscription({
    id: 'sub_client_test', status: 'active', current_period_start: 1787000000,
    current_period_end: 1789678400, trial_end: null, cancel_at: null,
    cancel_at_period_end: false, canceled_at: null,
    latest_invoice: { id: 'in_client_test', status: 'paid' },
    items: { data: [{ quantity: 2, price: { nickname: 'Growth', unit_amount: 4900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, product: { id: 'prod_client_test', name: 'Ads management', deleted: false } } }] },
  });
  assert.equal(snapshot.stripe_subscription_id, 'sub_client_test');
  assert.equal(snapshot.product_name, 'Ads management');
  assert.equal(snapshot.unit_amount, 4900);
  assert.equal(snapshot.latest_invoice_status, 'paid');
  assert.equal(Object.hasOwn(snapshot, 'latest_invoice'), false);
});

test('retrieves canonical Stripe customer subscriptions and replaces one client snapshot', async () => {
  const writes = [];
  const stripe = {
    customers: { retrieve: async id => ({ id, email: 'owner@example.com', name: 'Example owner' }) },
    subscriptions: { list: async options => {
      assert.deepEqual(options, { customer: 'cus_client_test', status: 'all', limit: 100, expand: ['data.latest_invoice'] });
      return { data: [{ id: 'sub_client_test', status: 'trialing', items: { data: [{ quantity: 1, price: { product: 'prod_client_test', currency: 'usd' } }] } }] };
    } },
    products: { retrieve: async id => ({ id, name: 'Client success', deleted: false }) },
  };
  const db = { replaceClientSubscriptions: async value => writes.push(value), failClientStripeSync: async () => assert.fail('sync should not fail') };
  const result = await syncClientSubscriptions({ clientAppId: 'app-1', stripeCustomerId: 'cus_client_test', stripe, db });
  assert.deepEqual(result, { subscriptions: 1 });
  assert.equal(writes[0].customerEmail, 'owner@example.com');
  assert.equal(writes[0].subscriptions[0].status, 'trialing');
  assert.equal(writes[0].subscriptions[0].product_name, 'Client success');
});

test('keeps subscription sync usable when a restricted key cannot read products', async () => {
  const writes = [];
  const stripe = {
    customers: { retrieve: async id => ({ id }) },
    subscriptions: { list: async () => ({ data: [{ id: 'sub_restricted', status: 'active', items: { data: [{ quantity: 1, price: { product: 'prod_restricted', nickname: 'Standard', currency: 'usd' } }] } }] }) },
    products: { retrieve: async () => { const error = new Error('Forbidden'); error.code = 'permission_denied'; throw error; } },
  };
  const db = { replaceClientSubscriptions: async value => writes.push(value), failClientStripeSync: async () => assert.fail('optional product lookup must not fail sync') };
  await syncClientSubscriptions({ clientAppId: 'app-1', stripeCustomerId: 'cus_restricted', stripe, db });
  assert.equal(writes[0].subscriptions[0].product_name, null);
  assert.equal(writes[0].subscriptions[0].price_nickname, 'Standard');
});

test('client Stripe sync endpoint requires a user token and an authorized linked app', async () => {
  const appId = 'c8301c4c-6399-45a3-b577-95d14b32ba3a';
  const calls = [];
  const handler = createClientStripeSyncHandler({
    db: {
      authorizeClientSync: async (token, id) => token === 'valid-user-token' && id === appId ? { id } : null,
      getClientStripeLink: async () => ({ stripe_customer_id: 'cus_client_test' }),
    },
    stripe: () => ({ provider: 'stripe' }),
    sync: async options => { calls.push(options); return { subscriptions: 2 }; },
  });
  const unauthorized = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { client_app_id: appId } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const accepted = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-user-token' }, body: { client_app_id: appId } }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(calls[0].clientAppId, appId);
  assert.equal(calls[0].stripeCustomerId, 'cus_client_test');
  assert.deepEqual(accepted.body.result, { subscriptions: 2 });
});

test('a verified subscription event refreshes a linked client even without an invoice', async () => {
  const snapshots = [];
  const subscription = { id: 'sub_event', status: 'active', customer: 'cus_event', latest_invoice: null, items: { data: [] } };
  const stripe = {
    events: { retrieve: async () => ({ id: 'evt_event', type: 'customer.subscription.updated', livemode: false, data: { object: subscription } }) },
    customers: { retrieve: async () => ({ id: 'cus_event', email: 'client@example.com' }) },
    subscriptions: {
      retrieve: async () => subscription,
      list: async () => ({ data: [subscription] }),
    },
  };
  const db = {
    getClientStripeLinksByCustomerId: async id => { assert.equal(id, 'cus_event'); return [{ id: 'app-event' }]; },
    replaceClientSubscriptions: async value => snapshots.push(value),
    failClientStripeSync: async () => assert.fail('event refresh should succeed'),
  };
  const result = await processStripeEventRow({ id: 'evt_event', stripe_customer_id: 'cus_event' }, { stripe, db });
  assert.deepEqual(result, { outcome: 'client_subscriptions_refreshed', clientSubscriptionsRefreshed: 1 });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].subscriptions[0].status, 'active');
});

test('scheduled reconciliation claims a bounded stale-client batch and isolates failures', async () => {
  const original = { ...config.stripe };
  Object.assign(config.stripe, {
    clientSubscriptionReconciliationEnabled: true,
    clientSubscriptionReconciliationMinutes: 360,
    clientSubscriptionReconciliationLimit: 5,
  });
  const writes = []; const failures = [];
  const stripe = {
    customers: { retrieve: async id => id === 'cus_bad' ? Promise.reject(Object.assign(new Error('Unavailable'), { code: 'api_error' })) : ({ id }) },
    subscriptions: { list: async () => ({ data: [] }) },
  };
  const db = {
    claimDueClientStripeSyncs: async (minutes, limit) => { assert.deepEqual([minutes, limit], [360, 5]); return [
      { client_app_id: 'app-good', stripe_customer_id: 'cus_good' },
      { client_app_id: 'app-bad', stripe_customer_id: 'cus_bad' },
    ]; },
    replaceClientSubscriptions: async value => writes.push(value),
    failClientStripeSync: async (id, code) => failures.push({ id, code }),
  };
  try {
    const result = await reconcileClientSubscriptions({ stripe, db });
    assert.deepEqual(result, { enabled: true, claimed: 2, synced: 1, subscriptions: 0, failed: 1 });
    assert.equal(writes[0].clientAppId, 'app-good');
    assert.deepEqual(failures, [{ id: 'app-bad', code: 'api_error' }]);
  } finally { Object.assign(config.stripe, original); }
});
