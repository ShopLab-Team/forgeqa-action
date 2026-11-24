import assert from 'node:assert/strict';
import test from 'node:test';
import { execute, triggerUrl } from './index.mjs';
const trigger = 'https://qa.example.com/api/triggers/11111111-1111-4111-8111-111111111111/run';
const id = '22222222-2222-4222-8222-222222222222';
test('CI URL cannot smuggle credentials, a key in query, or an unrelated endpoint', () => {
  assert.equal(triggerUrl(trigger).hostname, 'qa.example.com');
  for (const bad of ['http://qa.example.com/api/triggers/x/run', trigger + '?key=unsafe',
    trigger.replace('https://', 'https://user:password@'), trigger.replace('/run', '/rotate')])
    assert.throws(() => triggerUrl(bad));
});
test('retry is idempotent, polling uses the scoped credential, and failures remain CI failures', async () => {
  const requests = [];
  const replies = [new Response('{}', { status: 503 }), Response.json({ id }),
    Response.json({ status: 'running' }), Response.json({ status: 'failed' })];
  const result = await execute({ url: trigger, key: 'synthetic-scoped-key', sleep: async () => {}, log: () => {},
    fetcher: async (url, options) => { requests.push({ url, ...options }); return replies.shift(); } });
  assert.deepEqual(result, { id, status: 'failed' });
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.equal(requests[2].headers['X-Webhook-Key'], 'synthetic-scoped-key');
  assert.ok(requests[2].url.endsWith(`/runs/${id}`));
  assert.equal(requests[0].redirect, 'error');
});
test('timeouts stop polling without falsely reporting a pass', async () => {
  let time = 0;
  await assert.rejects(execute({ url: trigger, key: 'synthetic-key', timeoutSeconds: 10,
    now: () => time, sleep: async () => { time += 5000; }, log: () => {},
    fetcher: async (_, options) => Response.json(options.method === 'POST' ? { id } : { status: 'queued' }),
  }), /Timed out/);
});
