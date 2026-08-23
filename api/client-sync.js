require('../src/env');
const db = require('../src/db/supabase');
const { syncExistingClientWorkspace } = require('../src/outreach/engine');
const logger = require('../src/utils/logger');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bodyValue(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

function createClientSyncHandler(dependencies = {}) {
  const database = dependencies.db || db;
  const sync = dependencies.sync || syncExistingClientWorkspace;
  return async function handler(req, res) {
    if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const clientAppId = String(bodyValue(req).client_app_id || '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    if (!uuidPattern.test(clientAppId)) return res.status(400).json({ error: 'Invalid client app' });
    try {
      const scope = await database.authorizeClientSync(token, clientAppId);
      if (!scope) return res.status(403).json({ error: 'Forbidden' });
      const result = await sync({ clientAppIds: [clientAppId] });
      return res.status(200).json({ ok: true, result: { contacts: result.contacts, messages: result.messages, slackAssigned: result.slackAssigned, slackFailed: result.slackFailed } });
    } catch (error) {
      logger.error(`Immediate client sync failed: ${error.message}`);
      return res.status(500).json({ error: 'Client sync failed' });
    }
  };
}

module.exports = createClientSyncHandler();
module.exports.createClientSyncHandler = createClientSyncHandler;
