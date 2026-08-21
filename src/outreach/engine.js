const db = require('../db/supabase');
const gmail = require('./gmail');
const { render, buildVars, pickSubject } = require('./templates');
const config = require('../config');
const logger = require('../utils/logger');

function isWeekend() {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: config.sendTimezone,
    weekday: 'short',
  }).format(new Date());
  return day === 'Sat' || day === 'Sun';
}

function getLocalHour() {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: config.sendTimezone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10
  );
}

function isBeforeBusinessHours() {
  return getLocalHour() < config.sendStartHour;
}

function isAfterBusinessHours() {
  return getLocalHour() >= config.sendEndHour;
}

/**
 * Main outreach cycle — normally runs every 15 minutes.
 *
 * 1. Check for replies so any prospect who responded gets their sequence stopped.
 * 2. Fetch all due sends.
 * 3. Per mailbox, enforce total, new-lead, and per-cycle caps.
 * 4. Step 1 → new email thread; step 2+ → threaded reply.
 * 5. After sending: mark sent, schedule the next step.
 */
async function runOutreachCycle() {
  logger.info('Starting outreach cycle...');

  if (!config.supabase.isServerKey) {
    if (config.outreachEnabled) {
      throw new Error('Sending requires SUPABASE_SERVICE_ROLE_KEY; refusing to use an anon/publishable key');
    }
    logger.warn('Outreach cycle skipped — SUPABASE_SERVICE_ROLE_KEY is not configured');
    return;
  }

  // Replies, unsubscribes, and bounces are processed even when sending is
  // disabled or outside business hours.
  await deliverOperatorEmailReplies();
  await checkForReplies();

  if (!config.outreachEnabled) {
    logger.info('Sending skipped — OUTREACH_ENABLED is not true');
    return;
  }

  if (isWeekend()) {
    logger.info('Outreach cycle skipped — weekend');
    return;
  }
  if (isBeforeBusinessHours()) {
    logger.info(`Outreach cycle skipped — before ${config.sendStartHour}:00 ${config.sendTimezone}`);
    return;
  }
  if (isAfterBusinessHours()) {
    logger.info(`Outreach cycle skipped — after ${config.sendEndHour}:00 ${config.sendTimezone}`);
    return;
  }

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
    const newLeadsToday = await db.getOutreachSendsCountToday(campaignIds, 1);
    const dailyLimit    = config.dailySendLimit;
    let sentThisCycle   = 0;
    let newLeadsThisCycle = 0;

    for (const send of sends) {
      if (sentThisCycle >= config.sendsPerCycle) {
        logger.info(`Per-cycle cap ${config.sendsPerCycle} reached; remaining sends stay queued`);
        break;
      }
      if (sentToday + sentThisCycle >= dailyLimit) {
        logger.warn(`Daily cap ${dailyLimit} reached for ${mailbox.email}, skipping remaining sends`);
        break;
      }
      if (
        send.step_number === 1 &&
        newLeadsToday + newLeadsThisCycle >= config.dailyNewLeadLimit
      ) {
        continue;
      }
      try {
        await processSend(send, mailbox);
        sentThisCycle++;
        if (send.step_number === 1) newLeadsThisCycle++;
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

  const subject = render(pickSubject(step.subject_template, prospect.id), vars);
  const body    = render(step.body_template, vars);

  let gmailThreadId, gmailMessageId;

  if (send.step_number === 1) {
    const result = await gmail.sendEmail(
      mailbox.oauth_token,
      mailbox.email,
      prospect.email,
      subject,
      body,
      { displayName: mailbox.display_name }
    );
    gmailThreadId  = result.threadId;
    gmailMessageId = result.rfcMessageId;
  } else {
    const step1     = await db.getStep1Send(send.campaign_id, send.prospect_id);
    const step1Def  = await db.getCampaignStep(send.campaign_id, 1);
    const step1Subj = render(pickSubject(step1Def.subject_template, prospect.id), vars);

    await gmail.sendReply(
      mailbox.oauth_token,
      mailbox.email,
      prospect.email,
      send.gmail_thread_id,
      step1.gmail_message_id,
      step1Subj,
      body,
      { displayName: mailbox.display_name }
    );
    gmailThreadId  = send.gmail_thread_id;
    gmailMessageId = null;
  }

  await db.markOutreachSent(send.id, gmailThreadId, gmailMessageId);
  logger.info(`Step ${send.step_number} sent for prospect ${prospect.id}`);

  const nextStep = await db.getNextCampaignStep(send.campaign_id, send.step_number);
  if (nextStep) {
    await db.scheduleNextStep(
      send.campaign_id,
      send.prospect_id,
      nextStep.step_number,
      nextStep.delay_days,
      gmailThreadId
    );
    logger.info(`Scheduled step ${nextStep.step_number} for prospect ${prospect.id} in ${nextStep.delay_days}d`);
  } else {
    logger.info(`Sequence complete for ${prospect.email}`);
  }
}

async function checkForReplies() {
  const sentSends = await db.getOutreachSendsForReplyCheck();
  if (!sentSends.length) return;

  const byMailbox = new Map();
  for (const send of sentSends) {
    const email = send.campaign?.mailbox?.email;
    if (!email) continue;
    if (!byMailbox.has(email)) byMailbox.set(email, []);
    byMailbox.get(email).push(send);
  }

  const since = new Date(Date.now() - config.replyLookbackDays * 24 * 60 * 60 * 1000);
  for (const [mailboxEmail, sends] of byMailbox) {
    try {
      const sendByProspect = new Map(
        sends.map(send => [send.prospect.email.toLowerCase(), send])
      );
      const messages = await gmail.findRecentInboundMessages([...sendByProspect.keys()], since);
      for (const message of messages) {
        const send = sendByProspect.get(message.prospectEmail);
        if (!send) continue;

        if (message.type === 'bounce') {
          logger.warn(`Bounce detected for prospect ${send.prospect_id}`);
          await db.updateProspectStatus(send.prospect_id, 'bounced');
          await db.stopAllProspectSequences(send.prospect_id);
          continue;
        }

        logger.info(`${message.type} detected for prospect ${send.prospect_id}; stopping sequence`);
        await db.markProspectCampaignReplied(send.campaign_id, send.prospect_id);
        await db.stopProspectSequence(send.campaign_id, send.prospect_id);
        if (message.type === 'unsubscribe') {
          await db.updateProspectStatus(send.prospect_id, 'unsubscribed');
          await db.stopAllProspectSequences(send.prospect_id);
        }
        await db.saveProspectReply({
          outreach_send_id: send.id,
          campaign_id: send.campaign_id,
          prospect_id: send.prospect_id,
          gmail_message_id: message.messageId,
          subject: message.subject,
          body: message.text,
          received_at: message.receivedAt,
        });
      }
    } catch (err) {
      logger.error(`Reply check failed for mailbox ${mailboxEmail}: ${err.message}`);
    }
  }
}

async function deliverOperatorEmailReplies(dependencies = {}) {
  const database = dependencies.db || db;
  const mailer = dependencies.mailer || gmail;
  const queued = await database.getQueuedOperatorEmailReplies(25);
  let sent = 0;
  let failed = 0;

  for (const queuedReply of queued) {
    const source = queuedReply.source_reply;
    const prospect = source?.prospect;
    const outreachSend = source?.outreach_send;
    const mailbox = outreachSend?.campaign?.mailbox;
    const claimed = await database.claimOperatorEmailReply(queuedReply.id);
    if (!claimed) continue;

    try {
      if (!source?.gmail_message_id || !prospect?.email || prospect.status !== 'active' || !mailbox?.email) {
        throw new Error('Reply context is incomplete or the prospect is not active');
      }
      const result = await mailer.sendReply(
        mailbox.oauth_token,
        mailbox.email,
        prospect.email,
        outreachSend.gmail_thread_id,
        source.gmail_message_id,
        source.subject || 'Your reply',
        queuedReply.body,
        { displayName: mailbox.display_name }
      );
      await database.markOperatorEmailReplySent(queuedReply.id, result.messageId || null);
      sent++;
    } catch (error) {
      failed++;
      await database.markOperatorEmailReplyFailed(queuedReply.id, error.message);
      logger.error(`Operator reply failed [id=${queuedReply.id}]: ${error.message}`);
    }
  }
  return { due: queued.length, sent, failed };
}

module.exports = { runOutreachCycle, deliverOperatorEmailReplies };
