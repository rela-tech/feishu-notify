const plain = content => ({ tag: 'plain_text', content });

const actionLabels = new Map(Object.entries({
  opened: '新建', closed: '关闭', reopened: '重新打开', edited: '编辑',
  review_requested: '请求评审', ready_for_review: '准备评审', synchronize: '更新', published: '发布', created: '创建', deleted: '删除'
}));

const reviewLabels = new Map([
  ['approved', '批准'], ['changes_requested', '要求修改'], ['commented', '评论']
]);

const actionTemplates = new Map([
  ['pull_request.opened', 'wathet'],
  ['pull_request.review_requested', 'wathet'],
  ['pull_request.ready_for_review', 'wathet'],
  ['issues.opened', 'wathet'],
  ['release.published', 'wathet']
]);

function headerTemplate(event, p) {
  if (event === 'pull_request' && p.action === 'closed' && p.pull_request?.merged) return 'green';
  if (event === 'issues' && p.action === 'closed' && p.issue?.state_reason === 'completed') return 'green';
  if (event === 'pull_request_review' && p.action === 'submitted') {
    const state = p.review?.state?.toLowerCase();
    if (state === 'approved') return 'green';
    if (state === 'changes_requested') return 'red';
  }
  return actionTemplates.get(`${event}.${p.action}`) ?? 'default';
}

function describe(event, p) {
  const item = p.pull_request ?? p.issue ?? p.release ?? p.workflow_run ?? p.discussion;
  const url = item?.html_url;
  const action = actionLabels.get(p.action) ?? p.action ?? '';
  const subject = item?.title ?? item?.name ?? item?.tag_name;
  const number = item?.number ?? p.number;
  const suffix = number ? ` #${number}` : '';

  if (event === 'workflow_run') {
    const run = p.workflow_run;
    return { title: 'CI 失败', details: [['工作流', run.name], ['分支', run.head_branch]],
      url: run.html_url, target: '运行记录' };
  }
  if (event === 'push') {
    const ref = p.ref?.replace(/^refs\/(heads|tags)\//, '');
    const verb = p.deleted ? '删除' : '推送到';
    return {
      title: [verb, ref].filter(Boolean).join(' '),
      details: [['提交', p.head_commit?.message?.split('\n')[0]]],
      url: p.compare ?? p.head_commit?.url, target: '提交'
    };
  }
  if (event === 'pull_request_review' && p.action === 'submitted') {
    const verb = reviewLabels.get(p.review?.state?.toLowerCase()) ?? '评审';
    return {
      title: `${verb} PR${suffix}`,
      details: [['标题', subject], ['评审意见', p.review?.body?.trim()]],
      url: p.review?.html_url ?? url, target: '评审'
    };
  }
  if (event === 'issue_comment' || event === 'pull_request_review_comment') {
    const kind = event === 'pull_request_review_comment' || p.issue?.pull_request ? 'PR' : 'Issue';
    const verb = p.action === 'created' ? '评论' : `${action}评论`;
    return { title: `${verb} ${kind}${suffix}`, details: [['评论', p.comment?.body]],
      url: p.comment?.html_url ?? url, target: '评论' };
  }
  if (event === 'issues' || event === 'pull_request') {
    const kind = event === 'issues' ? 'Issue' : 'PR';
    const verb = p.action === 'closed' && p.pull_request?.merged ? '合并' : action;
    const details = [['标题', subject]];
    if (p.action === 'review_requested') details.push(['请求评审', p.requested_reviewer?.login ?? p.requested_team?.slug]);
    if (p.action === 'opened' || (event === 'pull_request' && ['review_requested', 'ready_for_review'].includes(p.action))) {
      details.push(['正文', item?.body?.trim()]);
    }
    return { title: `${verb} ${kind}${suffix}`.trim(), details, url, target: kind };
  }
  if (event === 'release') {
    const tag = p.release?.tag_name;
    const details = [['名称', subject === tag ? undefined : subject]];
    if (p.action === 'published') details.push(['发布说明', p.release?.body?.trim()]);
    return { title: [action, 'Release', tag].filter(Boolean).join(' '), details, url, target: 'Release' };
  }
  return {
    title: [event, p.action].filter(Boolean).join(' · '),
    details: [['标题', subject], ['引用', p.ref], ['结果', p.workflow_run?.conclusion]],
    url: p.comment?.html_url ?? p.review?.html_url ?? url, target: '详情'
  };
}

export function githubCard(event, p) {
  const repo = p.repository?.name ?? p.repository?.full_name?.split('/').pop() ?? p.organization?.login;
  const { title, details, url, target } = describe(event, p);
  const body = [['操作人', p.sender?.login], ...details]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${String(value).slice(0, 320)}`).join('\n');
  const elements = [];
  if (body) elements.push({ tag: 'div', text: plain(body) });
  const link = url ?? p.repository?.html_url;
  if (typeof link === 'string' && link.startsWith('https://')) {
    elements.push({ tag: 'action', actions: [
      { tag: 'button', text: plain(`在 GitHub 查看${url ? target : '仓库'}`), url: link, type: 'primary' }
    ] });
  }
  return {
    msg_type: 'interactive',
    card: { header: { template: headerTemplate(event, p), title: plain([repo, title].filter(Boolean).join(' · ')) }, elements }
  };
}
