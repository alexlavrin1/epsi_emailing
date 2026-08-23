require('../../src/env');
const config = require('../../src/config');
const db = require('../../src/db/supabase');
const logger = require('../../src/utils/logger');
const { getStripeClient } = require('../../src/integrations/stripe/client');
const { readRawBody, ingestStripeWebhook } = require('../../src/integrations/stripe/webhook');

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!config.stripe.webhookSecret || !config.stripe.restrictedKey) {
    logger.error('Stripe webhook is not configured');
    return res.status(503).json({ error: 'Stripe webhook is not configured' });
  }
  if (!config.supabase.isServerKey && config.stripe.eventIngestionEnabled) {
    logger.error('Stripe event ingestion requires SUPABASE_SERVICE_ROLE_KEY');
    return res.status(503).json({ error: 'Stripe event storage is not configured' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || Array.isArray(signature)) {
    return res.status(400).json({ error: 'Missing Stripe signature' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    logger.error(`Unable to read Stripe webhook body: ${error.message}`);
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const outcome = await ingestStripeWebhook({
      rawBody,
      signature,
      stripe: getStripeClient(),
      webhookSecret: config.stripe.webhookSecret,
      eventIngestionEnabled: config.stripe.eventIngestionEnabled,
      allowLiveEvents: config.stripe.allowLiveEvents || config.stripe.clientSubscriptionWebhookEnabled,
      enqueue: db.enqueueStripeWebhookEvent,
    });

    logger.info(`Stripe event ${outcome.result}`, {
      eventId: outcome.event.id,
      eventType: outcome.event.type,
      reason: outcome.reason || null,
    });
    return res.status(200).json({ received: true, result: outcome.result });
  } catch (error) {
    if (error.type === 'StripeSignatureVerificationError') {
      logger.warn('Stripe webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid Stripe signature' });
    }

    logger.error(`Stripe webhook ingestion failed: ${error.message}`);
    try { await db.recordApplicationError('stripe_webhook', 'stripe_webhook_ingestion_failed', 'stripe_webhook_ingestion_failed', 'critical'); } catch (monitoringError) { logger.warn(`Stripe error monitoring unavailable: ${monitoringError.message}`); }
    return res.status(500).json({ error: 'Stripe webhook ingestion failed' });
  }
}

module.exports = handler;

// Stripe signatures cover the exact request bytes. Vercel must not parse or
// re-serialize JSON before the official Stripe SDK verifies the signature.
module.exports.config = {
  api: { bodyParser: false },
};
