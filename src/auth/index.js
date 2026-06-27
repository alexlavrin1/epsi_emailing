const { startAuthServer } = require('./server');
const logger = require('../utils/logger');

logger.info('Starting OAuth auth server — EPSI Fund');
logger.info('This server is only for connecting mailboxes. Run "npm start" separately to begin sending.');

startAuthServer();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
