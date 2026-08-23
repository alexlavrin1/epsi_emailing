const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateExport, expectedDatasets } = require('../scripts/verify_data_export');

function validExport() {
  return { schemaVersion: 4, generatedAt: new Date().toISOString(), organization: { id: 'org-1', name: 'EpsiFlow', slug: 'epsiflow' }, limits: { rowsPerDataset: 5000, truncated: Object.fromEntries(expectedDatasets.map(name => [name, false])) }, datasets: {
    prospects: [{ id: 'prospect-1', email: 'person@example.com' }], customers: [{ id: 'customer-1', email: 'client@example.com' }],
    notes: [{ id: 'note-1', contact_kind: 'prospect', contact_id: 'prospect-1', body: 'Follow up' }], tasks: [{ id: 'task-1', contact_kind: 'customer', contact_id: 'customer-1', title: 'Review' }],
    recoveryCases: [{ id: 'case-1', crm_customer_id: 'customer-1' }], auditEvents: [{ id: 'event-1', metadata: { status: 'completed', row_count: 4 } }],
    clientApps: [{ id: 'app-1', name: 'Client app' }], clientContacts: [{ id: 'contact-1', client_app_id: 'app-1', email: 'owner@example.com' }],
    clientEmailMessages: [{ id: 'message-1', client_app_id: 'app-1', client_contact_id: 'contact-1', subject: 'Hello' }],
    clientSubscriptions: [{ id: 'subscription-1', client_app_id: 'app-1', status: 'active' }],
    clientPlaybooks: [{ id: 'playbook-1', name: 'Check in' }],
    clientPlaybookVersions: [{ id: 'playbook-version-1', playbook_id: 'playbook-1', version: 1 }],
    clientPlaybookDrafts: [{ id: 'playbook-draft-1', playbook_id: 'playbook-1', client_app_id: 'app-1', client_contact_id: 'contact-1', client_subscription_id: 'subscription-1' }],
    clientPlaybookAutomationRuns: [{ id: 'run-1', playbook_id: 'playbook-1', client_app_id: 'app-1', client_contact_id: 'contact-1', draft_id: 'playbook-draft-1' }],
  } };
}

test('validates a complete organization export using aggregate output only', () => {
  const result = validateExport(validExport());
  assert.deepEqual(result.counts, { prospects: 1, customers: 1, notes: 1, tasks: 1, recoveryCases: 1, auditEvents: 1, clientApps: 1, clientContacts: 1, clientEmailMessages: 1, clientSubscriptions: 1, clientPlaybooks: 1, clientPlaybookVersions: 1, clientPlaybookDrafts: 1, clientPlaybookAutomationRuns: 1 });
  assert.equal(JSON.stringify(result).includes('person@example.com'), false);
});

test('rejects broken references, duplicate IDs, and forbidden secret fields', () => {
  const orphan = validExport(); orphan.datasets.tasks[0].contact_id = 'missing';
  assert.throws(() => validateExport(orphan), /missing from the export/i);
  const duplicate = validExport(); duplicate.datasets.prospects.push({ ...duplicate.datasets.prospects[0] });
  assert.throws(() => validateExport(duplicate), /duplicate IDs/i);
  const secret = validExport(); secret.datasets.customers[0].access_token = 'do-not-return';
  assert.throws(() => validateExport(secret), /forbidden field/i);
});

test('rejects unrestricted audit metadata and oversized datasets', () => {
  const metadata = validExport(); metadata.datasets.auditEvents[0].metadata = { raw_message: 'unsafe' };
  assert.throws(() => validateExport(metadata), /unapproved metadata key/i);
  const limit = validExport(); limit.datasets.notes = Array.from({ length: 5001 }, (_, index) => ({ id: `n-${index}`, contact_kind: 'prospect', contact_id: 'prospect-1' }));
  assert.throws(() => validateExport(limit), /exceeds its declared limit/i);
});

test('keeps restored-project readiness checks rollback-only and security focused', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../database/tests/002_recovery_readiness.sql'), 'utf8');
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^ROLLBACK;/m);
  assert.doesNotMatch(sql, /^\s*(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/im);
  assert.match(sql, /relrowsecurity/i);
  assert.match(sql, /has_function_privilege\('service_role'/i);
  assert.match(sql, /orphan CRM task/i);
  assert.match(sql, /restored-project readiness checks passed/i);
});
