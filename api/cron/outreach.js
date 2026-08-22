require('../../src/env');
const { runMonitoredOutreachCycle } = require('../../src/outreach/engine');
const logger = require('../../src/utils/logger');

module.exports = async function handler(req, res) {
  // Vercel automatically sends Authorization: Bearer <CRON_SECRET> for scheduled cron invocations.
  // External triggers (e.g. cron-job.org) must send the same header.
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await runMonitoredOutreachCycle();
    return res.status(200).json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    logger.error('Cron handler error', err);
    try { await require('../../src/db/supabase').recordApplicationError('outreach_cron', 'outreach_cycle_failed', 'outreach_cycle_failed', 'critical'); } catch (monitoringError) { logger.warn(`Outreach error monitoring unavailable: ${monitoringError.message}`); }
    return res.status(500).json({ error: 'Outreach cycle failed' });
  }
};
