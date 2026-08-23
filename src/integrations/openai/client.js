const config = require('../../config');

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
    for (const content of item?.content || []) {
      if (content?.type === 'refusal') throw Object.assign(new Error('The drafting request was refused'), { code: 'model_refusal' });
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw Object.assign(new Error('The model returned no structured draft'), { code: 'model_output_missing' });
}

async function createStructuredClientDraft({ system, user }, dependencies = {}) {
  const apiKey = dependencies.apiKey || config.openai.apiKey;
  const model = dependencies.model || config.openai.clientSuccessModel;
  const request = dependencies.fetch || fetch;
  if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY is not configured'), { code: 'openai_not_configured' });
  const response = await request('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_output_tokens: config.openai.clientSuccessMaxOutputTokens,
      text: { format: { type: 'json_schema', name: 'client_success_draft', strict: true, schema: DRAFT_SCHEMA } },
    }),
    signal: AbortSignal.timeout(config.openai.clientSuccessTimeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('OpenAI draft request failed'), { code: `openai_http_${response.status}` });
  if (payload.status === 'incomplete') throw Object.assign(new Error('OpenAI draft response was incomplete'), { code: `model_incomplete_${payload.incomplete_details?.reason || 'unknown'}` });
  let parsed;
  try { parsed = JSON.parse(extractOutputText(payload)); } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error('OpenAI structured output could not be parsed'), { code: 'model_output_invalid' });
  }
  return { output: parsed, model, responseId: String(payload.id || '').slice(0, 200) || null };
}

module.exports = { createStructuredClientDraft, extractOutputText, DRAFT_SCHEMA };
