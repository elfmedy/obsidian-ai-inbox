# P0 加载与联调

这套产物只用于验证，不保存真实聊天正文。第八版会将本轮校验通过、已下载并解码的可见图片写入专用测试 Vault，并生成本地预览。正式产品仍按“一个按钮保存当前聊天全部内容与图片”的需求实现。

## 当前这轮：验证真实图片落盘

Obsidian 测试插件已更新并重载。此前连接令牌已失效，本次需重新连接一次：

1. Chrome 的 `chrome://extensions` 中重新加载 **AI Inbox P0**。
2. 从 Obsidian 命令 **AI Inbox P0: 打开测试连接信息** 打开的最新文件复制 JSON，在扩展“连接测试仓库”粘贴并连接。不要把连接信息发到聊天里。
3. 回到原来含上传截图的一问一答聊天，点击 **验证聊天并写入测试图片**。
4. 摘要应显示“1 张测试图片已写入 Vault，回读字节一致”；诊断 `probeVersion=8`、`imageTransfer.status=complete`、`stored=offered=1`。
5. 复制摘要下的 `P0/run-…/content-images/….md` 路径，在 Obsidian 用快速切换或文件树打开预览。先确认图片正确，再断网、关闭并重新打开这份预览，确认仍能显示；无需关闭 Obsidian。验证后可恢复网络。

反馈“复制诊断”得到的结果，以及预览是否为原图、断网后是否仍能显示。第 4 步只证明字节落盘，第 5 步才提供真实图片离线显示证据；是否与上传原文件逐字节一致尚需原文件摘要比对，肉眼相同不能替代这一检查。

本轮仅测试已渲染可见图片，最多 10 张、单张 25 MiB、缓存合计 50 MiB。任何抓取/下载失败或超过探针图片数时不发送这批图片；上传途中失败可能留下已核验的测试图片，摘要会说明未全部确认，不会创建完整聊天笔记。已存在的同摘要文件只回读校验，不覆盖用户改过的图片。

## 1. 已准备的文件

- Chrome 未打包扩展：`<项目目录>\dist\p0\chrome-extension`
- 独立 Obsidian Vault：`<项目目录>\.local\p0-vault`
- Vault 内的插件目录：`.obsidian/plugins/ai-inbox-p0`

重新构建使用 Node.js 24：`npm ci` → `npm run check` → `npm run prepare:p0`。准备脚本只允许操作带专用标记的测试 Vault，不覆盖普通 Vault。配置目录的固定名称只出现在新建测试 Vault 的脚手架中；插件运行时代码不硬编码配置路径。

## 2. 第一次加载

1. Chrome 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，选上面的 Chrome 扩展目录。
2. Obsidian 选择“打开本地仓库”，选上面的 `p0-vault`。只在这个测试仓库内启用社区插件和 **AI Inbox P0**。
3. 出现就绪提示后，在命令面板执行 **AI Inbox P0: 打开测试连接信息**。复制 JSON 代码块内容，在扩展的“连接测试仓库”内粘贴并点击“连接”。连接令牌不用发到聊天里；它只用于本机测试，重载插件即失效。
4. 回到用户提供的普通 ChatGPT 测试聊天，等待回复结束，点击扩展里的“验证当前聊天”。
5. Obsidian 执行 **AI Inbox P0: 验证测试笔记的编辑器保护**。

Windows 浏览器控制工具本轮因无法可靠确认地址而停止了桌面浏览器输入；内置浏览器的刷新又返回了首页，尚未形成稳定取数条件。因此当前需要用户完成扩展加载及测试仓库的首次启用；这些安装操作不能由页面 DOM 探针代替。

## 3. 结果在哪里

当前为第八版页面探针：保留第七版分页和工具图保护，增加浏览器图片缓存、分块传输与 Vault 回读校验。新结果包含 `diagnostics.probeVersion: 8` 和顶层 imageTransfer。`diagnostics.request.pagination` 为 null 表示未触发多页读取，否则显示 additionalRequests、pages、completed、headRechecked；responseShape 仍描述初始响应，所以它显示 partial 与合并后的 messageArray.coverage=complete 可以同时成立。

集中联调时检查 `diagnostics.request.messageArray`、pagination、顶层 imageTransfer、issues 和 metrics。数组路线下 graphCandidates/verifiedGraphs 为 0 是正常的，是否采用数据看 messageArray.validated、capturedMessages 和 chainMatchesVisible。遇到 `TOOL_IMAGE_REQUIRES_ASSET_ADAPTER` 表示识别了尚不能完整保存的工具图片，不应忽略错误。第八版两端均已更新，需要按顶部步骤重连。

2026-09-12 首轮修复后重试：Obsidian 测试插件已经由开发工具更新和重载；请在 Chrome 的 `chrome://extensions` 对 AI Inbox P0 点“重新加载”。然后在 Obsidian 再次执行“打开测试连接信息”，复制**最新 run** 的 JSON 重新连接，再验证当前聊天。无需重新建立 Vault，也无需重装扩展。

每次启用创建新的 `P0/run-*`，不覆盖旧结果：

| 文件 | 含义 |
| --- | --- |
| `vault-results.json` | 真实 Vault.process、properties 原文保留、写前变化拒绝、图片字节回读 |
| `Editor-*-results.json` | 真实编辑器 buffer 改动后的另存决策及保留结果 |
| `browser-*.json` | 扩展上报的结构和图片计数，不含聊天内容 |
| `transport-fixture.png` | MV3 从本机下载再上传、插件落盘校验的合成图片 |
| `content-images/<摘要>.<扩展名>` | 浏览器传入并回读校验过的测试图片；不保留远程签名 URL |
| `content-images/<摘要>.md` | 对应图片的纯本地预览 |
| `content-images/<摘要>.json` | 摘要/大小/格式与回读通过记录；不自动声称离线显示已验证 |
| `Connection.md` | 当前进程的临时连接信息 |

扩展显示的 `issues` 用于诊断。`requiresLiveValidation: true` 和 `fullP0Passed: false` 是有意保留的状态：一次探针运行不能证明完整聊天、全部图片和所有并发情形已经通过。

## 4. 本轮能验证什么

- 当前可见消息与结构化图谱是否属于同一聊天，当前分支的节点链是否完整。
- 最多 10 个已渲染内容图片的获取及浏览器解码；排除已实测确认的引用网站 favicon。
- MV3 到绑定 Vault 的本机鉴权通信及合成图片字节往返。
- Obsidian 的原子正文更新检查、属性保留与编辑器另存保护样例。

本轮**不能**证明：屏幕外所有图片已获取、上传图一定为原图、生成图/多图/blob/过期签名已覆盖、200 条真实长聊天完整、worker 重启恢复、同时输入所有竞争窗口、离线 Vault 中真实聊天图片可显示。下一步继续补齐这些实测用例。

页面在站内导航后可能保留旧 hydration 脚本。若结果为 `NO_UNAMBIGUOUS_HYDRATION_GRAPH`，不要把它当保存成功。可在确认没有未发送草稿后刷新该 ChatGPT 页面，再运行一次，比较结果；若仍失败，保留失败状态并修正取数路线。

## 5. 卸载

在测试 Vault 停用插件会关闭本机接收服务，随后可关闭测试 Vault。在 Chrome 扩展管理页移除 P0 扩展。无需修改日常知识库。测试文件保留供复核，不自动删除。
