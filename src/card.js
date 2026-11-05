import formats from './formats.generated.json' with { type: 'json' };
import { cardContext } from './card-context.js';

const plain = content => ({ tag: 'plain_text', content });

function variantFor(event, p) {
  if (event === 'push') return p.deleted ? 'deleted' : '';
  if (event === 'pull_request' && p.action === 'closed' && p.pull_request?.merged) return 'closed.merged';
  if (event === 'issues' && p.action === 'closed' && p.issue?.state_reason === 'completed') return 'closed.completed';
  if (event === 'pull_request_review' && p.action === 'submitted') return 'submitted.' + p.review?.state?.toLowerCase();
  return p.action;
}

export function githubCard(event, p) {
  const context = cardContext(event, p);
  const useGenericReview = event === 'pull_request_review' && p.action !== 'submitted';
  const base = !useGenericReview && Object.hasOwn(formats, event) ? formats[event] : formats.default;
  const variant = variantFor(event, p);
  const key = Object.hasOwn(base.variants, variant) ? variant : p.action;
  const format = Object.hasOwn(base.variants, key) ? { ...base, ...base.variants[key] } : base;
  const title = format.title.replace(/{{(\w+)}}/g, (_, key) => context[key] ?? '').trim();
  const body = format.fields
    .filter(([, key]) => context[key])
    .map(([label, key]) => `${label}：${String(context[key]).slice(0, 320)}`).join('\n');
  const elements = [];
  if (body) elements.push({ tag: 'div', text: plain(body) });
  const url = context[format.link];
  const link = url ?? p.repository?.html_url;
  if (typeof link === 'string' && link.startsWith('https://')) {
    elements.push({ tag: 'action', actions: [
      { tag: 'button', text: plain(`在 GitHub 查看${url ? format.button : '仓库'}`), url: link, type: 'default' }
    ] });
  }
  return {
    msg_type: 'interactive',
    card: { header: { template: format.color ?? 'default', title: plain(title) }, elements }
  };
}
