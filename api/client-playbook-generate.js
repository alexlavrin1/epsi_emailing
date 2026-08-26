require('../src/env');
const db = require('../src/db/supabase');
const { generateClientSuccessAgentDrafts } = require('../src/client-success/agent');
const { getVercelOidcToken } = require('../src/integrations/ai-gateway/vercel-auth');
const logger = require('../src/utils/logger');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bodyValue(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(String(req.body || '{}')); } catch { return {}; } }

function createClientPlaybookGenerateHandler(dependencies = {}) {
  const database = dependencies.db || db;
  const generate = dependencies.generate || generateClientSuccessAgentDrafts;
  return async function handler(req, res) {
    if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const body = bodyValue(req);
    const draftId = String(body.draft_id || '').trim();
    const clientAppId = String(body.client_app_id || '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    if (!uuidPattern.test(draftId) || !uuidPattern.test(clientAppId)) return res.status(400).json({ error: 'Invalid draft request' });
    try {
      const app = await database.authorizeClientSync(token, clientAppId);
      if (!app) return res.status(403).json({ error: 'Forbidden' });
      const result = await generate({ authToken: getVercelOidcToken(req.headers), targetDraftId: draftId, targetClientAppId: clientAppId });
      if (result.completed !== 1) {
        const code = String(result.failureCodes?.[0] || result.unavailableCode || (result.claimed ? 'client_agent_generation_failed' : 'client_agent_draft_not_claimed')).slice(0, 100);
        return res.status(result.claimed ? 502 : 409).json({ error: 'Immediate AI generation did not complete', code });
      }
      return res.status(200).json({ ok: true, result: { completed: 1 } });
    } catch (error) {
      logger.error(`Immediate client draft generation failed [code=${String(error?.code || 'client_draft_generation_failed').slice(0,100)}]`);
      return res.status(500).json({ error: 'Immediate client draft generation failed' });
    }
  };
}

module.exports = createClientPlaybookGenerateHandler();
module.exports.createClientPlaybookGenerateHandler = createClientPlaybookGenerateHandler;
