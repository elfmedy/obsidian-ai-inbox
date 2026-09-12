# AI Inbox

点一下，保存当前 ChatGPT 聊天的全部对话和图片到 Obsidian。再次保存时，本地正文未改就更新，改过就另存带日期时间的新笔记，保留用户编辑。

当前阶段：**0.3.1 Alpha 已实现自动发现与一次配对、默认仓库切换，以及完整保存链路。** 用户已确认能看到保存的对话和图片；新版连接流程的受控端到端验证通过。长聊天、生成图和真实分支仍有验收项，尚未发布到商店或 Obsidian 社区。

安装与成功判定请看 **[Alpha 安装与验收](docs/alpha-testing.md)**。新扩展加载目录是 `dist/alpha/chrome-extension`，Obsidian 插件在 `dist/alpha/obsidian-plugin`；原 `dist/p0` 是独立诊断工具。

## 通过 BRAT 安装

要求：Obsidian 桌面版 1.12.0 或更高版本；实际验证版本为 Windows / Obsidian 1.13.7。当前为 Alpha，尚未上架社区目录。

1. 在 Obsidian 社区插件中安装并启用 **BRAT**。
2. 在 BRAT 设置中选择 **Add Beta plugin**，输入 `elfmedy/obsidian-ai-inbox`，添加并启用 **AI Inbox**。如选择指定版本，请使用 `0.3.1`。
3. 从 [Release](https://github.com/elfmedy/obsidian-ai-inbox/releases/tag/0.3.1) 下载 `ai-inbox-chrome-0.3.1-alpha.zip` 并解压，在 Chrome 扩展管理页打开开发者模式，加载解压后的 `ai-inbox-chrome` 文件夹。
4. 保持 Obsidian 打开，在 ChatGPT 普通聊天页点击扩展图标。首次在 Obsidian 确认连接，之后一键保存。多个仓库时选择一次即成为默认，也可右键扩展图标切换。

图片遵循 Obsidian 的默认附件位置；Obsidian 未运行或默认仓库未打开时提示失败，不离线暂存。BRAT 负责 Obsidian 插件更新，Chrome 扩展仍需手动更新。

Release 中的 `main.js`、`manifest.json` 可直接供 BRAT 安装；插件使用 Obsidian 原生样式，无需 `styles.css`。完整第三方许可同时保留在 JavaScript 包及 ZIP 中。

**0.3.1 修复了 Chrome 菜单重复 ID 错误。** 仅需更新 Chrome 扩展，Obsidian 插件 0.3.0 仍兼容。在扩展的错误页面清除旧记录，重新加载后检查是否有新增错误。

## 内容和语言设置

在 **Obsidian → 设置 → AI Inbox** 中设置；规则按仓库保存，Chrome 扩展在每次保存前读取目标仓库的设置。

| 设置 | 默认值 | 行为 |
| --- | --- | --- |
| 保存思考内容 | 关闭 | 开启后保存展开“思考”显示的摘要及已识别的思考活动，使用默认折叠的引用块。正常回答、普通过程消息和图片仍保留。 |
| 在正文显示对话标题 | 关闭 | 控制插件额外生成的正文标题。文件名与回答中的原有标题始终保留。 |
| 界面语言 | 跟随 Obsidian | 可选简体中文、English；其他 Obsidian 语言回退英文。设置、弹窗、提示和笔记自动标签跟随此选择，聊天原文不翻译。 |

设置变化在下次点击保存时生效，不自动批量修改已有笔记；源内容没变化也会应用新格式，本地已编辑则另存时间戳笔记。保存期间设置发生变化会提示重新保存。

**升级到 0.3.0 时，请同时更新 Chrome 扩展。** Obsidian 可通过 BRAT 更新，现有连接与笔记索引保留；新扩展加载后刷新 ChatGPT 页面。思考适配参考 Pionxzh 的开源导出器，支持已识别的摘要结构；无法识别时明确报错，可关闭思考保存继续。

## 开发文档

| 文档 | 内容 |
| --- | --- |
| [需求基线](docs/requirements-baseline.md) | 用户确认的范围、保存规则和产品边界 |
| [详细设计](docs/detailed-design.md) | 用户流程、架构、数据模型、通信、图片、文件保护及恢复 |
| [开发计划](docs/development-plan.md) | 阶段任务、依赖、工作量、交付物与发布门槛 |
| [开源实现审查与复用](docs/open-source-review.md) | 六个上游项目、源码证据、许可、已采用部分和后续路线 |
| [交互约定](docs/interaction-design.md) | 工具栏直接执行、固定图标、反馈卡、中英文与设置 |
| [连接和仓库选择](docs/connection-discussion.md) | 已确认的自动发现、配对、默认仓库和未运行时失败规则 |
| [验收用例](docs/acceptance-tests.md) | 正常保存、图片、编辑保护、并发和故障的验收标准 |
| [P0 验证记录](docs/technical-spikes.md) | 已有证据、未通过项与取数风险 |
| [P0 加载与联调](docs/p0-testing.md) | 加载 Chrome 扩展、打开独立测试 Vault、查看结果 |
| [发布与开发规范](PUBLISHING.md) | 必需文件、Obsidian API、许可证与发布门槛 |

首版为 Chrome 扩展 + Obsidian 桌面插件，Windows 优先。日常操作只有一个保存按钮，不提供消息选择、保存模式或 AI 内容整理。

开发环境使用 Node.js 24。执行 `npm ci`、`npm run check`，生成 P0 和 Alpha 两套包。检查包括官方 Obsidian lint、TypeScript strict、179 项自动测试、两端打包、版本一致性、第三方许可随包和重复构建字节比较。

当前上传图已完成 P0 的 Chrome→Vault 字节校验、Obsidian 本地显示和用户确认的离线显示。Alpha 已接入完整消息抓取、图片下载、引用转换、受保护写入、持久化重试和固定图标交互；浏览器重启、响应丢失和重复点击的受控回归通过。

用户暂无长聊天/生成图样本，相关实测继续保留。支持范围、错误行为、数据存储及剩余发布门槛见 Alpha 验收文档；不把合成页面的测试结果等同于真实 ChatGPT 全场景通过。
