const cron = require('node-cron');
const { runOutreachCycle } = require('./outreach/engine');
const logger = require('./utils/logger');

/**
 * Runs the outreach cycle every hour.
 * No warmup. No nightly prospect import. Just sends.
 */
function startScheduler() {
  logger.info('Initializing outreach scheduler...');

  cron.schedule('0 * * * *', async () => {
    logger.info('Cron triggered — running outreach cycle');
    try {
      await runOutreachCycle();
    } catch (error) {
      logger.error('Outreach cycle failed', error);
    }
  });

  logger.info('Scheduler started. Outreach runs at the top of every hour (Mon-Fri, 7am+ local time).');
}

module.exports = { startScheduler };
