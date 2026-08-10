const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const config = require('../config');
const logger = require('../utils/logger');

function createTransporter() {
  return nodemailer.createTransport({
    host: config.yandex.smtpHost,
    port: 465,
    secure: true,
    auth: {
      user: config.yandex.email,
      pass: config.yandex.password,
    },
  });
}

function buildFrom(fromEmail, displayName) {
  return displayName ? { name: displayName, address: fromEmail } : fromEmail;
}

function buildHeaders(fromEmail) {
  const unsubscribeAddress = `mailto:${fromEmail}?subject=unsubscribe`;
  return {
    'List-Unsubscribe': `<${unsubscribeAddress}>`,
  };
}

async function composeRawMessage(mailOptions) {
  const message = new MailComposer({
    ...mailOptions,
    // Outreach messages never load attachments from local paths or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  }).compile();

  return {
    raw: await message.build(),
    messageId: message.messageId(),
    envelope: message.getEnvelope(),
  };
}

function findSentMailbox(mailboxes) {
  return mailboxes.find(mailbox => mailbox.specialUse === '\\Sent') ||
    mailboxes.find(mailbox => /(^|[/.])sent(?: items| mail)?$/i.test(mailbox.path));
}

/**
 * SMTP submission does not guarantee that Yandex stores a mailbox copy.
 * Append the exact submitted RFC822 message to Sent so operators can audit it.
 * This is deliberately best-effort: SMTP may already have accepted the message,
 * so an IMAP failure must not make the outreach engine retry the recipient.
 */
async function archiveSentMessage(raw, sentAt = new Date()) {
  const client = new ImapFlow({
    host: config.yandex.imapHost,
    port: 993,
    secure: true,
    auth: { user: config.yandex.email, pass: config.yandex.password },
    logger: false,
  });

  try {
    await client.connect();
    const mailboxes = await client.list();
    const sentMailbox = findSentMailbox(mailboxes);
    if (!sentMailbox) throw new Error('Yandex Sent mailbox was not found');
    const result = await client.append(sentMailbox.path, raw, ['\\Seen'], sentAt);
    if (!result) throw new Error('Yandex rejected the Sent mailbox append');
    return { archived: true, mailbox: sentMailbox.path, uid: result.uid || null };
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}

async function submitMessage(mailOptions) {
  const transporter = createTransporter();
  const compiled = await composeRawMessage(mailOptions);
  const info = await transporter.sendMail({
    envelope: compiled.envelope,
    raw: compiled.raw,
  });

  const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
  const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0;
  if (!accepted) {
    throw new Error(`SMTP did not accept a recipient (${info.response || 'no server response'})`);
  }

  let archive = { archived: false };
  try {
    archive = await archiveSentMessage(compiled.raw);
  } catch (error) {
    // Do not throw: SMTP has accepted the message, and throwing would allow a
    // later cycle to deliver a duplicate to the same prospect.
    logger.error(`SMTP accepted ${compiled.messageId}, but Sent archiving failed: ${error.message}`);
  }

  logger.info('SMTP submission accepted', {
    messageId: compiled.messageId,
    accepted,
    rejected,
    response: info.response || null,
    archived: archive.archived,
  });

  return {
    ...info,
    messageId: compiled.messageId,
    archive,
  };
}

async function sendEmail(_token, fromEmail, to, subject, body, options = {}) {
  const info = await submitMessage({
    from: buildFrom(fromEmail, options.displayName),
    replyTo: fromEmail,
    to,
    subject,
    text: body,
    headers: buildHeaders(fromEmail),
  });
  logger.info(`Email submitted to ${to}`, { messageId: info.messageId, archived: info.archive.archived });
  return {
    gmailId:      info.messageId,
    rfcMessageId: info.messageId,
    threadId:     info.messageId,
  };
}

async function sendReply(_token, fromEmail, toEmail, _threadId, inReplyToMsgId, originalSubject, body, options = {}) {
  const subject = `Re: ${originalSubject.replace(/^(Re:\s+)+/i, '')}`;

  const info = await submitMessage({
    from:    buildFrom(fromEmail, options.displayName),
    replyTo: fromEmail,
    to:      toEmail,
    subject,
    text:    body,
    headers: {
      ...buildHeaders(fromEmail),
      'In-Reply-To': inReplyToMsgId,
      'References':  inReplyToMsgId,
    },
  });

  logger.info(`Reply submitted to ${toEmail}`, { messageId: info.messageId, archived: info.archive.archived });
  return info;
}

function normalizeAddress(address) {
  return String(address || '').trim().toLowerCase();
}

function firstAddress(list) {
  return normalizeAddress(Array.isArray(list) ? list[0]?.address : null);
}

function isBounceSender(from, subject) {
  return /(?:mailer-daemon|postmaster)/i.test(from) ||
    /(?:undeliver|delivery[ -](?:status|failure)|mail delivery failed|returned mail|failure notice)/i.test(subject || '');
}

function isUnsubscribeReply(subject, text) {
  if (/\bunsubscribe\b/i.test(subject || '')) return true;
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('>'));
  return /^(?:please\s+)?unsubscribe(?:\s+me)?[.!]?$/i.test(firstLine || '');
}

/**
 * Read recent INBOX messages once per cycle and return only messages relevant
 * to prospects with active outreach. The mailbox is opened read-only and no
 * message flags are changed.
 */
async function findRecentInboundMessages(prospectEmails, since) {
  const targets = new Set(prospectEmails.map(normalizeAddress).filter(Boolean));
  if (!targets.size) return [];

  const client = new ImapFlow({
    host: config.yandex.imapHost,
    port: 993,
    secure: true,
    auth: { user: config.yandex.email, pass: config.yandex.password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = await client.search({ since }, { uid: true });
      if (!uids || !uids.length) return [];

      // Cap each cycle so a very large inbox cannot exhaust a serverless run.
      const recentUids = uids.slice(-500);
      const messages = await client.fetchAll(
        recentUids,
        { uid: true, envelope: true },
        { uid: true }
      );

      const results = [];
      for (const message of messages) {
        const from = firstAddress(message.envelope?.from);
        const subject = message.envelope?.subject || '';
        const directProspect = targets.has(from) ? from : null;
        const bounce = isBounceSender(from, subject);
        if (!directProspect && !bounce) continue;

        const sourceMessage = await client.fetchOne(
          String(message.uid),
          { source: true },
          { uid: true }
        );
        if (!sourceMessage?.source) continue;
        const parsed = await simpleParser(sourceMessage.source);
        const text = parsed.text || '';
        let bouncedProspect = null;
        if (bounce) {
          const haystack = `${text}\n${sourceMessage.source.toString('utf8')}`.toLowerCase();
          bouncedProspect = [...targets].find(email => haystack.includes(email)) || null;
        }

        if (!directProspect && !bouncedProspect) continue;
        results.push({
          messageId: message.envelope?.messageId || `imap-uid-${message.uid}`,
          from: directProspect || from,
          prospectEmail: directProspect || bouncedProspect,
          subject,
          text,
          receivedAt: message.envelope?.date || new Date(),
          type: bouncedProspect ? 'bounce' : (isUnsubscribeReply(subject, text) ? 'unsubscribe' : 'reply'),
        });
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout();
    else client.close();
  }
}

async function getUserEmail()      { return config.yandex.email; }

module.exports = {
  sendEmail,
  sendReply,
  findRecentInboundMessages,
  getUserEmail,
  // Exported for unit tests; not part of the sending interface.
  isBounceSender,
  isUnsubscribeReply,
  composeRawMessage,
  findSentMailbox,
};
