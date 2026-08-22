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

async function lookupUserByEmailOrName(email, slackName, slack = getSlackClient()) {
  try {
    return await lookupUserByEmail(email, slack);
  } catch (error) {
    if (!slackName) throw error;
  }

  await validateWorkspace(slack);
  const target = String(slackName).trim().replace(/^@/, '').toLowerCase();
  const matches = [];
  let cursor;
  do {
    const result = await slack.users.list({ limit: 200, cursor });
    for (const user of result.members || []) {
      if (!user.id || user.deleted || user.is_bot) continue;
      const candidates = [user.name, user.profile?.display_name, user.profile?.real_name]
        .map(value => String(value || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
      if (candidates.includes(target)) matches.push(user);
    }
    cursor = result.response_metadata?.next_cursor || null;
  } while (cursor && matches.length < 2);

  if (matches.length !== 1) {
    const error = new Error(matches.length ? 'Slack name is ambiguous' : 'Slack user was not found');
    error.code = matches.length ? 'slack_name_ambiguous' : 'slack_user_not_found';
    throw error;
  }
  const user = matches[0];
  return {
    teamId: user.team_id || config.slack.teamId,
    userId: user.id,
    displayName: user.profile?.display_name || user.profile?.real_name || user.name || null,
  };
}

async function openDirectConversation(userId, slack = getSlackClient()) {
  await validateWorkspace(slack);
  const opened = await slack.conversations.open({ users: userId });
  const channelId = opened.channel?.id;
  if (!channelId) throw new Error('Slack did not return a DM channel');
  return { channelId };
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

async function sendChannelMessage(channelId, text, slack = getSlackClient()) {
  await validateWorkspace(slack);
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
  lookupUserByEmailOrName,
  openDirectConversation,
  sendDirectMessage,
  sendChannelMessage,
};
