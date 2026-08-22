/**
 * Read-only validator for an EpsiFlow organization JSON export. It prints only
 * aggregate counts and a checksum; client names, emails, notes, and IDs never
 * appear in its output.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const legacyDatasets = ['prospects', 'customers', 'notes', 'tasks', 'recoveryCases', 'auditEvents'];
const expectedDatasets = [...legacyDatasets, 'clientApps', 'clientContacts', 'clientEmailMessages'];
const forbiddenKeys = /(?:password|secret|access_token|refresh_token|oauth_token|last_error|ip_address|request_id)/i;

function assert(condition, message) { if (!condition) throw new Error(message); }

function duplicateIds(rows) {
  const seen = new Set();
  return rows.some(row => typeof row?.id === 'string' && (seen.has(row.id) || !seen.add(row.id)));
}

function validateExport(payload) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'Export root must be an object.');
  assert([1, 2].includes(payload.schemaVersion), 'Unsupported export schema version.');
  assert(Number.isFinite(Date.parse(payload.generatedAt)), 'Export timestamp is invalid.');
  assert(Date.parse(payload.generatedAt) <= Date.now() + 300000, 'Export timestamp is in the future.');
  assert(payload.organization && typeof payload.organization.id === 'string' && typeof payload.organization.slug === 'string', 'Organization identity is missing.');
  assert(payload.limits?.rowsPerDataset === 5000, 'Unexpected dataset limit.');
  assert(payload.datasets && typeof payload.datasets === 'object', 'Datasets are missing.');

  const counts = {}; const truncated = {};
  const datasetsForVersion = payload.schemaVersion === 1 ? legacyDatasets : expectedDatasets;
  for (const name of datasetsForVersion) {
    const rows = payload.datasets[name];
    assert(Array.isArray(rows), `Dataset ${name} is missing.`);
    assert(rows.length <= 5000, `Dataset ${name} exceeds its declared limit.`);
    assert(!duplicateIds(rows), `Dataset ${name} contains duplicate IDs.`);
    counts[name] = rows.length;
    truncated[name] = payload.limits?.truncated?.[name] === true;
    for (const row of rows) {
      assert(row && typeof row === 'object' && !Array.isArray(row), `Dataset ${name} contains an invalid row.`);
      for (const key of Object.keys(row)) assert(!forbiddenKeys.test(key), `Dataset ${name} contains forbidden field ${key}.`);
    }
  }

  const prospectIds = new Set(payload.datasets.prospects.map(row => row.id));
  const customerIds = new Set(payload.datasets.customers.map(row => row.id));
  if (!truncated.prospects && !truncated.customers) {
    for (const row of [...payload.datasets.notes, ...payload.datasets.tasks]) {
      const valid = row.contact_kind === 'prospect' ? prospectIds.has(row.contact_id) : row.contact_kind === 'customer' && customerIds.has(row.contact_id);
      assert(valid, 'A note or task references a contact missing from the export.');
    }
    for (const row of payload.datasets.recoveryCases) assert(customerIds.has(row.crm_customer_id), 'A recovery case references a customer missing from the export.');
  }

  if (payload.schemaVersion === 2 && !truncated.clientApps && !truncated.clientContacts) {
    const appIds = new Set(payload.datasets.clientApps.map(row => row.id));
    const contactIds = new Set(payload.datasets.clientContacts.map(row => row.id));
    for (const row of payload.datasets.clientContacts) assert(appIds.has(row.client_app_id), 'A client contact references an app missing from the export.');
    for (const row of payload.datasets.clientEmailMessages) {
      assert(appIds.has(row.client_app_id), 'A client message references an app missing from the export.');
      assert(contactIds.has(row.client_contact_id), 'A client message references a contact missing from the export.');
    }
  }

  const safeAuditKeys = new Set(['previous_stage', 'new_stage', 'note_id', 'task_id', 'due_at', 'previous_status', 'new_status', 'contact_kind', 'contact_id', 'workflow_id', 'automation_run_id', 'version', 'status', 'failure_code', 'retry_count', 'previous_days', 'new_days', 'dataset', 'row_count', 'truncated', 'client_app_id', 'contact_count', 'slack_requested']);
  for (const event of payload.datasets.auditEvents) {
    assert(event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata), 'Audit metadata is invalid.');
    for (const [key, value] of Object.entries(event.metadata)) {
      assert(safeAuditKeys.has(key), `Audit export contains unapproved metadata key ${key}.`);
      assert(['string', 'number', 'boolean'].includes(typeof value), `Audit metadata ${key} has an unsafe value type.`);
    }
  }
  return { counts, truncated, generatedAt: payload.generatedAt, organizationSlug: payload.organization.slug };
}

function verifyFile(filename) {
  const absolute = path.resolve(filename);
  const stat = fs.statSync(absolute);
  assert(stat.isFile(), 'Export path must be a file.');
  assert(stat.size > 0 && stat.size <= 100 * 1024 * 1024, 'Export must be between 1 byte and 100 MB.');
  const source = fs.readFileSync(absolute);
  let payload;
  try { payload = JSON.parse(source.toString('utf8')); } catch { throw new Error('Export is not valid JSON.'); }
  const result = validateExport(payload);
  return { ...result, bytes: stat.size, sha256: crypto.createHash('sha256').update(source).digest('hex'), permissions: (stat.mode & 0o777).toString(8).padStart(3, '0') };
}

function main() {
  const filename = process.argv[2];
  if (!filename) { console.error('Usage: npm run export:verify -- /path/to/export.json'); process.exit(2); }
  try {
    const result = verifyFile(filename);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    if ((Number.parseInt(result.permissions, 8) & 0o077) !== 0) console.warn('Warning: this sensitive export is readable beyond its file owner. Restrict its file permissions or move it to encrypted storage.');
  } catch (error) { console.error(`Export verification failed: ${error.message}`); process.exit(1); }
}

if (require.main === module) main();
module.exports = { validateExport, verifyFile, expectedDatasets };
