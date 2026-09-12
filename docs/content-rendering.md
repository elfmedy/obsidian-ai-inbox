# 内容转换核心：当前实现与边界

2026-09-12。用户确认上传图离线显示正常，并在没有生成图/长聊天样本时要求先推进其他开发。内容核心现已接入独立 Alpha 保存链路；原 P0 扩展继续只用于诊断，缺失的真实验收门槛未被标为通过。

## 已实现

- `spikes/render/markdown.ts`：采用 [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown)、[GFM](https://github.com/syntax-tree/mdast-util-gfm) 和 [TeX 扩展](https://github.com/syntax-tree/mdast-util-math) 确定语法节点位置。只对必要位置做替换，不将整棵树重新序列化。代码块/行内代码、公式、列表缩进、表格、空格及换行由原文保留。
- 普通正文里的 `[[...]]` 转为字面文本，避免意外引用本地笔记；代码和公式里的同样字符串不改动。
- 行内 Markdown 图片和引用式图片通过语法树解析，必须映射到已验证的本地资源；资源缺失或路径不合法则拒绝生成正文，不输出仅带远程图片的成功结果。
- `spikes/render/conversation.ts`：生成确定性正文、保留用户/助手顺序、来源链接与图片嵌入。标题转义且限制来源为普通 ChatGPT 聊天；不产生时间戳，不写文件，不修改 properties。
- `imageManifest` 从全部传入消息建立去重资源清单，包含图片 part 和 Markdown 图片引用，保留每个资源的消息归属。代码/公式中的图片示例不进入下载清单。不会依赖当前 DOM 是否渲染该消息。
- `spikes/capture/image-parts.ts`：据已锁定 Pionxzh/OwlCt 实现识别平铺/嵌套图片、图片附件和 aggregate_result 的工具图片。P0 默认仍拒绝工具图，候选解析器由测试显式启用，等待真实生成图的可见归属验证。
- `spikes/assets/chatgpt-image.ts`：按这两个上游的下载路由，解析图片指针再下载图片字节。只在 404/405 时尝试第二条路由，401/403/429 不切换；鉴权只发给同源 resolver，不发给签名 CDN；有 JSON/图片大小限制、地址校验和重定向拒绝。该模块没有接入当前 P0 网页入口，没有因此新增真实网络访问。

## 尚未完成

已接入 Pionxzh `citations.ts`，并对照 OwlCt 引用转换：已识别引用转为可点击来源，代码和 TeX 中的标记不改写。0.1.3 补回 U+E203/U+E204 规范化；残留引用/富标记以「未解析」标签和 Unicode 转义的原始字面文本保留，不猜测 URL，不静默删除。不能还原链接或富组件的限制在笔记原位置明确显示。绕过引用适配器直接给底层 Markdown 渲染器传入标记仍会被拒绝。HTML 内容返回 `HTML_CONTENT_REQUIRES_ADAPTER`。已实现图片 alt 保留、非图片附件名称/稳定 ID 说明、Zod 输入 Schema；没有宣称所有富内容类型均已支持。

函数输入是已校验消息与已验证图片的映射；调用者仍需提供真实分页完整性、资源落盘证明和来源新鲜度。纯渲染成功不等于来源完整或保存成功。

Alpha 已接入 Markdown 写入、索引/目标切换、完整图片提交及 UI。本地编辑后另存、properties 原文保留、请求幂等和提交恢复由独立 Writer 处理。图片引用在进入 IndexedDB 前规范化为摘要地址，引用式图片的原签名地址定义同步移除。

## 验证与依赖

当前总计 162 项测试通过；另有打包浏览器与真实 Obsidian 的受控运行报告。包括 Markdown 字节保留、引用、alt、附件说明、代码与 TeX 不误改、跨消息资源去重、缺图拒绝、确定性正文、图片 resolver、凭据隔离和保存恢复。

解析库与 Zod 精确版本锁定在 package.json，完整依赖树在 package-lock.json。第三方来源见 THIRD_PARTY_NOTICES.md；构建生成非开发依赖的完整许可文本并随包附带，未找到许可证即失败。Alpha 使用独立插件 ID、连接和构建目录，不覆盖原 P0 测试记录。
