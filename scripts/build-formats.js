import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { cardContext } from '../src/card-context.js';
import { subscriptionRules } from '../src/config.js';

const directory = new URL('../formats/', import.meta.url);
const keys = new Set(Object.keys(cardContext('', {})));
const colors = new Set('default blue wathet turquoise green yellow orange red carmine violet purple indigo grey'.split(' '));
const formats = Object.create(null);

function validate(format, name) {
  function check(valid, message) {
    if (!valid) throw new Error(`${name}: ${message}`);
  }
  check(Object.keys(format).every(key => ['title', 'color', 'fields', 'button', 'link'].includes(key)), '未知格式属性');
  check(typeof format.title === 'string' && format.title.trim(), '缺少标题');
  const literal = format.title.replace(/{{(\w+)}}/g, (_, key) => {
    check(keys.has(key), `未知标题变量 ${key}`);
    return '';
  });
  check(!/[{}]/.test(literal), '标题变量格式错误');
  check(colors.has(format.color ?? 'default'), '未知颜色');
  check(typeof format.button === 'string' && format.button.trim() && keys.has(format.link), '无效按钮或链接字段');
  check(Array.isArray(format.fields) && format.fields.every(field => Array.isArray(field) &&
    field.length === 2 && typeof field[0] === 'string' && field[0].trim() && keys.has(field[1])), '无效正文字段');
}

for (const file of readdirSync(directory).filter(file => file.endsWith('.yml'))) {
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
writeFileSync(new URL('../src/formats.generated.json', import.meta.url), JSON.stringify(formats));
