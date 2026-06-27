const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const config = require('../config');
const db = require('../db/supabase');
const logger = require('../utils/logger');

const PORT = process.env.AUTH_PORT || 3001;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function getOAuthClient() {
  return new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    `http://localhost:${PORT}/auth/callback`
  );
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html><html><body style="font-family:monospace;padding:40px;max-width:700px">${html}</body></html>`);
}

async function handleStart(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const email = parsedUrl.query.email;

  if (!email) {
    sendHtml(res, 400, `
      <h2>Connect a Sending Mailbox — EPSI Fund</h2>
      <p>Provide the Gmail address you want to send outreach from:</p>
      <form action="/auth/start" method="get">
        <input name="email" type="email" placeholder="you@yourdomain.com" style="width:300px;padding:8px" required />
        <button type="submit" style="padding:8px 16px">Connect</button>
      </form>
    `);
    return;
  }

  const oauth2Client = getOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: Buffer.from(JSON.stringify({ email })).toString('base64'),
    login_hint: email,
  });

  logger.info(`Starting OAuth flow for ${email}`);
  res.writeHead(302, { Location: authUrl });
  res.end();
}

async function handleCallback(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const { code, state, error } = parsedUrl.query;

  if (error) {
    sendHtml(res, 400, `<h2>Authorization Failed</h2><p>Google returned: <strong>${error}</strong></p><p><a href="/auth/start">Try again</a></p>`);
    return;
  }

  if (!code || !state) {
    sendHtml(res, 400, `<h2>Missing code or state</h2>`);
    return;
  }

  let email;
  try {
    email = JSON.parse(Buffer.from(state, 'base64').toString()).email;
  } catch {
    sendHtml(res, 400, `<h2>Invalid state parameter</h2>`);
    return;
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      sendHtml(res, 400, `
        <h2>No Refresh Token</h2>
        <p>Google didn't return a refresh token. Revoke access at
        <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a>
        then <a href="/auth/start?email=${email}">try again</a>.</p>
      `);
      return;
    }

    oauth2Client.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2Api.userinfo.get();
    const displayName = profile.name || null;

    const existing = await db.getMailboxByEmail(email);
    if (existing) {
      await db.updateMailboxToken(existing.id, tokens.refresh_token, displayName);
      sendHtml(res, 200, `<h2>✓ Token Updated</h2><p><strong>${email}</strong> (${displayName}) — refresh token refreshed.</p><p><a href="/auth/start">Connect another mailbox</a></p>`);
    } else {
      await db.createMailbox(email, tokens.refresh_token, displayName);
      sendHtml(res, 200, `<h2>✓ Mailbox Connected</h2><p><strong>${email}</strong> (${displayName}) is ready to send outreach.</p><p><a href="/auth/start">Connect another mailbox</a></p>`);
    }
  } catch (err) {
    logger.error('OAuth callback error', err);
    sendHtml(res, 500, `<h2>Error</h2><p>${err.message}</p><p><a href="/auth/start">Try again</a></p>`);
  }
}

function startAuthServer() {
  const server = http.createServer(async (req, res) => {
    const pathname = url.parse(req.url).pathname;
    try {
      if (pathname === '/auth/start')    await handleStart(req, res);
      else if (pathname === '/auth/callback') await handleCallback(req, res);
      else sendHtml(res, 200, `<h2>EPSI Fund — Gmail OAuth Setup</h2><form action="/auth/start" method="get"><input name="email" type="email" placeholder="you@yourdomain.com" style="width:300px;padding:8px" required /><button type="submit" style="padding:8px 16px">Connect Gmail Account</button></form>`);
    } catch (err) {
      logger.error('Unhandled request error', err);
      res.writeHead(500);
      res.end('Internal server error');
    }
  });

  server.listen(PORT, () => {
    logger.info(`Auth server running at http://localhost:${PORT}`);
    logger.info(`Open http://localhost:${PORT} in your browser to connect your mailbox`);
  });

  return server;
}

module.exports = { startAuthServer };
