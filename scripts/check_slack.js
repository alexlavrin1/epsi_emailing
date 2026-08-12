require('../src/env');
const { WebClient } = require('@slack/web-api');
const config = require('../src/config');

async function main() {
  if (!config.slack.botToken) throw new Error('SLACK_BOT_TOKEN is not configured');
  const slack = new WebClient(config.slack.botToken);
  const identity = await slack.auth.test();
  console.log(JSON.stringify({
    authenticated: Boolean(identity.ok),
    teamId: identity.team_id || null,
    configuredTeamMatches:
      config.slack.teamId ? identity.team_id === config.slack.teamId : null,
    botUserId: identity.user_id || null,
    botName: identity.user || null,
  }, null, 2));
  if (config.slack.teamId && identity.team_id !== config.slack.teamId) process.exitCode = 1;
}

main().catch(error => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
