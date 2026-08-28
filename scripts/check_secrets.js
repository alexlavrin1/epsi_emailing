/**
 * Read-only secret/configuration audit. It never prints environment values,
 * contacts a provider, or modifies local/deployed configuration.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY', 'YANDEX_PASSWORD', 'CRON_SECRET',
  'INSTANTLY_API_KEY', 'INSTANTLY_WEBHOOK_SECRET',
  'STRIPE_RESTRICTED_KEY', 'STRIPE_WEBHOOK_SECRET',
  'SLACK_BOT_TOKEN', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'APOLLO_API_KEY', 'KVK_API_KEY',
];

const LIVE_SECRET_PATTERNS = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/g],
  ['service-role JWT', /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/g],
  ['Stripe live key', /(?:sk|rk)_live_[A-Za-z0-9]{16,}/g],
  ['Stripe webhook secret', /whsec_[A-Za-z0-9]{16,}/g],
  ['OpenAI API key', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

function isConfigured(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized)
    && !normalized.includes('replace_with')
    && !normalized.startsWith('your_')
    && !normalized.startsWith('<');
}

function validateEnvironment(env) {
  const findings = [];
  const required = ['SUPABASE_URL', 'YANDEX_EMAIL', 'YANDEX_PASSWORD', 'CRON_SECRET'];
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;

  for (const name of required) {
    if (!isConfigured(env[name])) findings.push({ level: 'error', name, message: 'missing' });
  }
  if (!isConfigured(serverKey)) findings.push({ level: 'error', name: 'SUPABASE_SERVICE_ROLE_KEY', message: 'missing' });
  if (isConfigured(serverKey) && !String(serverKey).startsWith('sb_secret_')) {
    try {
      const payload = JSON.parse(Buffer.from(String(serverKey).split('.')[1], 'base64url').toString());
      if (payload.role !== 'service_role') findings.push({ level: 'error', name: 'SUPABASE_SERVICE_ROLE_KEY', message: 'not a server key' });
    } catch {
      findings.push({ level: 'error', name: 'SUPABASE_SERVICE_ROLE_KEY', message: 'unrecognized server-key format' });
    }
  }
  if (isConfigured(env.CRON_SECRET) && String(env.CRON_SECRET).length < 32) {
    findings.push({ level: 'error', name: 'CRON_SECRET', message: 'must contain at least 32 characters' });
  }
  for (const name of SECRET_NAMES) {
    if (isConfigured(env[`NEXT_PUBLIC_${name}`])) findings.push({ level: 'error', name: `NEXT_PUBLIC_${name}`, message: 'secret is browser-exposed' });
  }

  const conditional = [
    ['STRIPE_EVENT_INGESTION_ENABLED', ['STRIPE_RESTRICTED_KEY', 'STRIPE_WEBHOOK_SECRET']],
    ['STRIPE_EVENT_PROCESSING_ENABLED', ['STRIPE_RESTRICTED_KEY']],
    ['STRIPE_PAYMENT_RECOVERY_ENABLED', ['STRIPE_RESTRICTED_KEY']],
    ['SLACK_DELIVERY_ENABLED', ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID']],
    ['SLACK_FAILURE_ALERTS_ENABLED', ['SLACK_BOT_TOKEN', 'SLACK_FAILURE_ALERT_CHANNEL_ID']],
    ['PAYMENT_RECOVERY_INTERNAL_ALERTS_ENABLED', ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID']],
  ];
  for (const [toggle, names] of conditional) {
    if (String(env[toggle]).toLowerCase() !== 'true') continue;
    for (const name of names) {
      if (!isConfigured(env[name])) findings.push({ level: 'error', name, message: `required while ${toggle}=true` });
    }
  }
  if (
    String(env.PAYMENT_RECOVERY_INTERNAL_ALERTS_ENABLED).toLowerCase() === 'true'
    && !isConfigured(env.PAYMENT_RECOVERY_INTERNAL_SLACK_CHANNEL_ID)
    && !isConfigured(env.SLACK_FAILURE_ALERT_CHANNEL_ID)
  ) {
    findings.push({
      level: 'error',
      name: 'PAYMENT_RECOVERY_INTERNAL_SLACK_CHANNEL_ID',
      message: 'PAYMENT_RECOVERY_INTERNAL_SLACK_CHANNEL_ID or SLACK_FAILURE_ALERT_CHANNEL_ID required while PAYMENT_RECOVERY_INTERNAL_ALERTS_ENABLED=true',
    });
  }
  if (
    String(env.CLIENT_SUCCESS_EMAIL_DELIVERY_ENABLED).toLowerCase() === 'true'
    && String(env.CLIENT_SUCCESS_EMAIL_DELIVERY_DRY_RUN).toLowerCase() === 'false'
    && !String(env.CLIENT_SUCCESS_EMAIL_DELIVERY_ALLOWLIST || '').split(',').some(value => isConfigured(value.trim()))
  ) {
    findings.push({
      level: 'error',
      name: 'CLIENT_SUCCESS_EMAIL_DELIVERY_ALLOWLIST',
      message: 'at least one recipient or * is required while client-success email delivery is active',
    });
  }
  if (String(env.CLIENT_SUCCESS_AGENT_ENABLED).toLowerCase() === 'true'
      && !isConfigured(env.AI_GATEWAY_API_KEY)
      && !isConfigured(env.VERCEL_OIDC_TOKEN)) {
    findings.push({ level: 'error', name: 'AI_GATEWAY_API_KEY', message: 'AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN required while CLIENT_SUCCESS_AGENT_ENABLED=true' });
  }
  return findings;
}

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
  return output.toString().split('\0').filter(Boolean);
}

function scanTrackedFiles(root) {
  const findings = [];
  for (const relative of trackedFiles(root)) {
    const absolute = path.join(root, relative);
    let source;
    try { source = fs.readFileSync(absolute, 'utf8'); }
    catch { continue; }
    if (source.includes('\0')) continue;
    for (const [name, pattern] of LIVE_SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) findings.push({ level: 'error', name: relative, message: `possible ${name}` });
    }
  }
  return findings;
}

function ignoredEnvironmentFiles(root) {
  return ['.env', '.env.local', 'dashboard/.env', 'dashboard/.env.local'].filter(relative => {
    try {
      execFileSync('git', ['check-ignore', '--quiet', '--no-index', relative], { cwd: root, stdio: 'ignore' });
      return false;
    } catch { return true; }
  }).map(name => ({ level: 'error', name, message: 'is not ignored by git' }));
}

function main() {
  const root = path.resolve(__dirname, '..');
  require('../src/env');
  const findings = [
    ...validateEnvironment(process.env),
    ...scanTrackedFiles(root),
    ...ignoredEnvironmentFiles(root),
  ];
  if (findings.length) {
    console.error('Secret audit failed:');
    for (const finding of findings) console.error(`- ${finding.name}: ${finding.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('Secret audit passed: server credentials are configured, private env files are ignored, and no recognizable live secrets are tracked.');
}

if (require.main === module) main();

module.exports = { isConfigured, validateEnvironment, scanTrackedFiles, ignoredEnvironmentFiles };
