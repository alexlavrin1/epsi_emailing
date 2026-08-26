const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { generateClientSuccessAgentDrafts, validateOutput } = require('../src/client-success/agent');
const { createStructuredClientDraft, AI_GATEWAY_RESPONSES_URL } = require('../src/integrations/ai-gateway/client');
const { getVercelOidcToken } = require('../src/integrations/ai-gateway/vercel-auth');
const { createClientSuccessHandler } = require('../api/cron/client-success');
const { createClientPlaybookGenerateHandler } = require('../api/client-playbook-generate');

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
const job = { id: 'draft-1', organization_id: 'org-1', client_app_id: 'app-1', client_contact_id: 'contact-1', channel: 'email', playbook_name: 'Direct renewal', playbook_description: 'Check the relationship and next payment.', trigger_type: 'scheduled_checkin', agent_prompt: 'Never infer payment status; ask one clear question.', subject_template: 'Checking in', body_template: 'Ask how things are going.', regeneration_feedback: 'Answer the balance question first and keep the tone warm.' };

test('context-aware drafting is disabled by default', async () => {
  const original = config.aiGateway.clientSuccessAgentEnabled;
  try {
    config.aiGateway.clientSuccessAgentEnabled = false;
    const result = await generateClientSuccessAgentDrafts({ db: { claimClientPlaybookAgentDrafts: async () => { throw new Error('must not claim'); } } });
    assert.deepEqual(result, { enabled: false, claimed: 0, completed: 0, failed: 0, failureCodes: [], unavailableCode: 'client_agent_disabled' });
  } finally { config.aiGateway.clientSuccessAgentEnabled = original; }
});

test('generates an approval draft from complete context with validated citations', async () => {
  const original = config.aiGateway.clientSuccessAgentEnabled; const completed = [];
  try {
    config.aiGateway.clientSuccessAgentEnabled = true;
    const result = await generateClientSuccessAgentDrafts({
      db: { claimClientPlaybookAgentDrafts: async () => [job], completeClientPlaybookAgentDraft: async value => completed.push(value), failClientPlaybookAgentDraft: async () => assert.fail('must not fail') },
      getContext: async () => context,
      authToken: 'runtime-oidc-token',
      aiGateway: { createStructuredClientDraft: async (prompts, auth) => {
        assert.equal(auth.authToken, 'runtime-oidc-token');
        assert.match(prompts.system, /untrusted evidence/i); assert.match(prompts.system, /Use every supplied message/i); assert.match(prompts.system, /answer every one directly/i); assert.match(prompts.system, /trusted guidance from the EpsiFlow operator/i); assert.match(prompts.system, /cannot authorize invented facts or delivery/i); assert.match(prompts.system, /EpsiFlow Direct costs \$66 per month/); assert.match(prompts.system, /\$1,160 for \$1,000/); assert.match(prompts.system, /approximately \$91 per direct transfer/); assert.match(prompts.user, /How is the account balance/); assert.match(prompts.user, /Never infer payment status/); assert.match(prompts.user, /Answer the balance question first/);
        return { model: 'test-model', responseId: 'resp-safe', output: { subject: 'A quick check-in', body: 'Hi Tarang, how are things going?', source_message_ids: [messageId], context_warnings: [] } };
      } },
    });
    assert.deepEqual(result, { enabled: true, claimed: 1, completed: 1, failed: 0, failureCodes: [], unavailableCode: null });
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
  let request; let requestUrl; let authorization;
  const result = await createStructuredClientDraft({ system: 'System', user: 'User' }, { apiKey: 'configured-gateway-key', authToken: 'runtime-oidc-token', model: 'openai/test-model', reasoningEffort: 'medium', fetch: async (url, options) => { requestUrl = url; request = JSON.parse(options.body); authorization=options.headers.authorization; return { ok: true, status: 200, json: async () => ({ id: 'resp-1', status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ subject: 'Subject', body: 'Body', source_message_ids: [], context_warnings: [] }) }] }] }) }; } });
  assert.equal(requestUrl, AI_GATEWAY_RESPONSES_URL); assert.equal(request.model, 'openai/test-model'); assert.equal(request.reasoning.effort, 'medium');
  assert.equal(authorization, 'Bearer configured-gateway-key');
  assert.equal(request.store, false); assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true); assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(result.responseId, 'resp-1'); assert.equal(result.output.body, 'Body');
});

