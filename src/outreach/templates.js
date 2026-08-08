/**
 * Renders {{variable}} placeholders in email subject/body.
 *
 * Available: {{firstName}}, {{lastName}}, {{company}}, {{companyName}}, {{senderName}}, {{signature}}
 */
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function buildVars(prospect, mailbox) {
  const company = prospect.company || '';
  return {
    firstName:   prospect.first_name || prospect.email.split('@')[0],
    lastName:    prospect.last_name  || '',
    company,
    companyName: company, // alias — templates may use either name
    senderName:  (mailbox.display_name || '').split(' ')[0],
    signature:   mailbox.signature   || '',
  };
}

/**
 * A campaign_steps.subject_template may hold a single string or a JSON array
 * of strings (multiple subject lines to split-test). This resolves it to the
 * one variant to use, picked by a stable hash of `seed` (e.g. prospect id) —
 * the same prospect always lands on the same variant, so a follow-up reply
 * threads under the subject that was actually sent in step 1.
 */
function pickSubject(subjectTemplate, seed) {
  let variants;
  try {
    variants = JSON.parse(subjectTemplate);
  } catch {
    return subjectTemplate;
  }
  if (!Array.isArray(variants) || !variants.length) return subjectTemplate;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return variants[hash % variants.length];
}

module.exports = { render, buildVars, pickSubject };
