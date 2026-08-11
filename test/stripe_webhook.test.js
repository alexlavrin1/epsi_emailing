const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const Stripe = require('stripe');

const {
  readRawBody,
  extractEventRecord,
  ingestStripeWebhook,
} = require('../src/integrations/stripe/webhook');

const stripe = new Stripe('sk_test_phase2_unit_test', { apiVersion: '2022-11-15' });
const webhookSecret = 'whsec_phase2_unit_test';

function buildEvent(overrides = {}) {
  return {
    id: 'evt_phase2_test',
    object: 'event',
    api_version: '2022-11-15',
    created: 1786442022,
    livemode: false,
    type: 'invoice.payment_action_required',
    data: {
      object: {
        id: 'in_phase2_test',
        object: 'invoice',
        customer: 'cus_phase2_test',
      },
    },
    ...overrides,
  };
}

function sign(payload) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
}

test('reads the exact webhook bytes from a request stream', async () => {
  const request = Readable.from([Buffer.from('{"hello":'), Buffer.from('"stripe"}')]);
  const body = await readRawBody(request);
  assert.equal(body.toString(), '{"hello":"stripe"}');
});

test('rejects webhook request bodies above the size limit', async () => {
  const request = Readable.from([Buffer.from('12345')]);
  await assert.rejects(
    () => readRawBody(request, 4),
    error => error.code === 'PAYLOAD_TOO_LARGE'
  );
});

test('extracts only minimal routing metadata from a Stripe event', () => {
  const record = extractEventRecord(buildEvent());
  assert.deepEqual(record, {
    id: 'evt_phase2_test',
    event_type: 'invoice.payment_action_required',
    stripe_object_id: 'in_phase2_test',
    stripe_customer_id: 'cus_phase2_test',
    livemode: false,
    api_version: '2022-11-15',
    event_created_at: new Date(1786442022 * 1000).toISOString(),
    status: 'pending',
  });
  assert.equal(Object.hasOwn(record, 'payload'), false);
});

test('verifies and queues an allowed sandbox Stripe event', async () => {
  const payload = JSON.stringify(buildEvent());
  let queuedRecord;
  const outcome = await ingestStripeWebhook({
    rawBody: Buffer.from(payload),
    signature: sign(payload),
    stripe,
    webhookSecret,
    eventIngestionEnabled: true,
    allowLiveEvents: false,
    enqueue: async record => {
      queuedRecord = record;
      return { duplicate: false, id: record.id };
    },
  });

  assert.equal(outcome.result, 'queued');
  assert.equal(queuedRecord.id, 'evt_phase2_test');
  assert.equal(queuedRecord.stripe_object_id, 'in_phase2_test');
});

test('reports a duplicate without queuing a second logical result', async () => {
  const payload = JSON.stringify(buildEvent());
  const outcome = await ingestStripeWebhook({
    rawBody: Buffer.from(payload),
    signature: sign(payload),
    stripe,
    webhookSecret,
    eventIngestionEnabled: true,
    allowLiveEvents: false,
    enqueue: async () => ({ duplicate: true }),
  });
  assert.equal(outcome.result, 'duplicate');
});

test('ignores unneeded, live, and disabled events after signature verification', async () => {
  const cases = [
    { event: buildEvent({ type: 'charge.succeeded' }), enabled: true, live: false, reason: 'event_type' },
    { event: buildEvent({ livemode: true }), enabled: true, live: false, reason: 'live_mode_disabled' },
    { event: buildEvent(), enabled: false, live: false, reason: 'ingestion_disabled' },
  ];

  for (const item of cases) {
    const payload = JSON.stringify(item.event);
    const outcome = await ingestStripeWebhook({
      rawBody: Buffer.from(payload),
      signature: sign(payload),
      stripe,
      webhookSecret,
      eventIngestionEnabled: item.enabled,
      allowLiveEvents: item.live,
      enqueue: async () => assert.fail('ignored events must not be queued'),
    });
    assert.equal(outcome.result, 'ignored');
    assert.equal(outcome.reason, item.reason);
  }
});

test('rejects an invalid Stripe signature before queueing', async () => {
  const payload = JSON.stringify(buildEvent());
  await assert.rejects(
    () => ingestStripeWebhook({
      rawBody: Buffer.from(payload),
      signature: 't=1,v1=invalid',
      stripe,
      webhookSecret,
      eventIngestionEnabled: true,
      allowLiveEvents: false,
      enqueue: async () => assert.fail('invalid events must not be queued'),
    }),
    error => error.type === 'StripeSignatureVerificationError'
  );
});

test('the Vercel handler preserves raw bodies and safely ignores events while disabled', async () => {
  process.env.STRIPE_RESTRICTED_KEY = 'rk_test_phase2_handler';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_EVENT_INGESTION_ENABLED = 'false';
  process.env.STRIPE_ALLOW_LIVE_EVENTS = 'false';

  const handler = require('../api/webhooks/stripe');
  const payload = JSON.stringify(buildEvent());
  const request = Readable.from([Buffer.from(payload)]);
  request.method = 'POST';
  request.headers = { 'stripe-signature': sign(payload) };

  const response = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await handler(request, response);
  assert.equal(handler.config.api.bodyParser, false);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { received: true, result: 'ignored' });
});
