import { createHmac, timingSafeEqual } from 'node:crypto';
import { githubCard } from '../src/card.js';
import { botUrlPattern, subscriptionRules } from '../src/config.js';

const reply = (status, message, headers) => Response.json({ message }, { status, headers });

export async function handle(request, env = process.env, send = fetch) {
  if (request.method !== 'POST') return reply(405, 'Use POST', { Allow: 'POST' });
  if (!env.GITHUB_WEBHOOK_SECRET) return reply(500, 'Missing GitHub secret');
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return reply(401, 'Invalid signature');
  const raw = Buffer.from(await request.arrayBuffer());
  const expected = createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
    return reply(401, 'Invalid signature');
  }
  const event = request.headers.get('x-github-event');
  if (!event) return reply(400, 'Missing GitHub event');
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return reply(400, 'Invalid JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400, 'Invalid payload');
  if (event === 'ping') return reply(200, 'pong');

  let rules;
  try {
    rules = subscriptionRules(env.GITHUB_EVENTS);
  } catch {
    return reply(500, 'Invalid GITHUB_EVENTS');
  }
  if (!rules.includes('*') && !rules.includes(event) && !rules.includes(`${event}.${payload.action}`)) {
    return reply(200, 'ignored');
  }

  if (event === 'workflow_run' && (payload.action !== 'completed' || payload.workflow_run?.conclusion !== 'failure')) {
    return reply(200, 'ignored');
  }

  const url = env.FEISHU_WEBHOOK_URL;
  if (!botUrlPattern.test(url ?? '')) {
    return reply(500, 'Invalid FEISHU_WEBHOOK_URL');
  }
  const card = githubCard(event, payload);
  if (env.FEISHU_SIGNING_SECRET) {
    card.timestamp = String(Math.floor(Date.now() / 1000));
    card.sign = createHmac('sha256', `${card.timestamp}\n${env.FEISHU_SIGNING_SECRET}`).digest('base64');
  }
  try {
    const response = await send(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card), signal: AbortSignal.timeout(6500), redirect: 'error'
    });
    if (!response.ok) return reply(502, `Feishu HTTP ${response.status}`);
    const result = await response.json();
    const code = result.code ?? result.StatusCode;
    if (code !== 0) return reply(502, `Feishu rejected card (code ${Number.isInteger(code) ? code : 'unknown'})`);
  } catch {
    return reply(502, 'Feishu request failed');
  }
  return reply(200, 'sent');
}

export default { fetch: request => handle(request) };
