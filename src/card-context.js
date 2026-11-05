export function cardContext(event, p) {
  const item = p.pull_request ?? p.issue ?? p.release ?? p.workflow_run ?? p.discussion;
  const repo = p.repository?.name ?? p.repository?.full_name?.split('/').pop();
  const location = repo ? `在 ${repo} 仓库` : p.organization?.login ? `在 ${p.organization.login} 组织` : '';
  const actor = p.sender?.login;
  const subject = item?.title ?? item?.name ?? item?.tag_name;
  const number = item?.number ?? p.number;
  const refName = typeof p.ref === 'string' ? p.ref.replace(/^refs\/(heads|tags)\//, '') : '';
  const tag = p.release?.tag_name;
  const itemUrl = item?.html_url;
  return {
    actor, subject, itemUrl, tag,
    prefix: (actor ? actor + ' ' : '') + location,
    number: number ? ` #${number}` : '',
    branch: refName ? ` ${refName} 分支` : '分支',
    branchDestination: refName ? `到 ${refName} 分支` : '',
    action: p.action ?? event,
    eventAction: [event, p.action].filter(Boolean).join(' · '),
    releaseAction: [tag, p.action].filter(Boolean).join(' · ') || event,
    releaseName: subject === tag ? undefined : subject,
    ref: p.ref,
    conclusion: p.workflow_run?.conclusion,
    body: typeof item?.body === 'string' ? item.body.trim() : undefined,
    commit: p.head_commit?.message?.split('\n')[0],
    reviewer: p.requested_reviewer?.login ?? p.requested_team?.slug,
    reviewBody: p.review?.body?.trim(),
    comment: p.comment?.body,
    commentKind: p.issue?.pull_request ? 'PR' : 'Issue',
    pushUrl: p.compare ?? p.head_commit?.url,
    reviewUrl: p.review?.html_url ?? itemUrl,
    commentUrl: p.comment?.html_url ?? itemUrl,
    detailUrl: p.comment?.html_url ?? p.review?.html_url ?? itemUrl
  };
}
