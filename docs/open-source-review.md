# ChatGPT 导出开源实现审查与复用决策

日期：2026-09-12。范围：当前聊天的完整消息、图片本地化、Markdown 与 Obsidian 接入。

最新执行补充：单张上传图的真实落盘和离线显示已通过。用户暂无长聊天/生成图样本，转而推进可独立验证模块：已按 Pionxzh/OwlCt 实现候选图片指针 resolver、嵌套图片与附件提取；工具图在 P0 默认保持关闭，只有测试显式启用。已经引入并锁定 mdast-util-from-markdown 2.0.3、mdast-util-gfm 3.1.0、micromark-extension-gfm 3.0.0、mdast-util-math 3.0.0、micromark-extension-math 3.1.0，建立源码位置驱动的 Markdown 图片替换与完整消息清单。新增代码/依赖的 MIT 许可和全部非开发依赖许可证已纳入打包。下文 90 项测试等数字属于审查初次落地记录；当前为 113 项。

## 1. 结论

采用“复用导出适配经验与独立模块，自己实现 AI Inbox 的保存规则”的路线。此前在 hydration 上投入过多，应先读同类实现再决定是否补写适配器。此次已阅读六个仓库的相关源码和许可证，锁定提交；没有安装、运行这些扩展，也没有把我们的聊天上传给它们。

最直接解决当前卡点的是 **ThierryAbalea/chatgpt-conversation-export**：其 2026-09-06 提交已经使用与用户 Network 截图相同的复数会话接口和 `messages + page_info`，实现 `before=start_cursor` 向前翻页。它优先作为 P0 分页参考。Pionxzh 的 exporter 则用于消息分类、工具图片、引用转换的参考，不能以其旧 mapping 接口替代此次新格式适配。

不能据 GitHub 源码直接认定用户账号已经通过实测。以下“采用”均明确区分已改入代码、后续计划和未验证部分。

## 2. 已审查的仓库

