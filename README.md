# feishu-notify

把选定的 GitHub 事件转成飞书群卡片。卡片显示事件、仓库、操作人，并在有详情链接时提供跳转按钮。Push 附带分支或标签及最新提交摘要，PR、Issue 和 Release 附带标题。项目使用 Node.js 24 和 Vercel Functions，无第三方运行依赖。

## 自部署到 Vercel

1. 在飞书群设置中添加「自定义机器人」，复制 webhook 地址。如果开启「签名校验」，同时复制机器人的签名密钥。如果启用了关键词校验，可将 `GitHub` 加入关键词。
2. 将本项目推送到自己的 Git 仓库，在 Vercel 新建项目并导入该仓库。Framework Preset 选 **Other**，使用仓库根目录和默认构建设置。
3. 在 Vercel 的 Production 环境配置以下变量，然后部署。之后修改变量需要重新部署才会生效。

| 环境变量 | 用途 |
| --- | --- |
| `GITHUB_WEBHOOK_SECRET` | 必填。自定的 GitHub webhook 密钥，可用 `openssl rand -hex 32` 生成。 |
| `FEISHU_WEBHOOK_URL` | 必填。飞书或 Lark 自定义机器人的完整 webhook 地址。 |
| `FEISHU_SIGNING_SECRET` | 机器人开启签名校验时必填，使用飞书提供的密钥。 |
| `GITHUB_EVENTS` | 可选。逗号分隔的订阅规则，见下节。 |

4. 打开 GitHub 仓库的 **Settings → Webhooks → Add webhook**。Payload URL 填 `https://你的生产域名/api/github`，Content type 选 `application/json`，Secret 填与 `GITHUB_WEBHOOK_SECRET` 相同的值。在 **Let me select individual events** 中勾选需要转发的事件并启用 webhook。该地址须允许 GitHub 直接访问。
5. 在 **Recent Deliveries** 确认初始 `ping` 返回 `200 pong`，然后触发一个已订阅的事件，确认返回 `200 sent` 且群内收到卡片。Ping 仅验证 GitHub 到函数的连接。

## 配置订阅

默认值为 `push,pull_request.opened,pull_request.closed,issues.opened,release.published`。例如，只想收到 PR 打开和 Release 发布通知，可设置：

```dotenv
GITHUB_EVENTS=pull_request.opened,release.published
```

- `issues` 匹配该事件的所有动作，`issues.closed` 仅匹配关闭动作。
- `*` 匹配 GitHub 已投递的全部业务事件。没有专用展示的事件也会生成通用卡片。
- 两层筛选同时生效。例如订阅 `release.published` 时，GitHub webhook 也需要勾选 Releases。
- 已合并 PR 使用 GitHub 的 `pull_request.closed` 规则，卡片会标为 `merged`。空的规则列表会暂停业务通知。

## 本地验证与排错

Node.js 24 下运行 `npm test` 即可验证验签、订阅过滤、卡片生成和飞书错误处理。测试使用模拟机器人。需要通过 HTTP 调试时，复制 `.env.example` 为 `.env.local` 并填入配置，然后在项目根目录运行 `npx vercel dev`。

在 GitHub Recent Deliveries 中，`ignored` 表示订阅未命中，`401` 表示 GitHub 密钥或签名不匹配，`502` 表示飞书请求失败或机器人拒收。处理失败后可手动 Redeliver。超时后先检查群里是否已收到卡片，此服务没有持久化去重，重复投递可能产生重复通知。

参考文档：[GitHub webhook 验签](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) · [飞书自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot) · [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
