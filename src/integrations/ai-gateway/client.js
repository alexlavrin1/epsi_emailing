const config = require('../../config');

const AI_GATEWAY_RESPONSES_URL = 'https://ai-gateway.vercel.sh/v1/responses';

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
    source_message_ids: { type: 'array', items: { type: 'string' } },
    context_warnings: {
      type: 'array',
      items: { type: 'string', enum: ['no_email_history', 'slack_history_unavailable', 'billing_state_uncertain', 'relationship_note_missing'] },
    },
  },
  required: ['subject', 'body', 'source_message_ids', 'context_warnings'],
  additionalProperties: false,
};

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'refusal') throw Object.assign(new Error('The drafting request was refused'), { code: 'model_refusal' });
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw Object.assign(new Error('The model returned no structured draft'), { code: 'model_output_missing' });
}

async function createStructuredResponse({ system, user, schemaName, schema }, dependencies = {}) {
  const authToken = dependencies.apiKey || config.aiGateway.apiKey || dependencies.authToken || config.aiGateway.oidcToken || config.aiGateway.authToken;
  const model = dependencies.model || config.aiGateway.clientSuccessModel;
  const reasoningEffort = dependencies.reasoningEffort || config.aiGateway.reasoningEffort;
  const request = dependencies.fetch || fetch;
  if (!authToken) throw Object.assign(new Error('AI Gateway authentication is not configured'), { code: 'ai_gateway_not_configured' });
  const response = await request(AI_GATEWAY_RESPONSES_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { type: 'message', role: 'system', content: system },
        { type: 'message', role: 'user', content: user },
      ],
      reasoning: { effort: reasoningEffort },
      max_output_tokens: config.aiGateway.clientSuccessMaxOutputTokens,
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
    }),
    signal: AbortSignal.timeout(config.aiGateway.clientSuccessTimeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(payload?.error?.code || payload?.code || '').toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 60);
    throw Object.assign(new Error('AI Gateway draft request failed'), { code: `ai_gateway_http_${response.status}${detail ? `_${detail}` : ''}` });
  }
  if (payload.status === 'incomplete') throw Object.assign(new Error('AI Gateway draft response was incomplete'), { code: `model_incomplete_${payload.incomplete_details?.reason || 'unknown'}` });
  let parsed;
  try { parsed = JSON.parse(extractOutputText(payload)); } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error('AI Gateway structured output could not be parsed'), { code: 'model_output_invalid' });
  }
  return { output: parsed, model, responseId: String(payload.id || '').slice(0, 200) || null };
}

async function createStructuredClientDraft(prompts, dependencies = {}) {
  return createStructuredResponse({ ...prompts, schemaName: 'client_success_draft', schema: DRAFT_SCHEMA }, dependencies);
}

module.exports = { createStructuredResponse, createStructuredClientDraft, extractOutputText, DRAFT_SCHEMA, AI_GATEWAY_RESPONSES_URL };