| 项目与锁定提交 | 读到的实现及适用性 | 决策 |
| --- | --- | --- |
| [chatgpt-conversation-export](https://github.com/ThierryAbalea/chatgpt-conversation-export/tree/543a98a3f6cfb0f59ad23cd1c0b6d070f4e98324) · 2026-09-06 · MIT / Thierry Abalea | `extension/popup.js` 用复数接口、`num_turns=100`、`before` 分页，保留旧 mapping 回退；Python 模块生成完整/简洁 Markdown | **已改编分页流程**。不复制批量账号导出、原始 JSON 下载或 Python 运行架构 |
| [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter/tree/d0f44aae9d5650852b2979bbf830590b41f7b804) · 2026-08-28 · MIT / Pionxzh | `src/api.ts` 的当前分支遍历、内部消息分类、工具图片及图片指针解析；`src/utils/citations.ts` 引用转换；Markdown 使用 mdast/hast 生态 | **已据工具图判定补充防漏保护**；后续引用转换、图片清单的主要参考。其详情读取仍预期旧 mapping |
| [OwlCt/ChatGPT-Export](https://github.com/OwlCt/ChatGPT-Export/tree/ea52daa231c877fafce9d849b390a64fa03ca349) · 2026-07-08 · MIT / huhu | `Tampermonkey.js` 中兼容嵌套与平铺 image pointer，解析下载地址，将图片存入 ZIP 并替换 Markdown 路径 | 参考图片解析与文件布局；不采用下载失败后跳过图片仍继续导出的策略。详情路径仍为旧 singular 接口 |
| [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper/tree/a9d33ce919fb156beda390d2fc60cbc1e0ed9141) · 2026-09-03 · MIT 代码 / Obsidian | `src/content.ts` 调用 Defuddle 解析页面，适合作为官方浏览器集成与内容提取的参考 | 不整体 fork；现有两端原型已可构建和连接。品牌、图标等不随 MIT 代码许可一并复制 |
| [kepano/defuddle](https://github.com/kepano/defuddle/tree/ba2df0533d783aded12f5b325df97b997eeb6b43) · 2026-09-10 · MIT / Steph Ango | `src/extractors/chatgpt.ts` 提取 DOM 中对话、多片段消息和引用脚注；提供 Markdown 转换入口 | P1/P3 DOM 保真转换候选库，先用黄金样本验证。DOM 解析本身不能证明历史全量，不作为完整性兜底 |
| [mubaiblake/chatgpt-exporter-auto-sync](https://github.com/mubaiblake/chatgpt-exporter-auto-sync/tree/be86afcafcb852b03a1405d8a0becafc970d28ef) · 2026-05-18 · 保留 Pionxzh MIT 许可 | exporter 的自动同步分支，附本地接收端与同步流程 | 作为本机接收流程参考；不引入其自动同步、Python 服务或额外产品选项 |

仓库 HEAD 只代表本次审查的状态，不代表所审版本在全部账号上可用。只读参考副本放在 `.local/reference-sources/`，不随产品分发。仓库内测试夹具也不能直接当作我们的真实账号验收证据。

## 3. 关键源码证据与差异

### 3.1 新接口与真正的聊天历史分页

[上游分页函数](https://github.com/ThierryAbalea/chatgpt-conversation-export/blob/543a98a3f6cfb0f59ad23cd1c0b6d070f4e98324/extension/popup.js) 和 [格式说明](https://github.com/ThierryAbalea/chatgpt-conversation-export/blob/543a98a3f6cfb0f59ad23cd1c0b6d070f4e98324/docs/format.md) 给出：从最新一页开始，只要 `has_previous_page` 为 true 就用 `before=start_cursor` 取前页、前置消息；到 false 才结束。`num_turns` 是每页限制。

其他已审查 exporter 中的 `offset/limit` 多用于**会话列表**。那是列出账号内多段聊天，不是补齐一段聊天的早期消息，不能用它宣称满足我们的全量历史需求。

AI Inbox 保留用户已观察请求的 `num_turns=10`，不照抄上游的 100；只派生相同聊天的 `before` 请求。当前适配器增加每页身份、首尾游标、唯一 ID、分支/revision、一致重叠和进度检查。读取结束重取首个最新页，比对消息、分页信息和 revision。先后页的响应在内存中合并，不把原始记录写到诊断中。

**仍需验证的接口假设**：前页返回同一全局 `current_node` 与 `update_time`，`has_next_page=true`，游标对应消息 ID；无重叠时 `before` 返回紧邻的上一段。若真实响应不满足这些假设，明确失败后凭完整源码/脱敏样本修改，不能自动取消检查。最终重读最新页有助于发现变化，但不构成服务器提供原子快照的保证。

### 3.2 工具消息也可能包含要保存的图片

[Pionxzh 的消息与图片处理](https://github.com/pionxzh/chatgpt-exporter/blob/d0f44aae9d5650852b2979bbf830590b41f7b804/src/api.ts) 区别普通工具结果与包含图片的工具结果：图片可能位于 `multimodal_text.parts`，也可能位于 `metadata.aggregate_result.messages` 的 image 记录。

因此“过滤所有 role=tool”有漏生成图风险。当前 P0 对已知工具图、旧 image_asset 与 image 附件形状返回 `TOOL_IMAGE_REQUIRES_ASSET_ADAPTER`，使整次抓取不能被标为有效。后续必须把这些资源归入可见回答的图片块并下载，才能解除此保护；这次并未声称完成生成图导出。

### 3.3 图片下载不是复制一条 URL

[OwlCt 的实现](https://github.com/OwlCt/ChatGPT-Export/blob/ea52daa231c877fafce9d849b390a64fa03ca349/Tampermonkey.js) 和 Pionxzh 实现均有指针 → 下载地址 → 图片字节的过程。但两者引用的下载路由形式不同，说明下载 resolver 需要版本适配，不能将某条私有路径当成永久协议。

AI Inbox 将沿用这一成熟分层：从全部消息建立资源清单，按指针解析原图、限量并发下载和校验，传输字节，再由 Vault 生成本地嵌入。任何必要图片失败都不能提交“成功”笔记。P0 当前仅有 DOM 图在浏览器内下载/解码成功，真实图落盘与离线打开仍待完成。

### 3.4 引用和 Markdown 优先复用

[Pionxzh citations.ts](https://github.com/pionxzh/chatgpt-exporter/blob/d0f44aae9d5650852b2979bbf830590b41f7b804/src/utils/citations.ts) 提供引用标记、来源列表、Markdown 链接转义与去重；但其最后会删除残留的 citation marker。若采用，需要保留未解析引用或明确报告，不能静默失去来源。

[Defuddle ChatGPT extractor](https://github.com/kepano/defuddle/blob/ba2df0533d783aded12f5b325df97b997eeb6b43/src/extractors/chatgpt.ts) 已处理 DOM 对话结构和引用脚注。优先用现成库转换已确认完整的内容，API 原始 Markdown 则尽量直接保留。P1 用代码围栏、GFM 表格、TeX、引用、图片和多个回答片段组成黄金样本，确定最终依赖及锁定版本；不再从零写一套 HTML→Markdown 正则转换器。

## 4. 本轮已落地与暂不落地的范围

已完成：

1. `spikes/capture/paginated-messages.ts`：上游分页流程的 TypeScript 改编，保留严格失败行为。
2. `observed-request.ts`：只对已观察的当前聊天复数接口启用分页；初始 responseShape 与分页汇总分别记录。
3. `message-classification.ts`：发现已知工具图片时拒绝忽略。
4. 第七版探针：新增 pagination 的请求数、页数、是否完成、是否重读最新页；不输出游标、正文、账号或令牌。
5. 90 项自动测试通过；构建附第三方完整许可与来源说明，并检查附带文件和重复构建一致性。

未完成：真实长聊天分页、当前短聊天最终两条可见消息比对、生成图 resolver、真实图片 Vault 离线显示、正式保存功能。P0 状态仍为进行中。无需仅为了本次源码审查再次重载扩展；后续把联调步骤集中成一次可说明目的的验证。

## 5. 修订后的下一步

| 顺序 | 工作 | 可复用来源 | 通过条件 |
| --- | --- | --- | --- |
| 1 | 完成 P0 短聊天分类及长聊天分页实测 | Thierry 分页 + 现有新旧双适配器 | 已知首尾/顺序的至少 200 条消息；分支和分页中变化可靠拒绝 |
| 2 | 建立上传图、工具生成图的资源清单与 resolver | Pionxzh、OwlCt | 图片逐一匹配消息，下载后在离线测试 Vault 打开；失败不提交 |
| 3 | 收尾 P0 本机通信、编辑器保护证据 | 已有 AI Inbox 原型 | 沿用已通过项，只补未解决场景，不从头重测 |
| 4 | P1 锁定 Markdown/引用依赖与协议 | citations 模块、Defuddle、mdast 生态 | 黄金样本保真、确定性、未解析内容不静默删除、许可证随包 |
| 5 | P2～P4 正式保存与一键集成 | 保留现有保存策略和 Obsidian 核心 | 本地编辑后总是另存；properties 原文保留；图片完成后提交 |
| 6 | P5～P6 故障恢复与打包 | 现有验收与发布规范 | 全部阻断用例通过，第三方声明齐备，才准备发布 |

不直接 fork 任意一个完整产品，是因为已审查导出实现并未替我们验证“正文编辑判断、修改后另存并切换目标、properties 原文保护、编辑器竞态、图片与笔记一起完成”等产品约束。复用重点是易变的网页适配和已有转换能力；这些 AI Inbox 保存行为继续由自己的窄接口实现。

## 6. 许可与维护

改编源码记录在 `../THIRD_PARTY_NOTICES.md`，完整 MIT 原文保存在 `../third-party/` 并随两端测试包分发。AI Inbox 原创部分仍署名 elfmedy，不能将上游作者改成我们的署名。当前只纳入 Thierry 分页和 Pionxzh 工具图判定；其余仅审查参考，没有新增 npm 运行依赖或复制图标。

后续每次采用代码或依赖必须记：仓库/包、确切版本或提交、源文件、许可、修改点、回归样本。升级先比较这些文件和黄金测试结果，不把整个上游 UI、账号批量同步或配置选项一起带入。
