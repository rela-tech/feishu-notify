const plain = content => ({ tag: 'plain_text', content });

export function githubCard(event, p) {
  const item = p.pull_request ?? p.issue ?? p.release ?? p.workflow_run ?? p.discussion;
  const repo = p.repository?.full_name ?? p.organization?.login ?? 'GitHub';
  const action = event === 'pull_request' && p.action === 'closed' && item?.merged
    ? 'merged' : p.action;
  const heading = [event, action].filter(Boolean).join(' · ');
  const summary = [
    item?.title ?? item?.name ?? item?.tag_name,
    p.ref,
    event === 'push' && p.head_commit?.message?.split('\n')[0],
    p.workflow_run?.conclusion
  ].filter(Boolean).map(line => String(line).slice(0, 320));
  const body = [`仓库：${repo}`, p.sender?.login && `操作人：${p.sender.login}`, ...summary]
    .filter(Boolean).join('\n');
  const elements = [{ tag: 'div', text: plain(body) }];
  const url = p.comment?.html_url ?? p.review?.html_url ?? item?.html_url ?? p.compare ?? p.repository?.html_url;
  if (typeof url === 'string' && url.startsWith('https://')) {
    elements.push({ tag: 'action', actions: [
      { tag: 'button', text: plain('在 GitHub 查看'), url, type: 'primary' }
    ] });
  }
  return {
    msg_type: 'interactive',
    card: { header: { template: 'blue', title: plain(`GitHub · ${heading}`) }, elements }
  };
}
