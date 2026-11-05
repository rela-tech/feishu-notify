# feishu-notify

把选定的 GitHub 事件转成飞书群卡片。卡片显示事件、仓库、操作人，并在有详情链接时提供跳转按钮。Push 附带分支或标签及最新提交摘要，PR、Issue 和 Release 附带标题。项目使用 Node.js 24 和 Vercel Functions，无第三方运行依赖。

## 一键部署

在 macOS / Linux 上安装 Node.js 24 和 GitHub CLI（`gh`），克隆项目，确认 `git remote get-url origin` 指向需要订阅的 GitHub 仓库，然后运行：

```sh
npm run deploy
```

首次运行会引导你登录 GitHub 和 Vercel，并在终端提示粘贴目标飞书群的**自定义机器人 webhook 地址**。机器人开启签名校验时，再输入飞书提供的签名密钥。输入时不会回显。GitHub 账号需有管理目标仓库 webhook 的权限，Vercel 账号需能创建项目和部署到生产环境。

脚本会自动获取固定版本的 Vercel CLI，关联或创建项目，生成 GitHub 签名密钥并写入 Vercel Production，然后触发生产部署。它会向稳定生产域名发送签名 ping，收到 `pong` 后，在 GitHub 创建或更新指向该地址的 webhook。整个过程无需在两边控制台复制密钥或勾选事件。

再次运行会使用已关联的 Vercel 项目、已有的 GitHub 密钥、机器人和订阅规则。部署中断后可直接重跑。脚本按生产端点地址识别 webhook，只管理对应条目。

## 配置订阅

默认值为 `push,pull_request.opened,pull_request.closed,issues.opened,issues.closed,release.published,pull_request_review.submitted,issue_comment.created,pull_request_review_comment.created`。例如，只想收到 PR 打开和 Release 发布通知，可以这样更新订阅并重新部署：

```sh
GITHUB_EVENTS=pull_request.opened,release.published npm run deploy
```

- `issues` 匹配该事件的所有动作，`issues.closed` 仅匹配关闭动作。
- `*` 匹配 GitHub 已投递的全部业务事件。没有专用展示的事件也会生成通用卡片。
- `pull_request_review.submitted` 在提交评审时发送卡片，标题显示批准、要求修改或评论，正文附评审意见。
- 脚本将 `release.published` 等规则转换为 GitHub 的事件类型，并将完整规则写入 Vercel 供函数过滤动作。
- 已合并 PR 使用 GitHub 的 `pull_request.closed` 规则，卡片会标为 `merged`。空的规则列表会暂停业务通知。

自动化环境可通过进程环境变量或本机 `.env.local` 提供 `FEISHU_WEBHOOK_URL`、可选的 `FEISHU_SIGNING_SECRET` 和 `GITHUB_EVENTS`。GitHub 密钥由脚本生成，以 Vercel 可读的 Production Config 保存，供下次部署同步。飞书机器人地址和签名密钥以 Secret 保存。

## 本地验证与排错

Node.js 24 下运行 `npm test` 即可验证验签、订阅过滤、卡片生成和飞书错误处理。测试使用模拟机器人。需要通过 HTTP 调试时，复制 `.env.example` 为 `.env.local` 并填入配置，然后在项目根目录运行 `npx vercel dev`。

在 GitHub Recent Deliveries 中，`ignored` 表示订阅未命中，`401` 表示 GitHub 密钥或签名不匹配，`502` 表示飞书请求失败或机器人拒收。处理失败后可手动 Redeliver。超时后先检查群里是否已收到卡片，此服务没有持久化去重，重复投递可能产生重复通知。

参考文档：[GitHub webhook 验签](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) · [飞书自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot) · [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
