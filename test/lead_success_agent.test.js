const test = require('node:test');
const assert = require('node:assert/strict');
const { generateLeadReplyDraft } = require('../src/lead-success/agent');

test('lead drafting passes the stored prompt and rejects invented source IDs', async () => {
  const context = { prospect: { id: 'prospect-1', company: 'Acme' }, messages: [{ id: 'reply-1', direction: 'inbound', body: 'What does EpsiFlow do?' }], inboundReplyIds: ['reply-1'], currentReplyId: 'reply-1' };
  let prompts;
  const result = await generateLeadReplyDraft({ body_template: 'Fallback', agent_prompt: 'Explain onboarding without inventing pricing.' }, context, { aiGateway: { createStructuredResponse: async value => { prompts=value; return { model:'test-model',responseId:'resp-1',output:{body:'EpsiFlow helps with the Shopify Ads payment setup. Would you like to review onboarding?',source_reply_ids:['reply-1'],context_warnings:['pricing_unconfirmed']}}; } } });
  assert.match(prompts.user, /Explain onboarding without inventing pricing/); assert.match(prompts.user, /What does EpsiFlow do/); assert.deepEqual(result.sourceReplyIds,['reply-1']); assert.match(result.contextSha256,/^[0-9a-f]{64}$/);
  await assert.rejects(() => generateLeadReplyDraft({ body_template:'Fallback',agent_prompt:'Use confirmed information and answer directly.' },context,{aiGateway:{createStructuredResponse:async()=>({model:'test',responseId:null,output:{body:'Body',source_reply_ids:['missing'],context_warnings:[]}})}}),/unavailable lead reply/);
});
