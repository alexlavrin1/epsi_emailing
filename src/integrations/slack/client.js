const { WebClient } = require('@slack/web-api');
const config = require('../../config');

let client;

function getSlackClient() {
  if (!config.slack.botToken) throw new Error('SLACK_BOT_TOKEN is not configured');
  if (!client) client = new WebClient(config.slack.botToken);
  return client;
}

async function validateWorkspace(slack = getSlackClient()) {
  if (!config.slack.teamId) throw new Error('SLACK_TEAM_ID is not configured');
  const identity = await slack.auth.test();
  if (identity.team_id !== config.slack.teamId) {
    throw new Error('Slack bot token belongs to a different workspace');
  }
  return identity;
}

async function lookupUserByEmail(email, slack = getSlackClient()) {
  await validateWorkspace(slack);
  const result = await slack.users.lookupByEmail({ email });
  if (!result.user?.id) throw new Error('Slack user lookup returned no user ID');
  if (result.user.deleted) throw new Error('Slack user is deactivated');
  return {
    teamId: result.user.team_id || config.slack.teamId,
    userId: result.user.id,
    displayName:
      result.user.profile?.display_name || result.user.profile?.real_name || null,
  };
}

async function sendDirectMessage(userId, text, slack = getSlackClient()) {
  await validateWorkspace(slack);
  const opened = await slack.conversations.open({ users: userId });
  const channelId = opened.channel?.id;
  if (!channelId) throw new Error('Slack did not return a DM channel');
  const result = await slack.chat.postMessage({
    channel: channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!result.ok || !result.ts) throw new Error('Slack did not confirm the message');
  return { channelId, ts: result.ts, messageId: `${channelId}:${result.ts}` };
}

module.exports = {
  getSlackClient,
  validateWorkspace,
  lookupUserByEmail,
  sendDirectMessage,
};
