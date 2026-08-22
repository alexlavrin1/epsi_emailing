const cron = require('node-cron');
const { runMonitoredOutreachCycle } = require('./outreach/engine');
const logger = require('./utils/logger');

/**
 * Runs the outreach cycle every 15 minutes. The engine sends at most one
 * message per cycle by default, producing a natural minimum gap without
 * keeping a serverless request open between messages.
 * No warmup. No nightly prospect import. Just sends.
 */
function startScheduler() {
  logger.info('Initializing outreach scheduler...');

  cron.schedule('*/15 * * * *', async () => {
    logger.info('Cron triggered — running outreach cycle');
    try {
      await runMonitoredOutreachCycle();
    } catch (error) {
      logger.error('Outreach cycle failed', error);
    }
  });

  logger.info('Scheduler started. Outreach checks run every 15 minutes; sending is gated by configured local business hours.');
}

module.exports = { startScheduler };
