import { randomBytes, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { botUrlPattern, subscriptionRules } from '../src/config.js';

function run(program, args, { input, interactive = false } = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', input,
    stdio: interactive ? 'inherit' : ['pipe', 'pipe', input === undefined ? 'inherit' : 'pipe'],
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args[0]} 执行失败（${result.status}）`);
  return result.stdout?.trim() ?? '';
}

const vc = (args, options) => run('npx', ['--yes', 'vercel@65.11.0', ...args], options);

function secretPrompt(label) {
  if (!process.stdin.isTTY) throw new Error('请在终端运行，或通过环境变量提供飞书机器人配置');
  process.stderr.write(label);
  const result = spawnSync('bash', ['-c', 'IFS= read -rs value && printf %s "$value"'], {
    stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8'
  });
  process.stderr.write('\n');
  if (result.status !== 0) throw new Error('输入已取消');
  return result.stdout.trim();
}

async function deploy() {
  run('gh', ['--version']);
  try {
    run('gh', ['auth', 'status', '--hostname', 'github.com', '--active']);
  } catch {
    run('gh', ['auth', 'login', '--hostname', 'github.com', '--web'], { interactive: true });
  }
  const origin = run('git', ['remote', 'get-url', 'origin']);
  const repo = origin.match(/^(?:https:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?$/i)?.[1];
  if (!repo) throw new Error('origin 必须指向目标 GitHub 仓库');
  const hookPath = `repos/${repo}/hooks`;
  const ghApi = (args, options) => run('gh', ['api', '--hostname', 'github.com', ...args], options);
  const listHooks = () => JSON.parse(ghApi([hookPath, '--paginate', '--slurp'])).flat();
  listHooks(); // Verify repository access before provisioning Vercel.
  console.log(`部署目标：${repo}`);
  try {
    vc(['whoami']);
  } catch {
    vc(['login'], { interactive: true });
  }
  if (!existsSync('.vercel/project.json')) vc(['link', '--yes']);
  const { projectId, orgId } = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
  const api = (path) => JSON.parse(vc(['api', path + (path.includes('?') ? '&' : '?') + 'teamId=' + orgId]));
  const variables = api(`/v10/projects/${projectId}/env`).envs.filter(v => v.target?.includes('production'));
  const existing = key => variables.find(v => v.key === key);
  const readValue = variable => api(`/v1/projects/${projectId}/env/${variable.id}`).value;
  const writeValue = (key, value, sensitive = false) => {
    const args = ['env', 'add', key, 'production', '--yes'];
    if (existing(key)) args.push('--force');
    args.push('--type', sensitive ? 'secret' : 'config');
    vc(args, { input: value });
  };

  const previousRules = existing('GITHUB_EVENTS');
  const rules = subscriptionRules(process.env.GITHUB_EVENTS ?? (previousRules && readValue(previousRules)));
  const events = [...new Set(rules.map(rule => rule.split('.')[0]))];
  let bot = process.env.FEISHU_WEBHOOK_URL || undefined;
  let signing = process.env.FEISHU_SIGNING_SECRET;
  if (!bot && !existing('FEISHU_WEBHOOK_URL')) bot = secretPrompt('飞书群机器人 Webhook 地址：');
  if (bot !== undefined && !botUrlPattern.test(bot)) throw new Error('飞书机器人地址格式错误');
  if (bot && !existing('FEISHU_WEBHOOK_URL') && signing === undefined && process.stdin.isTTY) {
    signing = secretPrompt('飞书机器人签名密钥（未启用则回车）：');
  }

  const prior = existing('GITHUB_WEBHOOK_SECRET');
  const secret = prior ? readValue(prior) : randomBytes(32).toString('hex');
  if (!secret) throw new Error('Vercel 中现有的 GitHub 密钥无法读取，请检查项目权限及变量类型');
  if (!prior) writeValue('GITHUB_WEBHOOK_SECRET', secret);
  if (bot) writeValue('FEISHU_WEBHOOK_URL', bot, true);
  if (signing) writeValue('FEISHU_SIGNING_SECRET', signing, true);
  if (!previousRules || process.env.GITHUB_EVENTS !== undefined) writeValue('GITHUB_EVENTS', rules.join(','));

  console.log('正在部署到 Vercel Production…');
  vc(['deploy', '--prod', '--yes']);
  const { domains } = api(`/v9/projects/${projectId}/domains?production=true&limit=100`);
  const production = domains.filter(d => !d.redirect && !d.gitBranch && !d.customEnvironmentId && d.verified);
  const domain = production.find(d => d.name.endsWith('.vercel.app')) ?? production[0];
  if (!domain) throw new Error('未找到可用的 Vercel 生产域名');
  const url = `https://${domain.name}/api/github`;
  const signature = createHmac('sha256', secret).update('{}').digest('hex');
  let ready = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await fetch(url, {
        method: 'POST', redirect: 'error', body: '{}', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping', 'X-Hub-Signature-256': 'sha256=' + signature }
      });
      ready = result.ok && (await result.json()).message === 'pong';
    } catch { /* The production alias may still be propagating. */ }
    if (ready) break;
    await delay(1500);
  }
  if (!ready) throw new Error(`生产端点验签失败，请检查域名和 Deployment Protection 后重跑：${url}`);

  const hook = listHooks().find(h => h.config?.url === url);
  const body = {
    active: events.length > 0,
    events: events.includes('*') || !events.length ? ['*'] : events,
    config: { url, content_type: 'json', insecure_ssl: '0', secret }
  };
  if (!hook) body.name = 'web';
  ghApi([hook ? `${hookPath}/${hook.id}` : hookPath, '-X', hook ? 'PATCH' : 'POST', '--input', '-'],
    { input: JSON.stringify(body) });
  console.log(`部署完成：${repo} → ${url}\n订阅：${rules.join(', ') || '已暂停'}`);
}

deploy().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
