require('../../src/env');
const { generateClientSuccessAgentDrafts } = require('../../src/client-success/agent');
const logger = require('../../src/utils/logger');

function createClientSuccessHandler(dependencies = {}) {
  const generate = dependencies.generate || generateClientSuccessAgentDrafts;
  return async function handler(req, res) {
    const expected = process.env.CRON_SECRET;
    if (expected && req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await generate();
      return res.status(200).json({ ok: true, result: { enabled: result.enabled, claimed: result.claimed, completed: result.completed, failed: result.failed }, ts: new Date().toISOString() });
    } catch (error) {
      logger.error(`Client-success cron failed [code=${String(error?.code || 'client_success_cycle_failed').slice(0, 100)}]`);
      return res.status(500).json({ error: 'Client-success drafting cycle failed' });
    }
  };
}

module.exports = createClientSuccessHandler();
module.exports.createClientSuccessHandler = createClientSuccessHandler;
