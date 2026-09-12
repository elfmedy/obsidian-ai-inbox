# 开发与发布规范

当前发布版本为 AI Inbox 0.3.0 Alpha，支持 GitHub Release / BRAT 安装；P0 诊断工具独立保留，暂不提交社区目录。规范参考 [Obsidian 官方提交流程](https://docs.obsidian.md/plugins/releasing/submit-plugin)。

## 文件与版本

- 根目录保留 `README.md`、`LICENSE`、`manifest.json`、`versions.json`、`package.json`、`package-lock.json`、源码与构建脚本。
- 许可证沿用参考项目的 MIT，版权名 `elfmedy`。第三方依赖保留自身许可，正式打包前审查其分发义务。
- manifest 的 `version` 必须为 `x.y.z`；package 与 lockfile 同步；`versions.json` 记录对应最低 Obsidian 版本。
- 插件运行包需要 `main.js`、`manifest.json`；有插件样式时添加 `styles.css`。正式插件使用原生样式，因此不放空 CSS。Chrome UI 的 CSS 属于扩展。
- 正式 GitHub Release 标签与 manifest 版本完全一致，不添加 `v`。运行文件作为 Release 独立附件发布，ZIP 只是补充分发方式。
- 源码不包含 `.local` 测试 Vault、令牌、聊天内容、个人数据、node_modules 和 dist。发布源码包采用白名单，不能仅依赖 .gitignore。

## Obsidian 实现约束

- 默认导出继承 `Plugin` 的类；用 `onload` 注册命令、事件和服务，`onunload`/注册清理释放资源。异步初始化必须检查已卸载状态，避免服务在卸载后启动。
- 使用公开 API；`Vault.process` 回调内检查最新全文再修改，用户 frontmatter 原文字节保留。实际编辑器 buffer 的保护必须另行验证，不能认为磁盘锁等于编辑器安全。
- 使用 `Vault.getFileByPath`、`read`、`create`、`createBinary`、`readBinary` 等文件 API；配置目录使用 `Vault.configDir`。
- 移动和删除采用合适的 FileManager API，并遵守用户设置；不在卸载时 detach 用户叶子或改动用户笔记。
- 有 UI 语言选择需求时使用 `getLanguage()`，不从 localStorage 推断。弹出窗口 DOM/定时器应遵循官方 lint 的窗口兼容建议。
- 本插件需要 Node loopback 服务，manifest 标为 `isDesktopOnly: true`。最低版本目前是设计目标 1.12.0，不能把仅在 1.13.7 实测通过说成已验证所有 1.12.x。

## 已接入检查

Node.js 24：`npm ci` → `npm run check`。包括：

1. 官方 `eslint-plugin-obsidianmd` recommended；插件代码不关闭其推荐规则，警告作为失败。浏览器和公共 Node 模块单独限定适用规则。
2. TypeScript strict 和业务/鉴权/图谱/图片测试。
3. 两端构建、manifest/package/lock/versions 一致性，以及同一环境重新构建的字节比较。
4. `.github/workflows/check.yml` 在 push / pull request 时运行 Windows / Node 24 CI；具体结果见 GitHub Actions。

## 正式发布前仍需完成

开源适配来源与修改记录见 `THIRD_PARTY_NOTICES.md`；完整许可证位于 `third-party/`。两端构建都会附带这些文件，打包检查比对原文字节；新增复制代码或依赖时同步更新。不能将上游作者替换成 elfmedy，也不能因代码使用 MIT 就复制未授权的品牌图标。

P0→P6 验收、最低支持版本实机验证、完整权限和网络行为说明、依赖许可证审计、CHANGELOG/发布说明、带来源证明的构建与附件校验、源码白名单打包。

社区目录自动审核结果才是该次提交是否通过的证据。本地 lint、版本检查和同环境重复构建只能提前发现问题，不能保证社区审核通过；最终还需验证干净环境可复现、Release 证明和实际审核结果。官方当前入口是 Obsidian Community 网站，发布阶段应再次核验流程。

## GitHub / BRAT 发布步骤

1. 修改根目录 manifest、package / lockfile 与 versions；正式构建从根清单读取版本。P0 清单独立位于 `spikes/obsidian/p0/`。
2. 运行 `npm ci`、`npm run check`、`python scripts/package-alpha.py`。
3. 审查提交清单，仅添加根项目配置文档以及 `.github/`、`docs/`、`scripts/`、`spikes/`、`tests/`、`third-party/` 中的公开文件。排除本机数据、密钥和生成结果。
4. 推送源码并等待 CI 通过，创建与版本一致的标签。发布 `dist/releases` 中该版本的 ZIP、独立运行文件和 SHA256SUMS；不要上传旧版本 ZIP。
5. 检查 Release 的 manifest 与仓库根清单相同，main.js 与构建字节相同。BRAT 安装不会复制许可证附件，因此 main.js 内嵌完整第三方许可。
6. 当前 0.3.0 使用普通 GitHub Release 供 BRAT 默认安装/更新查找，标题与说明明确标为 Alpha；这不表示社区审核或剩余真实场景验收已经通过。
