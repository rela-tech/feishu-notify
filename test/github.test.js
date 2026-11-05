import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { githubCard } from '../src/card.js';
import endpoint, { handle } from '../api/github.js';

const env = {
  GITHUB_WEBHOOK_SECRET: 'test-secret',
  FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
  FEISHU_SIGNING_SECRET: 'bot-secret',
  GITHUB_EVENTS: 'push, pull_request.opened'
};

function delivery(event, payload, signedBody) {
  const body = JSON.stringify(payload, null, 2);
  const digest = createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(signedBody ?? body).digest('hex');
  return new Request('http://localhost/api/github', {
    method: 'POST', body,
    headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' + digest }
  });
}

test('订阅的 PR 生成签名卡片，保留中文和详情链接', async () => {
  const url = 'https://github.com/example/repo/pull/1';
  let card;
  const result = await handle(delivery('pull_request', {
    action: 'opened', repository: { full_name: 'example/repo' },
    sender: { login: 'tester' },
    pull_request: { number: 1, title: '修复登录', body: '验证登录流程。', html_url: url }
  }), env, async (target, options) => {
    assert.equal(target, env.FEISHU_WEBHOOK_URL);
    card = JSON.parse(options.body);
    return Response.json({ code: 0 });
  });
  assert.equal(result.status, 200);
  assert.equal(card.msg_type, 'interactive');
  assert.equal(card.card.header.template, 'wathet');
  assert.equal(card.card.header.title.content, 'tester 在 repo 仓库提交了 PR #1');
  assert.equal(card.card.elements[0].text.content, '操作人：tester\n标题：修复登录\n正文：验证登录流程。');
  assert.equal(card.card.elements[1].actions[0].url, url);
  assert.equal(card.card.elements[1].actions[0].type, 'default');
  assert.equal(card.sign, createHmac('sha256', card.timestamp + '\n' + env.FEISHU_SIGNING_SECRET).digest('base64'));
});

test('未订阅、ping 和篡改请求均不发送', async () => {
  const unexpected = () => { throw Error('Unexpected send'); };
  for (const [req, status, message] of [
    [delivery('pull_request', { action: 'closed' }), 200, 'ignored'],
    [delivery('ping', {}), 200, 'pong'],
    [delivery('push', {}, '{ }'), 401, 'Invalid signature']
  ]) {
    const response = await handle(req, env, unexpected);
    assert.equal(response.status, status);
    assert.equal((await response.json()).message, message);
  }
});

test('push 和通配订阅仅转发 main 分支的推送', async () => {
  for (const subscription of ['push', '*']) {
    for (const [ref, expected] of [
      ['refs/heads/main', 'sent'],
      ['refs/heads/feature/main', 'ignored'],
      ['refs/tags/main', 'ignored'],
      [undefined, 'ignored']
    ]) {
      let sends = 0;
      const response = await handle(delivery('push', { ref }), { ...env, GITHUB_EVENTS: subscription }, async () => {
        sends++;
        return Response.json({ code: 0 });
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).message, expected);
      assert.equal(sends, expected === 'sent' ? 1 : 0);
    }
  }
});

