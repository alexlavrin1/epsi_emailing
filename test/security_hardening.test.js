const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  isConfigured,
  validateEnvironment,
  scanTrackedFiles,
  ignoredEnvironmentFiles,
} = require('../scripts/check_secrets');

const root = path.resolve(__dirname, '..');

test('rejects missing, short, and browser-exposed server secrets without returning values', () => {
  const findings = validateEnvironment({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'not-a-server-key',
    YANDEX_EMAIL: 'operator@example.com',
    YANDEX_PASSWORD: 'configured',
    CRON_SECRET: 'short',
    NEXT_PUBLIC_YANDEX_PASSWORD: 'must-not-be-public',
  });
  assert.ok(findings.some(item => item.name === 'SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(findings.some(item => item.name === 'CRON_SECRET'));
  assert.ok(findings.some(item => item.name === 'NEXT_PUBLIC_YANDEX_PASSWORD'));
  assert.equal(JSON.stringify(findings).includes('must-not-be-public'), false);
});

test('requires provider credentials whenever delivery features are enabled', () => {
  const findings = validateEnvironment({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: ['sb', 'secret', 'configured_server_key_123456789'].join('_'),
    YANDEX_EMAIL: 'operator@example.com',
    YANDEX_PASSWORD: 'configured',
    CRON_SECRET: 'a'.repeat(32),
    STRIPE_EVENT_INGESTION_ENABLED: 'true',
    SLACK_DELIVERY_ENABLED: 'true',
  });
  assert.ok(findings.some(item => item.name === 'STRIPE_RESTRICTED_KEY'));
  assert.ok(findings.some(item => item.name === 'STRIPE_WEBHOOK_SECRET'));
  assert.ok(findings.some(item => item.name === 'SLACK_BOT_TOKEN'));
  assert.ok(findings.some(item => item.name === 'SLACK_TEAM_ID'));
});

test('keeps local env files ignored and recognizable live secrets out of tracked files', () => {
  assert.deepEqual(ignoredEnvironmentFiles(root), []);
  assert.deepEqual(scanTrackedFiles(root), []);
  assert.equal(isConfigured('replace_with_secret'), false);
  assert.equal(isConfigured('configured'), true);
});
