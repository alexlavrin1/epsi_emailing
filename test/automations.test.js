const test = require('node:test');
const assert = require('node:assert/strict');

const { processReplyAutomationRuns } = require('../src/outreach/engine');

function run(overrides = {}) {
  const calls = { completed: [], failed: [] };
  const db = {
    getDueReplyAutomationRuns: async () => [{
      id: 'run-1', workflow_id: 'workflow-1', workflow_version: 2,
      trigger_ref_id: 'reply-1', prospect_id: 'prospect-1',
    }],
    claimReplyAutomationRun: async item => ({ id: item }),
    getReplyAutomationVersion: async () => ({ body_template: 'Hi {{firstName}}, thanks for your reply about {{subject}}.' }),
    getReplyAutomationContext: async () => ({
      id: 'reply-1', subject: 'EPSI',
      prospect: { id: 'prospect-1', first_name: 'Alex', last_name: 'Doe', company: 'Acme', email: 'alex@example.com', status: 'active' },
    }),
    completeReplyAutomationRun: async (id, body) => { calls.completed.push({ id, body }); return 'draft-1'; },
    failReplyAutomationRun: async (id, message) => { calls.failed.push({ id, message }); },
    ...overrides,
  };
  return { db, calls };
}

test('prepares a versioned reply draft without sending externally', async () => {
  const { db, calls } = run();
  const result = await processReplyAutomationRuns({ db });
  assert.deepEqual(result, { enabled: true, due: 1, prepared: 1, stopped: 0, failed: 0 });
  assert.deepEqual(calls.completed, [{ id: 'run-1', body: 'Hi Alex, thanks for your reply about EPSI.' }]);
  assert.equal(calls.failed.length, 0);
});

test('fails closed when a reply stop condition is no longer satisfied', async () => {
  const { db, calls } = run({
    getReplyAutomationContext: async () => ({ id: 'reply-1', subject: 'EPSI', prospect: { status: 'unsubscribed' } }),
  });
  const result = await processReplyAutomationRuns({ db });
  assert.equal(result.failed, 1);
  assert.equal(result.prepared, 0);
  assert.match(calls.failed[0].message, /prospect is not active/i);
});

test('skips runs that cannot be atomically claimed', async () => {
  const { db, calls } = run({ claimReplyAutomationRun: async () => null });
  const result = await processReplyAutomationRuns({ db });
  assert.equal(result.prepared, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.completed.length, 0);
});

test('keeps outreach operational before the automation migration is installed', async () => {
  const { db } = run({
    getDueReplyAutomationRuns: async () => { const error = new Error('automation_runs is not in the schema cache'); error.code = 'PGRST205'; throw error; },
  });
  const result = await processReplyAutomationRuns({ db });
  assert.deepEqual(result, { enabled: false, due: 0, prepared: 0, stopped: 0, failed: 0 });
});