test('跳过 PR 对话页普通评论，保留 Issue 评论和 PR 行内评论', async () => {
  for (const [event, payload, expected] of [
    ['issue_comment', { issue: { number: 1, pull_request: {} } }, 'ignored'],
    ['issue_comment', { issue: { number: 2 } }, 'sent'],
    ['pull_request_review_comment', { pull_request: { number: 1 } }, 'sent']
  ]) {
    let sends = 0;
    const response = await handle(delivery(event, { ...payload, action: 'created' }), { ...env, GITHUB_EVENTS: '*' }, async () => {
      sends++;
      return Response.json({ code: 0 });
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message, expected);
    assert.equal(sends, expected === 'sent' ? 1 : 0);
  }
});

test('通配订阅支持其他事件，机器人业务错误返回 502', async () => {
  const response = await handle(delivery('fork', {}), { ...env, GITHUB_EVENTS: '*' },
    async () => Response.json({ code: 19024 }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /19024/);
});

test('Vercel 函数入口只接受 POST', async () => {
  assert.equal((await endpoint.fetch(new Request('http://localhost/api/github'))).status, 405);
});

test('默认订阅提交评审，根据评审结果生成标题并链接到这次评审', async () => {
  const url = 'https://github.com/example/repo/pull/2#pullrequestreview-1';
  const defaults = { ...env };
  delete defaults.GITHUB_EVENTS;
  for (const [state, label, body, template] of [
    ['approved', '批准了', null, 'green'],
    ['changes_requested', '要求修改', '请补充错误处理', 'red'],
    ['commented', '评论了', '这段逻辑清晰', 'default']
  ]) {
    let card;
    const result = await handle(delivery('pull_request_review', {
      action: 'submitted', repository: { name: 'repo' }, sender: { login: 'tester' },
      pull_request: { number: 2, title: '登录' }, review: { state, body, html_url: url }
    }), defaults, async (_, options) => {
      card = JSON.parse(options.body).card;
      return Response.json({ code: 0 });
    });
    assert.equal(result.status, 200);
    assert.equal(card.header.template, template);
    assert.equal(card.header.title.content, `tester 在 repo 仓库${label} PR #2`);
    assert.equal(card.elements[0].text.content, '操作人：tester\n标题：登录' + (body ? '\n评审意见：' + body : ''));
    assert.equal(card.elements[1].actions[0].url, url);
  }
});

test('CI 失败通知暂停，已有订阅和通配订阅均跳过', async () => {
  const payload = { action: 'completed', workflow_run: { conclusion: 'failure' } };
  for (const subscription of ['workflow_run.completed', '*']) {
    const send = () => { throw Error('Unexpected send'); };
    const response = await handle(delivery('workflow_run', payload), { ...env, GITHUB_EVENTS: subscription }, send);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message, 'ignored');
  }
});

test('卡片颜色区分强提醒、成功与普通动态', () => {
  for (const [event, payload, expected] of [
    ['push', { ref: 'refs/heads/main' }, 'default'],
    ['issue_comment', { action: 'created' }, 'default'],
    ['fork', {}, 'default'],
    ['issues', { action: 'opened' }, 'wathet'],
    ['release', { action: 'published' }, 'wathet'],
    ['pull_request', { action: 'review_requested' }, 'wathet'],
    ['pull_request', { action: 'ready_for_review' }, 'wathet'],
    ['pull_request', { action: 'closed', pull_request: { merged: true } }, 'green'],
    ['pull_request', { action: 'closed', pull_request: { merged: false } }, 'default'],
    ['issues', { action: 'closed', issue: { state_reason: 'completed' } }, 'green'],
    ['issues', { action: 'closed', issue: { state_reason: 'not_planned' } }, 'default']
  ]) {
    assert.equal(githubCard(event, payload).card.header.template, expected, event);
  }
});

test('通知标题说明操作人、仓库和具体动作', () => {
  const base = { sender: { login: 'alice' }, repository: { name: 'demo' } };
  for (const [event, payload, title] of [
    ['push', { ref: 'refs/heads/main' }, '推送了代码到 main 分支'],
    ['push', { ref: 'refs/heads/main', deleted: true }, '删除了 main 分支'],
    ['issues', { action: 'opened', issue: { number: 4 } }, '提交了 Issue #4'],
    ['issues', { action: 'reopened', number: 4 }, '重新打开了 Issue #4'],
    ['pull_request', { action: 'closed', number: 3 }, '关闭了 PR #3'],
    ['pull_request', { action: 'closed', pull_request: { number: 3, merged: true } }, '合并了 PR #3'],
    ['pull_request', { action: 'review_requested', number: 3 }, '请求评审 PR #3'],
    ['pull_request', { action: 'ready_for_review', number: 3 }, '将 PR #3 标记为可评审'],
    ['issue_comment', { action: 'created', issue: { number: 4 } }, '对 Issue #4 发表了评论'],
    ['pull_request_review_comment', { action: 'created', number: 3 }, '对 PR #3 发表了行内评论'],
    ['release', { action: 'published', release: { tag_name: 'v1.2' } }, '发布了版本 v1.2'],
    ['fork', {}, '触发了 fork 事件']
  ]) {
    assert.equal(githubCard(event, { ...base, ...payload }).card.header.title.content,
      'alice 在 demo 仓库' + title);
  }
  assert.equal(githubCard('issues', { action: 'opened' }).card.header.title.content, '提交了 Issue');
});

test('推送卡片按顺序列出每次提交的短 SHA 和首行，保留比较链接', () => {
  const commits = [
    { id: '123456789', author: { username: 'alice', name: 'Alice Li' }, message: '修复登录\n\n详细说明' },
    { id: 'abcdef012', author: { name: '小林' }, message: '更新测试' }
  ];
  const compare = 'https://github.com/example/repo/compare/base...head';
  const { elements } = githubCard('push', { commits, head_commit: commits[1], compare }).card;
  assert.equal(elements[0].text.content, '本次推送共 2 个提交：\n• [alice] 1234567 修复登录\n• [小林] abcdef0 更新测试');
  assert.equal(elements[1].actions[0].url, compare);
  assert.equal(githubCard('push', { head_commit: commits[0] }).card.elements[0].text.content,
    '本次推送共 1 个提交：\n• [alice] 1234567 修复登录');
  assert.deepEqual(githubCard('push', { commits: [], head_commit: commits[0] }).card.elements, []);
});

test('大型推送列出前 50 条并标明剩余数量', () => {
  const commits = Array.from({ length: 52 }, (_, i) => ({ message: '提交 ' + i }));
  const body = githubCard('push', { commits }).card.elements[0].text.content;
  assert.match(body, /^本次推送共 52 个提交：/);
  assert.match(body, /• 提交 49\n另有 2 个提交，可在 GitHub 查看。$/);
});
