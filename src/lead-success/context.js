const database = require('../db/supabase');
const { render, pickSubject } = require('../outreach/templates');

async function getLeadConversationContext(prospect, dependencies = {}) {
  const db = dependencies.db || database;
  const [replies, sends] = await Promise.all([
    db.getProspectConversationReplies(prospect.id),
    db.getProspectConversationSends(prospect.id),
  ]);
  const campaignIds = [...new Set(sends.map(send => send.campaign_id).filter(Boolean))];
  const steps = campaignIds.length ? await db.getCampaignConversationSteps(campaignIds) : [];
  const stepByCampaign = new Map(steps.map(step => [`${step.campaign_id}:${step.step_number}`, step]));
  const variables = {
    firstName: prospect.first_name || '', lastName: prospect.last_name || '',
    company: prospect.company || '', companyName: prospect.company || '',
    email: prospect.email || '', senderName: 'EpsiFlow', signature: '',
  };
  const outbound = sends.filter(send => send.sent_at).map(send => {
    const step = stepByCampaign.get(`${send.campaign_id}:${send.step_number}`);
    return {
      id: send.id, direction: 'outbound', occurred_at: send.sent_at,
      subject: step ? render(pickSubject(step.subject_template, prospect.id), variables) : '',
      body: step ? render(step.body_template, variables) : '',
    };
  });
  const inbound = replies.map(reply => ({
    id: reply.id, direction: 'inbound', occurred_at: reply.received_at || reply.created_at,
    subject: reply.subject || '', body: reply.body || '',
  }));
  return {
    prospect: { id: prospect.id, email: prospect.email, first_name: prospect.first_name, last_name: prospect.last_name, company: prospect.company },
    messages: [...outbound, ...inbound].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))),
    inboundReplyIds: inbound.map(message => message.id),
  };
}

module.exports = { getLeadConversationContext };
