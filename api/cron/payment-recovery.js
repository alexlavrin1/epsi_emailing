require('../../src/env');
const config = require('../../src/config');
const logger = require('../../src/utils/logger');
const { runPaymentRecoveryCycle } = require('../../src/payment-recovery/engine');

module.exports = async function handler(req, res) {
  const expected = config.cronSecret;
  if (!expected) {
    return res.status(503).json({ error: 'Payment recovery cron authentication is not configured' });
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!config.supabase.isServerKey) {
    return res.status(503).json({ error: 'Payment recovery requires server-side database access' });
  }

  try {
    const result = await runPaymentRecoveryCycle();
    return res.status(200).json({ ok: true, result, ts: new Date().toISOString() });
  } catch (error) {
    logger.error(`Payment recovery cron failed: ${error.message}`);
    try { await require('../../src/db/supabase').recordApplicationError('payment_recovery_cron', 'payment_recovery_cycle_failed', 'payment_recovery_cycle_failed', 'critical'); } catch (monitoringError) { logger.warn(`Payment recovery error monitoring unavailable: ${monitoringError.message}`); }
    return res.status(500).json({ error: 'Payment recovery cycle failed' });
  }
};