test('uses a sanitized Gateway error code without retaining provider details', async () => {
  await assert.rejects(() => createStructuredClientDraft({ system: 'System', user: 'User' }, { apiKey: 'configured-gateway-key', fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'insufficient_credits', message: 'private billing detail' } }) }) }), error => error.code === 'ai_gateway_http_403_insufficient_credits' && !error.message.includes('billing'));
});

test('immediately generates only the authenticated client draft requested', async () => {
  const draftId='da94562f-a209-421e-b482-d2631a89097a'; const appId='6b4badc3-5e16-4a1a-ae4d-300160045780'; let generation;
  const handler=createClientPlaybookGenerateHandler({ db:{ authorizeClientSync:async (token,id)=>token==='user-token'&&id===appId ? { id } : null }, generate:async dependencies=>{ generation=dependencies; return { enabled:true,claimed:1,completed:1,failed:0 }; } });
  const response=()=>({statusCode:0,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  const denied=response(); await handler({method:'POST',headers:{},body:{draft_id:draftId,client_app_id:appId}},denied); assert.equal(denied.statusCode,401);
  const accepted=response(); await handler({method:'POST',headers:{authorization:'Bearer user-token','x-vercel-oidc-token':'runtime-token'},body:{draft_id:draftId,client_app_id:appId}},accepted);
  assert.equal(accepted.statusCode,200); assert.equal(accepted.body.result.completed,1); assert.equal(generation.targetDraftId,draftId); assert.equal(generation.targetClientAppId,appId); assert.equal(generation.authToken,'runtime-token');

  const failedHandler=createClientPlaybookGenerateHandler({ db:{ authorizeClientSync:async ()=>({ id:appId }) }, generate:async ()=>({ enabled:true,claimed:1,completed:0,failed:1,failureCodes:['ai_gateway_http_403'],unavailableCode:null }) });
  const failed=response(); await failedHandler({method:'POST',headers:{authorization:'Bearer user-token'},body:{draft_id:draftId,client_app_id:appId}},failed);
  assert.equal(failed.statusCode,502); assert.equal(failed.body.code,'ai_gateway_http_403');
});

test('client-success Vercel cron requires the configured bearer secret', async () => {
  const original = process.env.CRON_SECRET; process.env.CRON_SECRET = 'configured-secret'; let calls = 0; let receivedToken;
  const handler = createClientSuccessHandler({ generate: async dependencies => { calls++; receivedToken=dependencies.authToken; return { enabled: true, claimed: 1, completed: 1, failed: 0 }; } });
  const response = () => ({ statusCode: 0, body: null, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } });
  try {
    const denied=response(); await handler({ headers:{} },denied); assert.equal(denied.statusCode,401); assert.equal(calls,0);
    const accepted=response(); await handler({ headers:{authorization:'Bearer configured-secret','x-vercel-oidc-token':'runtime-oidc-token'} },accepted); assert.equal(accepted.statusCode,200); assert.equal(accepted.body.result.completed,1); assert.equal(calls,1); assert.equal(receivedToken,'runtime-oidc-token');
  } finally { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=original; }
});

test('accepts only one bounded Vercel runtime OIDC header value', () => {
  assert.equal(getVercelOidcToken({ 'x-vercel-oidc-token': '  signed.token  ' }), 'signed.token');
  assert.equal(getVercelOidcToken({ 'x-vercel-oidc-token': ['one','two'] }), undefined);
  assert.equal(getVercelOidcToken({ 'x-vercel-oidc-token': 'x'.repeat(16385) }), undefined);
});
