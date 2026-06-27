const db = require('../db/supabase');
const gmail = require('./gmail');
const { render, buildVars } = require('./templates');
const config = require('../config');
const logger = require('../utils/logger');

function isWeekend() {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: config.sendTimezone,
    weekday: 'short',
  }).format(new Date());
  return day === 'Sat' || day === 'Sun';
}

function isBeforeBusinessHours() {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: config.sendTimezone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10
  );
  return hour < 7;
}

/**
 * Main outreach cycle — runs every hour.
 *
 * 1. Check for replies so any prospect who responded gets their sequence stopped.
 * 2. Fetch all due sends.
 * 3. Per mailbox, enforce the daily cap (DAILY_SEND_LIMIT env var, default 50).
 * 4. Step 1 → new Gmail thread; step 2+ → threaded reply.
 * 5. After sending: mark sent, schedule the next step.
 */
async function runOutreachCycle() {
  if (isWeekend()) {
    logger.info('Outreach cycle skipped — weekend');
    return;
  }
  if (isBeforeBusinessHours()) {
    logger.info('Outreach cycle skipped — before 7am');
    return;
  }

  logger.info('Starting outreach cycle...');

  await checkForReplies();

  const dueSends = await db.getDueOutreachSends();
  if (!dueSends.length) {
    logger.info('No outreach sends due.');
    return;
  }

  // Group by mailbox to apply the daily cap per sending account
  const byMailbox = {};
  for (const send of dueSends) {
    const mid = send.campaign.mailbox.id;
    if (!byMailbox[mid]) byMailbox[mid] = { mailbox: send.campaign.mailbox, sends: [] };
    byMailbox[mid].sends.push(send);
  }

  for (const { mailbox, sends } of Object.values(byMailbox)) {
    const campaignIds   = [...new Set(sends.map(s => s.campaign_id))];
    const sentToday     = await db.getOutreachSendsCountToday(campaignIds);
    const dailyLimit    = config.dailySendLimit;
    let sentThisCycle   = 0;

    for (const send of sends) {
      if (sentToday + sentThisCycle >= dailyLimit) {
        logger.warn(`Daily cap ${dailyLimit} reached for ${mailbox.email}, skipping remaining sends`);
        break;
      }
      try {
        await processSend(send, mailbox);
        sentThisCycle++;
      } catch (err) {
        logger.error(`Outreach send failed [id=${send.id}]: ${err.message}`);
      }
    }
  }

  logger.info('Outreach cycle completed.');
}

async function processSend(send, mailbox) {
  const { prospect } = send;
  const step = await db.getCampaignStep(send.campaign_id, send.step_number);
  const vars = buildVars(prospect, mailbox);

  const subject = render(step.subject_template, vars);
  const body    = render(step.body_template, vars);

  let gmailThreadId, gmailMessageId;

  if (send.step_number === 1) {
    const result = await gmail.sendEmail(
      mailbox.oauth_token,
      mailbox.email,
      prospect.email,
      subject,
      body
    );
    gmailThreadId  = result.threadId;
    gmailMessageId = result.rfcMessageId;
  } else {
    const step1     = await db.getStep1Send(send.campaign_id, send.prospect_id);
    const step1Def  = await db.getCampaignStep(send.campaign_id, 1);
    const step1Subj = render(step1Def.subject_template, vars);

    await gmail.sendReply(
      mailbox.oauth_token,
      mailbox.email,
      prospect.email,
      send.gmail_thread_id,
      step1.gmail_message_id,
      step1Subj,
      body
    );
    gmailThreadId  = send.gmail_thread_id;
    gmailMessageId = null;
  }

  await db.markOutreachSent(send.id, gmailThreadId, gmailMessageId);
  logger.info(`Step ${send.step_number} sent → ${prospect.email} (${prospect.company || ''})`);

  const nextStep = await db.getNextCampaignStep(send.campaign_id, send.step_number);
  if (nextStep) {
    await db.scheduleNextStep(
      send.campaign_id,
      send.prospect_id,
      nextStep.step_number,
      nextStep.delay_days,
      gmailThreadId
    );
    logger.info(`Scheduled step ${nextStep.step_number} for ${prospect.email} in ${nextStep.delay_days}d`);
  } else {
    logger.info(`Sequence complete for ${prospect.email}`);
  }
}

async function checkForReplies() {
  const sentSends = await db.getOutreachSendsForReplyCheck();
  if (!sentSends.length) return;

  logger.info(`Reply check: scanning ${sentSends.length} active thread(s)`);

  for (const send of sentSends) {
    if (!send.gmail_thread_id) continue;
    try {
      const mailbox  = send.campaign.mailbox;
      const hasReply = await threadHasProspectReply(
        mailbox.oauth_token,
        send.gmail_thread_id,
        send.prospect.email
      );

      if (hasReply) {
        logger.info(`Reply detected from ${send.prospect.email} — stopping sequence`);
        await db.markOutreachReplied(send.id);
        await db.stopProspectSequence(send.campaign_id, send.prospect_id);

        const allMessages = await gmail.getThreadMessages(mailbox.oauth_token, send.gmail_thread_id);
        const prospectLower = send.prospect.email.toLowerCase();
        const replyMessages = allMessages.filter(msg => {
          const from = msg.payload?.headers?.find(h => h.name === 'From')?.value || '';
          return from.toLowerCase().includes(prospectLower);
        });
        for (const msg of replyMessages) {
          const { subject, body, receivedAt } = await gmail.getMessageBody(mailbox.oauth_token, msg.id);
          await db.saveProspectReply({
            outreach_send_id: send.id,
            campaign_id:      send.campaign_id,
            prospect_id:      send.prospect_id,
            gmail_message_id: msg.id,
            subject,
            body,
            received_at:      receivedAt,
          });
        }
      }
    } catch (err) {
      logger.error(`Reply check failed for send ${send.id}: ${err.message}`);
    }
  }
}

async function threadHasProspectReply(refreshToken, threadId, prospectEmail) {
  const messages = await gmail.getThreadMessages(refreshToken, threadId);
  if (messages.length <= 1) return false;
  const prospectLower = prospectEmail.toLowerCase();
  return messages.some(msg => {
    const from = msg.payload?.headers?.find(h => h.name === 'From')?.value || '';
    return from.toLowerCase().includes(prospectLower);
  });
}

module.exports = { runOutreachCycle };
