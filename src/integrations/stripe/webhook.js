const ALLOWED_EVENT_TYPES = new Set([
  'invoice.payment_action_required',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const MAX_WEBHOOK_BYTES = 1024 * 1024;

async function readRawBody(req, maxBytes = MAX_WEBHOOK_BYTES) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('Webhook payload exceeds the size limit');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function objectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function extractEventRecord(event) {
  const object = event.data?.object || {};
  return {
    id: event.id,
    event_type: event.type,
    stripe_object_id: objectId(object),
    stripe_customer_id: objectId(object.customer),
    livemode: Boolean(event.livemode),
    api_version: event.api_version || null,
    event_created_at: new Date(event.created * 1000).toISOString(),
    status: 'pending',
  };
}

async function ingestStripeWebhook({
  rawBody,
  signature,
  stripe,
  webhookSecret,
  eventIngestionEnabled,
  allowLiveEvents,
  enqueue,
}) {
  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  if (!ALLOWED_EVENT_TYPES.has(event.type)) {
    return { result: 'ignored', reason: 'event_type', event };
  }
  if (event.livemode && !allowLiveEvents) {
    return { result: 'ignored', reason: 'live_mode_disabled', event };
  }
  if (!eventIngestionEnabled) {
    return { result: 'ignored', reason: 'ingestion_disabled', event };
  }

  const queued = await enqueue(extractEventRecord(event));
  return {
    result: queued.duplicate ? 'duplicate' : 'queued',
    event,
  };
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  MAX_WEBHOOK_BYTES,
  readRawBody,
  extractEventRecord,
  ingestStripeWebhook,
};
