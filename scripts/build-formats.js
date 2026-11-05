import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import Mustache from 'mustache';
import { cardContext } from '../src/card-context.js';
import { subscriptionRules } from '../src/config.js';

const directory = new URL('../formats/', import.meta.url);
const keys = new Set(Object.keys(cardContext('', {})));
const colors = new Set('default blue wathet turquoise green yellow orange red carmine violet purple indigo grey'.split(' '));
const formats = Object.create(null);

const shared = parse(readFileSync(new URL('_shared.yml', directory), 'utf8'));

function validateTemplate(template, name, allowPartials = true) {
  if (typeof template !== 'string') throw new Error(`${name}: 模板必须是字符串`);
  function visit(tokens) {
    for (const [type, key, , , children] of tokens) {
      if (type === 'text' || type === '!') continue;
      if (type === '>' && allowPartials && Object.hasOwn(shared.partials, key)) continue;
      if (!['name', '&', '#', '^'].includes(type) || !keys.has(key)) {
        throw new Error(`${name}: 不支持的模板变量或片段 ${key}`);
      }
      if (children) visit(children);
    }
  }
  visit(Mustache.parse(template));
}

if (!colors.has(shared.color) || !['default','primary','danger'].includes(shared.buttonType) ||
    !Number.isSafeInteger(shared.bodyValueLimit) || shared.bodyValueLimit < 1) {
  throw new Error('_shared.yml: 无效的默认样式或正文变量长度');
}
validateTemplate(shared.repositoryButton, '_shared.yml / repositoryButton');
for (const [name, template] of Object.entries(shared.partials)) {
  validateTemplate(template, `_shared.yml / ${name}`, false);
}

function validate(format, name) {
  function check(valid, message) {
    if (!valid) throw new Error(`${name}: ${message}`);
  }
  check(Object.keys(format).every(key => ['title', 'color', 'body', 'button', 'link'].includes(key)), '未知格式属性');
  check(typeof format.title === 'string' && format.title.trim(), '缺少标题');
  validateTemplate(format.title, name + ' / title');
  validateTemplate(format.body, name + ' / body');
  validateTemplate(format.button, name + ' / button');
  check(colors.has(format.color ?? shared.color), '未知颜色');
  check(format.button.trim() && keys.has(format.link), '无效按钮或链接字段');
}

for (const file of readdirSync(directory).filter(file => file !== '_shared.yml' && file.endsWith('.yml'))) {
  const { variants = {}, ...base } = parse(readFileSync(new URL(file, directory), 'utf8'));
  validate(base, file);
  for (const [variant, overrides] of Object.entries(variants)) {
    validate({ ...base, ...overrides }, `${file} / ${variant}`);
  }
  formats[file.slice(0, -4)] = { ...base, variants };
}
if (!formats.default) throw new Error('缺少通用通知格式');
for (const rule of subscriptionRules()) {
  const [event, action] = rule.split('.');
  if (!formats[event] || (action && !Object.hasOwn(formats[event].variants, action))) {
    throw new Error(`订阅 ${rule} 缺少通知格式`);
  }
}
writeFileSync(new URL('../src/formats.generated.json', import.meta.url), JSON.stringify({ formats, shared }));
