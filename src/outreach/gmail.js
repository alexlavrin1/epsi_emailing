const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');

function getGmailClient(refreshToken) {
  const client = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

function encodeMessage(lines) {
  return Buffer.from(lines.join('\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function sendEmail(refreshToken, fromEmail, to, subject, body) {
  const gmail = getGmailClient(refreshToken);

  const raw = encodeMessage([
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    body,
  ]);

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  const sent = await gmail.users.messages.get({
    userId: 'me',
    id: response.data.id,
    format: 'metadata',
    metadataHeaders: ['Message-ID'],
  });

  const rfcMessageId = sent.data.payload.headers
    .find(h => h.name.toLowerCase() === 'message-id')?.value || null;

  logger.info(`Email sent to ${to}`, { gmailId: response.data.id, rfcMessageId });
  return { gmailId: response.data.id, rfcMessageId, threadId: response.data.threadId };
}

async function sendReply(refreshToken, fromEmail, toEmail, threadId, inReplyToMsgId, originalSubject, body) {
  const gmail = getGmailClient(refreshToken);
  const subject = `Re: ${originalSubject.replace(/^(Re:\s+)+/i, '')}`;

  const raw = encodeMessage([
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${inReplyToMsgId}`,
    `References: ${inReplyToMsgId}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    body,
  ]);

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId },
  });

  logger.info(`Reply sent in thread ${threadId}`, { gmailId: response.data.id });
  return response.data;
}

async function getThreadMessages(refreshToken, threadId) {
  try {
    const gmailClient = getGmailClient(refreshToken);
    const response = await gmailClient.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
      metadataHeaders: ['From'],
    });
    return response.data.messages || [];
  } catch (error) {
    logger.error(`Error fetching thread ${threadId}`, error.message);
    return [];
  }
}

async function getMessageBody(refreshToken, messageId) {
  try {
    const gmail = getGmailClient(refreshToken);
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const payload = msg.data.payload;
    const headers = payload.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const date    = headers.find(h => h.name === 'Date')?.value || null;

    let body = '';
    if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
      const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    }

    return { subject, body, receivedAt: date ? new Date(date) : new Date() };
  } catch (error) {
    logger.error(`Error fetching message body for ${messageId}`, error.message);
    return { subject: '', body: '', receivedAt: new Date() };
  }
}

async function getUserEmail(refreshToken) {
  const gmail = getGmailClient(refreshToken);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress;
}

module.exports = { sendEmail, sendReply, getThreadMessages, getMessageBody, getUserEmail };
