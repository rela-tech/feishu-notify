export const defaultEvents = 'push,pull_request.opened,pull_request.closed,issues.opened,issues.closed,release.published,pull_request_review.submitted,issue_comment.created,pull_request_review_comment.created,pull_request.review_requested,pull_request.ready_for_review,pull_request.reopened,issues.reopened,workflow_run.completed';
export const botUrlPattern = /^https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[\w-]+$/;

export function subscriptionRules(value = defaultEvents) {
  const rules = value.split(',').map(rule => rule.trim()).filter(Boolean);
  if (rules.some(rule => !/^(?:\*|[a-z0-9_]+(?:\.[a-z0-9_]+)?)$/.test(rule))) {
    throw new Error('Invalid GITHUB_EVENTS');
  }
  return rules;
}
