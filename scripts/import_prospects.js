/**
 * Pull prospects from Apollo and save them to the database.
 * Run this ONCE before starting the outreach campaign.
 *
 * Usage:
 *   npm run import:prospects          ← live import
 *   npm run import:prospects:dry      ← preview only, no DB writes
 *
 * To change who gets imported (titles, locations, company sizes),
 * edit IMPORT_CONFIG in src/prospects/importer.js.
 *
 * After importing, enroll them:
 *   node scripts/enroll_prospects.js "EPSI Fund Outreach"
 */

require('dotenv').config();
const { runImportCycle } = require('../src/prospects/importer');

const dryRun = process.argv.includes('--dry-run');

runImportCycle({ dryRun }).then(({ stats }) => {
  console.log('\nImport summary:', stats);
  console.log('\nNext: node scripts/enroll_prospects.js "Your Campaign Name"');
}).catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
