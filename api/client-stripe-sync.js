require('../src/env');
const db = require('../src/db/supabase');
const logger = require('../src/utils/logger');
const { getStripeClient } = require('../src/integrations/stripe/client');
const { syncClientSubscriptions } = require('../src/integrations/stripe/client-subscriptions');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bodyValue(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { return {}; } }

function createClientStripeSyncHandler(dependencies = {}) {
  const database = dependencies.db || db;
  const stripe = dependencies.stripe || (() => getStripeClient());
  const sync = dependencies.sync || syncClientSubscriptions;
  return async function handler(req, res) {
    if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const clientAppId = String(bodyValue(req).client_app_id || '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    if (!uuidPattern.test(clientAppId)) return res.status(400).json({ error: 'Invalid client app' });
    try {
      const app = await database.authorizeClientSync(token, clientAppId);
      if (!app) return res.status(403).json({ error: 'Forbidden' });
      const link = await database.getClientStripeLink(clientAppId);
      if (!link?.stripe_customer_id) return res.status(409).json({ error: 'Stripe customer is not linked' });
      const result = await sync({ clientAppId, stripeCustomerId: link.stripe_customer_id, stripe: stripe(), db: database });
      return res.status(200).json({ ok: true, result });
    } catch (error) {
      logger.error(`Immediate client Stripe sync failed: ${error.message}`);
      return res.status(500).json({ error: 'Stripe subscription sync failed' });
    }
  };
}

module.exports = createClientStripeSyncHandler();
module.exports.createClientStripeSyncHandler = createClientStripeSyncHandler;
