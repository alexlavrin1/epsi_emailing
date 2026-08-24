const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { generateClientSuccessAgentDrafts, validateOutput } = require('../src/client-success/agent');
const { createStructuredClientDraft, AI_GATEWAY_RESPONSES_URL } = require('../src/integrations/ai-gateway/client');
const { createClientSuccessHandler } = require('../api/cron/client-success');

const messageId = 'da94562f-a209-421e-b482-d2631a89097a';
const context = {
  app: {
    id: 'app-1', organization_id: 'org-1', name: 'SidePanda', relationship_state: 'active', client_success_enabled: true,
    relationship_note: 'Keep the check-in practical.', contacts: [{ id: 'contact-1', name: 'Tarang Agarwal', email: 'tarang@sidepanda.com' }],
    subscriptions: [{ status: 'canceled', product_name: 'EpsiFlow Direct' }],
  },
  conversations: {
    email: [{ id: messageId, direction: 'inbound', subject: 'Next steps', body: 'How is the account balance?', occurred_at: '2025-10-14T11:41:00Z' }],
    slack: { available: false, reason: 'history_sync_not_installed', links: [] },
  },
  sourceMessageCount: 1,
};
const job = { id: 'draft-1', organization_id: 'org-1', client_app_id: 'app-1', client_contact_id: 'contact-1', channel: 'email', playbook_name: 'Direct renewal', playbook_description: 'Check the relationship and next payment.', trigger_type: 'scheduled_checkin', agent_prompt: 'Never infer payment status; ask one clear question.', subject_template: 'Checking in', body_template: 'Ask how things are going.' };

test('context-aware drafting is disabled by default', async () => {
  const original = config.aiGateway.clientSuccessAgentEnabled;
  try {
    config.aiGateway.clientSuccessAgentEnabled = false;
    const result = await generateClientSuccessAgentDrafts({ db: { claimClientPlaybookAgentDrafts: async () => { throw new Error('must not claim'); } } });
    assert.deepEqual(result, { enabled: false, claimed: 0, completed: 0, failed: 0 });
  } finally { config.aiGateway.clientSuccessAgentEnabled = original; }
});

test('generates an approval draft from complete context with validated citations', async () => {
  const original = config.aiGateway.clientSuccessAgentEnabled; const completed = [];
  try {
    config.aiGateway.clientSuccessAgentEnabled = true;
    const result = await generateClientSuccessAgentDrafts({
      db: { claimClientPlaybookAgentDrafts: async () => [job], completeClientPlaybookAgentDraft: async value => completed.push(value), failClientPlaybookAgentDraft: async () => assert.fail('must not fail') },
      getContext: async () => context,
      aiGateway: { createStructuredClientDraft: async prompts => {
        assert.match(prompts.system, /untrusted evidence/i); assert.match(prompts.system, /Use every supplied message/i); assert.match(prompts.system, /answer every one directly/i); assert.match(prompts.system, /EpsiFlow Direct monthly subscription/); assert.match(prompts.user, /How is the account balance/); assert.match(prompts.user, /Never infer payment status/);
        return { model: 'test-model', responseId: 'resp-safe', output: { subject: 'A quick check-in', body: 'Hi Tarang, how are things going?', source_message_ids: [messageId], context_warnings: [] } };
      } },
    });
    assert.deepEqual(result, { enabled: true, claimed: 1, completed: 1, failed: 0 });
    assert.equal(completed[0].draftId, 'draft-1'); assert.deepEqual(completed[0].sourceMessageIds, [messageId]); assert.match(completed[0].contextSha256, /^[0-9a-f]{64}$/);
    assert.equal(completed[0].contextMessageCount, 1); assert.equal(completed[0].contextLatestMessageAt, '2025-10-14T11:41:00Z');
    assert.deepEqual(completed[0].warnings, ['slack_history_unavailable']);
  } finally { config.aiGateway.clientSuccessAgentEnabled = original; }
});

test('fails closed when complete context exceeds the configured limit', async () => {
  const originalEnabled = config.aiGateway.clientSuccessAgentEnabled; const originalLimit = config.aiGateway.clientSuccessMaxContextChars; const failures = [];
  try {
    config.aiGateway.clientSuccessAgentEnabled = true; config.aiGateway.clientSuccessMaxContextChars = 20;
    const result = await generateClientSuccessAgentDrafts({ db: { claimClientPlaybookAgentDrafts: async () => [job], completeClientPlaybookAgentDraft: async () => assert.fail('must not complete'), failClientPlaybookAgentDraft: async (_id, code) => failures.push(code) }, getContext: async () => context, aiGateway: { createStructuredClientDraft: async () => assert.fail('must not call model') } });
    assert.equal(result.failed, 1); assert.deepEqual(failures, ['client_context_too_large']);
  } finally { config.aiGateway.clientSuccessAgentEnabled = originalEnabled; config.aiGateway.clientSuccessMaxContextChars = originalLimit; }
});

test('rejects hallucinated citations and Slack subjects', () => {
  assert.throws(() => validateOutput(job, context, { subject: 'Hello', body: 'Body', source_message_ids: ['6b4badc3-5e16-4a1a-ae4d-300160045780'], context_warnings: [] }), /unavailable source/);
  assert.throws(() => validateOutput({ ...job, channel: 'slack' }, context, { subject: 'Not allowed', body: 'Body', source_message_ids: [], context_warnings: [] }), /included a subject/);
});

test('uses Vercel AI Gateway with medium reasoning, strict output, and storage disabled', async () => {
  let request; let requestUrl;
  const result = await createStructuredClientDraft({ system: 'System', user: 'User' }, { authToken: 'test-token', model: 'openai/test-model', reasoningEffort: 'medium', fetch: async (url, options) => { requestUrl = url; request = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ id: 'resp-1', status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ subject: 'Subject', body: 'Body', source_message_ids: [], context_warnings: [] }) }] }] }) }; } });
  assert.equal(requestUrl, AI_GATEWAY_RESPONSES_URL); assert.equal(request.model, 'openai/test-model'); assert.equal(request.reasoning.effort, 'medium');
  assert.equal(request.store, false); assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true); assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(result.responseId, 'resp-1'); assert.equal(result.output.body, 'Body');
});

test('client-success Vercel cron requires the configured bearer secret', async () => {
  const original = process.env.CRON_SECRET; process.env.CRON_SECRET = 'configured-secret'; let calls = 0;
  const handler = createClientSuccessHandler({ generate: async () => { calls++; return { enabled: true, claimed: 1, completed: 1, failed: 0 }; } });
  const response = () => ({ statusCode: 0, body: null, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } });
  try {
    const denied=response(); await handler({ headers:{} },denied); assert.equal(denied.statusCode,401); assert.equal(calls,0);
    const accepted=response(); await handler({ headers:{authorization:'Bearer configured-secret'} },accepted); assert.equal(accepted.statusCode,200); assert.equal(accepted.body.result.completed,1); assert.equal(calls,1);
  } finally { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=original; }
});
