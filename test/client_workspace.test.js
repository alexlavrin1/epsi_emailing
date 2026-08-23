const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { syncExistingClientWorkspace } = require('../src/outreach/engine');
const { createClientSyncHandler } = require('../api/client-sync');

function responseRecorder() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('runs client mailbox matching every day while retaining the engine weekend send guard', () => {
  const deployment = require('../vercel.json');
  const outreachCron = deployment.crons.find(cron => cron.path === '/api/cron/outreach');
  const engine = readFileSync(require.resolve('../src/outreach/engine'), 'utf8');
  assert.equal(outreachCron?.schedule, '*/15 * * * *');
  assert.match(engine, /if \(isWeekend\(\)\)[\s\S]*Sending skipped|if \(isWeekend\(\)\)[\s\S]*Outreach cycle skipped/);
  assert.ok(engine.indexOf('syncExistingClientWorkspace()') < engine.indexOf('if (isWeekend())'));
});

test('matches existing-client email and assigns a Slack DM without posting', async () => {
  const saved = []; const completed = []; const synced = []; const scopes = [];
  const db = {
    getClientContactsForEmailSync: async (_limit, appIds) => { scopes.push(appIds); return [{ id: 'contact-1', organization_id: 'org-1', client_app_id: 'app-1', email: 'owner@example.com' }]; },
    upsertClientEmailMessage: async record => { saved.push(record); return { id: 'message-1' }; },
    markClientContactsEmailSynced: async ids => synced.push(...ids),
    getPendingClientSlackAssignments: async (_limit, appIds) => { scopes.push(appIds); return [{ id: 'contact-1', email: 'owner@example.com', slack_name: '@owner' }]; },
    completeClientSlackAssignment: async (id, assignment) => completed.push({ id, assignment }),
    failClientSlackAssignment: async () => { throw new Error('should not fail'); },
  };
  const mailer = { findRecentClientCorrespondence: async () => [{ messageId: '<mail-1>', threadKey: 'a'.repeat(64), contactEmail: 'owner@example.com', direction: 'inbound', mailboxEmail: 'hello@epsiflow.com', subject: 'Project update', text: 'All good', occurredAt: new Date('2026-08-22T08:00:00Z') }] };
  const slack = {
    lookupUserByEmailOrName: async () => ({ teamId: 'T_TEAM', userId: 'U_OWNER', displayName: 'Owner' }),
    openDirectConversation: async () => ({ channelId: 'D_OWNER' }),
  };
  const result = await syncExistingClientWorkspace({ db, mailer, slack, clientAppIds: ['app-1'] });
  assert.deepEqual(result, { enabled: true, contacts: 1, messages: 1, slackAssigned: 1, slackFailed: 0 });
  assert.equal(saved[0].client_app_id, 'app-1');
  assert.equal(saved[0].thread_key, 'a'.repeat(64));
  assert.equal(saved[0].counterparty_email, 'owner@example.com');
  assert.deepEqual(synced, ['contact-1']);
  assert.deepEqual(completed[0].assignment, { teamId: 'T_TEAM', userId: 'U_OWNER', displayName: 'Owner', channelId: 'D_OWNER' });
  assert.deepEqual(scopes, [['app-1'], ['app-1']]);
});

test('immediate client sync requires a valid user token and scopes work to an authorized app', async () => {
  const appId = 'c8301c4c-6399-45a3-b577-95d14b32ba3a';
  const syncOptions = [];
  const handler = createClientSyncHandler({
    db: { authorizeClientSync: async (token, target) => token === 'valid-user-token' && target === appId ? { id: appId, organization_id: 'org-1' } : null },
    sync: async options => { syncOptions.push(options); return { contacts: 1, messages: 3, slackAssigned: 1, slackFailed: 0 }; },
  });
  const unauthorized = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { client_app_id: appId } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const accepted = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-user-token' }, body: { client_app_id: appId, mode: 'historical' } }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(syncOptions, [{ clientAppIds: [appId], lookbackDays: 730 }]);
  assert.deepEqual(accepted.body.result, { contacts: 1, messages: 3, slackAssigned: 1, slackFailed: 0 });
});

test('fails Slack assignment with a sanitized code and keeps the client sync operational', async () => {
  const failures = [];
  const db = {
    getClientContactsForEmailSync: async () => [],
    getPendingClientSlackAssignments: async () => [{ id: 'contact-2', email: 'person@example.com', slack_name: 'Person' }],
    failClientSlackAssignment: async (id, code) => failures.push({ id, code }),
  };
  const slack = { lookupUserByEmailOrName: async () => { const error = new Error('private provider detail'); error.code = 'slack_user_not_found'; throw error; } };
  const result = await syncExistingClientWorkspace({ db, mailer: {}, slack });
  assert.equal(result.slackFailed, 1);
  assert.deepEqual(failures, [{ id: 'contact-2', code: 'slack_user_not_found' }]);
});

test('keeps the outreach engine compatible before migration 025 is installed', async () => {
  const error = Object.assign(new Error('client_contacts is not in the schema cache'), { code: 'PGRST205' });
  const result = await syncExistingClientWorkspace({ db: { getClientContactsForEmailSync: async () => { throw error; } } });
  assert.equal(result.enabled, false);
  assert.equal(result.contacts, 0);
});
