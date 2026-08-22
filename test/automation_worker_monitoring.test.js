const test = require('node:test');
const assert = require('node:assert/strict');

const { runMonitoredOutreachCycle } = require('../src/outreach/engine');

test('records a successful outreach worker heartbeat', async () => {
  const calls = [];
  const result = await runMonitoredOutreachCycle({
    cycleKey: '11111111-1111-4111-8111-111111111111',
    db: {
      startAutomationWorkerCycle: async key => calls.push(['start', key]),
      finishAutomationWorkerCycle: async (key, status, code) => calls.push(['finish', key, status, code]),
    },
    runCycle: async () => ({ ok: true }),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ['start', '11111111-1111-4111-8111-111111111111'],
    ['finish', '11111111-1111-4111-8111-111111111111', 'succeeded', null],
  ]);
});

test('records a sanitized failure code and preserves the worker failure', async () => {
  const calls = [];
  const failure = Object.assign(new Error('provider included sensitive context'), { code: 'ETIMEDOUT' });
  await assert.rejects(() => runMonitoredOutreachCycle({
    cycleKey: '22222222-2222-4222-8222-222222222222',
    db: {
      startAutomationWorkerCycle: async () => 1,
      finishAutomationWorkerCycle: async (...args) => calls.push(args),
    },
    runCycle: async () => { throw failure; },
  }), failure);
  assert.deepEqual(calls, [['22222222-2222-4222-8222-222222222222', 'failed', 'ETIMEDOUT']]);
  assert.doesNotMatch(JSON.stringify(calls), /sensitive context/);
});

test('continues outreach when heartbeat storage is unavailable', async () => {
  const missing = Object.assign(new Error('start_automation_worker_cycle is not in the schema cache'), { code: 'PGRST202' });
  let ran = false;
  await runMonitoredOutreachCycle({
    db: { startAutomationWorkerCycle: async () => { throw missing; } },
    runCycle: async () => { ran = true; },
  });
  assert.equal(ran, true);
});
