const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const config = require('../config');
const currentLevel = levels[config.logLevel] ?? levels.info;

const logger = {
  debug: (msg, data) => currentLevel <= 0 && console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, data || ''),
  info:  (msg, data) => currentLevel <= 1 && console.log(`[INFO]  ${new Date().toISOString()} - ${msg}`, data || ''),
  warn:  (msg, data) => currentLevel <= 2 && console.warn(`[WARN]  ${new Date().toISOString()} - ${msg}`, data || ''),
  error: (msg, data) => currentLevel <= 3 && console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, data || ''),
};

module.exports = logger;
