import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
  assert.equal(card.card.header.title.content, 'repo · 新建 PR #1');
  assert.equal(card.card.elements[0].text.content, '操作人：tester\n标题：修复登录\n正文：验证登录流程。');
  assert.equal(card.card.elements[1].actions[0].url, url);
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
  for (const [state, label, body] of [
    ['approved', '批准', null],
    ['changes_requested', '要求修改', '请补充错误处理'],
    ['commented', '评论', '这段逻辑清晰']
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
    assert.equal(card.header.title.content, `repo · ${label} PR #2`);
    assert.equal(card.elements[0].text.content, '操作人：tester\n标题：登录' + (body ? '\n评审意见：' + body : ''));
    assert.equal(card.elements[1].actions[0].url, url);
  }
});

test('即使订阅全部事件，CI 也仅转发已完成且失败的运行', async () => {
  for (const [action, conclusion, expected] of [
    ['completed', 'success', 'ignored'], ['completed', 'cancelled', 'ignored'],
    ['in_progress', null, 'ignored'], ['completed', 'failure', 'sent']
  ]) {
    let sends = 0;
    const payload = { action, workflow_run: { conclusion, name: 'PR verification', head_branch: 'main' } };
    const response = await handle(delivery('workflow_run', payload), { ...env, GITHUB_EVENTS: '*' }, async () => {
      sends++;
      return Response.json({ code: 0 });
    });
    assert.equal((await response.json()).message, expected);
    assert.equal(sends, expected === 'sent' ? 1 : 0);
  }
});
