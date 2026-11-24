import { createHash, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function triggerUrl(value) {
  const url = new URL(value);
  const parts = url.pathname.split('/');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search ||
      parts.length !== 5 || parts[1] !== 'api' || parts[2] !== 'triggers' ||
      !uuid.test(parts[3]) || parts[4] !== 'run') throw new Error('Use the HTTPS scoped trigger URL from ForgeQA.');
  return url;
}

export async function execute({ url, key, timeoutSeconds = 1800, identity = randomUUID(),
  fetcher = fetch, sleep = pause, now = Date.now, log = console.log }) {
  const target = triggerUrl(url);
  if (!key || key.length > 1024 || !/^[\x21-\x7e]+$/.test(key)) throw new Error('Supply the webhook key through a GitHub Actions secret.');
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 7200) throw new Error('timeout-seconds must be an integer between 10 and 7200.');
  const idempotency = createHash('sha256').update(identity).digest('hex');
  const deadline = now() + timeoutSeconds * 1000;
  async function request(endpoint, method) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Timed out waiting for ForgeQA. The execution may still be running.');
      let response;
      try {
        response = await fetcher(endpoint, { method, redirect: 'error',
          signal: AbortSignal.timeout(Math.min(15000, remaining)),
          headers: { 'X-Webhook-Key': key, ...(method === 'POST' ? { 'Idempotency-Key': idempotency } : {}) } });
      } catch {
        if (attempt === 2) throw new Error('ForgeQA could not be reached. Check the service and trigger URL.');
        await sleep(1000 * (attempt + 1)); continue;
      }
      if ([429, 502, 503, 504].includes(response.status) && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      if (!response.ok) throw new Error(`ForgeQA rejected the request (HTTP ${response.status}). Check plan access and the scoped key.`);
      const contentLength = Number(response.headers?.get('content-length') || 0);
      if (contentLength > 1024 * 1024) throw new Error('ForgeQA response exceeded the expected size.');
      const body = await response.json();
      if (!body || typeof body !== 'object') throw new Error('ForgeQA returned an invalid response.');
      return body;
    }
  }
  const created = await request(target.href, 'POST');
  if (!uuid.test(created.id)) throw new Error('ForgeQA returned an invalid execution identifier.');
  const statusUrl = new URL(target.href);
  statusUrl.pathname = target.pathname.replace(/\/run$/, `/runs/${created.id}`);
  log(`ForgeQA execution ${created.id} started.`);
  while (now() < deadline) {
    const result = await request(statusUrl.href, 'GET');
    if (!['queued', 'running', 'passed', 'failed', 'canceled'].includes(result.status)) throw new Error('ForgeQA returned an invalid execution status.');
    if (['passed', 'failed', 'canceled'].includes(result.status)) {
      log(`ForgeQA execution ${created.id}: ${result.status}.`);
      return { id: created.id, status: result.status };
    }
    await sleep(5000);
  }
  throw new Error('Timed out waiting for ForgeQA. The execution may still be running.');
}

async function main() {
  const identity = [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT,
    process.env.GITHUB_JOB, process.env.GITHUB_ACTION].filter(Boolean).join(':') || randomUUID();
  const result = await execute({ url: process.env['INPUT_TRIGGER-URL'], key: process.env['INPUT_WEBHOOK-KEY'],
    timeoutSeconds: Number(process.env['INPUT_TIMEOUT-SECONDS'] || 1800), identity });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `execution-id=${result.id}\nstatus=${result.status}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### ForgeQA\n\nExecution: ${result.id}\n\nResult: **${result.status}**\n`);
  if (result.status !== 'passed') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('ForgeQA action failed. Check the trigger, scoped key, subscription, and execution history.');
  process.exitCode = 1;
});
