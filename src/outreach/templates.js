/**
 * Renders {{variable}} placeholders in email subject/body.
 *
 * Available: {{firstName}}, {{lastName}}, {{company}}, {{senderName}}, {{signature}}
 */
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function buildVars(prospect, mailbox) {
  return {
    firstName:  prospect.first_name || prospect.email.split('@')[0],
    lastName:   prospect.last_name  || '',
    company:    prospect.company    || '',
    senderName: (mailbox.display_name || '').split(' ')[0],
    signature:  mailbox.signature   || '',
  };
}

module.exports = { render, buildVars };
