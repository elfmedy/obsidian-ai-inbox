# P0 技术验证记录

日期：2026-09-12。状态：**真实短聊天抓取、单张上传图落盘与用户离线显示确认通过；P0 全部阶段门槛尚未通过。**

## 已实施

- `spikes/capture`：纯数据解析 React Router hydration、聊天身份校验、当前分支父子链校验、未知/不完整结构拒绝。
- `spikes/assets`：图片来源限制、实际字节上限、格式头识别、已观察的 citation favicon 过滤。
- `spikes/persistence`：本地修改优先的保存决策、frontmatter 原文分离、完整文件比较后才替换正文、Windows 文件命名。
- `spikes/transport`：仅绑定 127.0.0.1、令牌和 Vault 身份校验、报告字段白名单、请求限额、图片 fixture 往返。
- `spikes/extension`：可加载 MV3 原型、一次连接、当前页面探针与结果上报。
- `spikes/obsidian`：只接受专用测试 Vault 标记，使用实际 Vault 和编辑器 API 输出独立结果文件，卸载关闭服务。

它们是实验代码，不等于 P1～P6 已经完成。尚未实现正式 Markdown 渲染、真实聊天提交、稳定笔记索引、新目标跟踪、图片暂存提交、崩溃恢复和最终一键保存体验。

## 已有证据

| 项目 | 结果与边界 |
| --- | --- |
| 自动检查 | `npm run check` 通过：官方 Obsidian lint 0 警告、TS strict、113 项测试、两端构建、版本一致、第三方许可附带与重复构建字节相同 |
| 第七版真实短聊天 | API 200；18 条记录解析为 2 条可见消息、过滤 16 条已识别内部记录；coverage=complete、validated=true、chainMatchesVisible=true；单张内容图下载/解码 1/1，失败 0。pagination=null，未验证多页；没有导出正文供逐字保真比对 |
| 长聊天结构 | 200 条**合成**消息的链/分支校验通过；不是 200 条真实网页验收 |
| 保存决策 | 来源未变、本地正文已改仍 fork；来源变化、本地未改才 update；属性原文保留和空 frontmatter 回归通过 |
| 本机通信 | Buffer 修复后，Chrome 完成探针并上报到真实 Vault；落盘合成图片 70 字节且摘要相同。worker 重启/端口故障场景仍待测 |
| 图片 fixture | PNG chunk CRC 与实际像素解压校验通过；格式头测试不再被当作图片解码证明 |
| 测试聊天 DOM | 内置浏览器曾读到 1 条用户消息、1 条助手消息，含 1 张上传截图；助手回复另外含 12 个引用网站 favicon |
| 图片来源 | 上传截图 DOM 使用当前 ChatGPT 域的 `/backend-api/estuary/content` 签名资源，观测尺寸 1179×2556；Chrome 实测 1 张内容图下载并解码成功。尚未证明原图一致性及真实图片落盘 |
| hydration 新鲜度 | 首次页面脚本中有 graph，但身份与当前测试聊天不匹配。不能拿旧图谱证明当前聊天完整；现有身份过滤会拒绝 |
| 刷新结果 | 内置浏览器刷新后返回首页，再打开目标地址仍未恢复聊天；原因未确定。需通过已登录 Chrome 的真实扩展继续验证 |
| 桌面环境 | Chrome 152.0.7977.84；Obsidian CLI 报告 1.13.7（installer 1.12.7）；Node 24.19.0 用于最新检查 |
| 测试 Vault | 已实际打开并启用插件，取得 Vault 和 editor 报告；属性/注释保留、写前竞争拒绝、未保存编辑另存保护均通过本轮样例 |

真实聊天正文、页面快照、签名 URL、令牌均不进入版本控制。仓库只保存合成夹具和上述计数/结构结论。

## P0 任务状态

| 任务 | 状态 |
| --- | --- |
| P0-01 测试环境 | Chrome 扩展与独立 Vault 已实际加载 |
| P0-02 完整抓取 | 进行中；当前 API 数组路线在真实短聊天通过结构/身份/页面顺序与末尾匹配；真实长聊天分页、分支及变化场景待测 |
| P0-03 图片本地化 | 第八版真实上传图 682,057 字节已落盘、摘要回读一致，本地解码 1179×2556 通过，用户确认断网重开正常；上传原文件摘要、生成图/完整图片清单仍待验 |
| P0-04 MV3 本机通信 | Chrome→真实插件的报告和合成图片链路通过；worker 重启及故障场景待测 |
| P0-05 编辑保护 | 真实 Vault/editor 样例通过；包括 disk 与 buffer 不同时保护编辑并另存，同时输入的完整竞争矩阵仍待测 |
| P0-06 结论与修订 | 已记录开源复用与短聊天实测成功；正式开发重估仍待长聊天和完整图片链路证据 |

## 2026-09-12 首轮实机结果与修复

用户首轮运行 `run-1789176128418-3ea3b7`：`vault-results.json` 的 propertiesPreserved、raceRejected、userEditPreserved、localEditedSourceSameForks、imageRoundtrip 全为 true。`Editor-1789176290301-results.json` 记录 diskDifferedFromEditorAtRead=true、action=forked、bufferPreserved=true、newFileContainsSource=true，证明该样例确实覆盖了尚未落盘的编辑。

浏览器显示通用“验证未完成”提示，未生成 browser 报告。现场发现 `transport-fixture.png` 为 8192 字节而预期为 70 字节；使用 `scripts/verify-p0-runtime.mjs` 重现：hello=200、upload=400、digestMatches=false。

根因：HTTP 接收层返回 Node Buffer，而 `Buffer.slice().buffer` 指向整个底层内存池，不能当作图片的精确字节区间。现已使用 `ownedArrayBuffer` 分配并复制可见范围，再交给 `Vault.createBinary`；回归测试覆盖大内存池中的子视图，并验证副本不随原视图修改。

修复已构建、复制并通过官方 CLI 重载到测试 Vault。新运行 `run-1789176510724-00cf51` 中，Node HTTP 实测返回 hello=200、upload=200，落盘 70 字节且摘要匹配；Obsidian 自身 `Image.decode()` 读取 Vault 本地资源成功（1×1）。Vault/editor 样例重跑同样通过。测试数据来自合成 fixture，不能据此宣称 ChatGPT 真实图片离线验收完成。

扩展现在先上报聊天计数，再验证合成图片，避免图片失败掩盖已有抓取结果；失败提示附具体步骤。Chrome 需要在扩展管理页点“重新加载”，使用 Obsidian 新 run 的连接信息重新连接并点击验证。旧轮结果保留；任何报告数量都不等于阶段完成。

## 2026-09-12 Chrome 重试：图片可取，完整聊天未取到

09:31:59 的 `browser-1789176719441-2f9d0b.json` 已在测试 Vault 中收到，与用户提供的输出一致：visibleMessages=2，imageElements=1，downloadedImages=1，decodedImages=1，failedImages=0；graphCandidates=0，verifiedGraphs=0，capturedMessages=0，chainMatchesVisible=false。

结论：登录态下当前已渲染上传图的下载/解码和报告上报成功。图谱候选为 0 的原因尚不确定，不能直接推断是权限问题或聊天为空；也不能用两条可见消息替代完整抓取。真实图片仍只在浏览器内验证，Vault 中的图片是合成 fixture。

已构建第二版页面探针（`diagnostics.probeVersion=2`）：比较现有 DOM 脚本与使用当前会话重新 GET **当前聊天原地址** 得到的 HTML。请求不使用缓存、不跟随重定向，限制 15 秒/20 MiB，拒绝不同地址、非 HTML 与失败状态；解析后的文档不插入页面，返回脚本不执行。当前页面不会被导航或刷新，扩展不增加权限。

诊断只输出脚本/JSON/流分块/图谱数量及是否匹配当前身份，不输出正文、聊天 ID、Cookie 或签名 URL。它能区分没有结构化数据、已有其他聊天的图谱、解码分块失败等情况。完整图谱仍必须通过现有分支和消息身份校验；新读取为空时不以旧图谱掩盖问题。

本次仅需 Chrome 重新加载扩展后再验证，Obsidian 插件和连接令牌不变。新的 `diagnostics` 暂存于扩展并显示在结果中；兼容现有接收端的 Vault 报告仍只包含原有 metrics。该取数路线尚待实机结果验证，不能把新增请求视为已修复完整抓取。

## 第二版实测与第三版数据请求探针

用户反馈第二版：freshRequest=completed；loaded 与 fresh 均为 enqueueCalls=2、parsedDocuments=2、rejectedChunks=1、graphObjects=0、scriptsMentionCurrentNode=false，且均提到当前聊天 ID。图片仍为下载/解码各 1、失败 0。

这证明当前 HTML 读取本身成功，但此 HTML 路线没有提供本探针要求的当前分支图谱。`mapping` 字符串可能属于页面配置，不能作为消息数据证据；一个未支持的流分块也不能在没有原始结构证据时认定为丢失图谱的唯一原因。

第三版 `diagnostics.probeVersion=3` 已实现：HTML 无图谱时，检查 Resource Timing 中页面已发起的 fetch/XHR，只匹配同源、无查询参数且路径身份精确属于当前聊天的 conversation 请求。没有观察到或存在多个不同候选时明确失败，不构造新接口地址，不读取其他聊天。

读取使用既有同源会话。若页面 JSON 已含规范 session 对象，其令牌仅在内存中用于已观察的当前聊天地址；无令牌且遇到 401 时，仅当页面还实际请求过同源 session 地址才读取它并重试一次。不跟随重定向，不把凭据放入日志、诊断、Vault 或扩展持久化存储。

第三版输出 request 的候选计数、HTTP 状态、鉴权来源枚举、图谱数量与固定错误码；graphShapes 只输出允许名单内的角色/通道/内容类型计数。返回的数据仍走身份、分支和可见消息末尾校验，未知消息结构继续拒绝。新增测试验证不猜地址、不越过当前聊天、凭据输出隔离、401 流程和重定向拒绝。60 项自动测试及全部构建检查通过；真实请求可用性尚未验证。

本次仍只需 Chrome 重载扩展再点验证，Obsidian 连接不变。若 Resource Timing 中没有候选请求，需进一步取得实际页面取数证据；不能把未观察到的请求当作权限失败或放宽成全域抓取。

## 第三版实测：尚未进入 API 读取

第三版用户结果：resourceEntries=190、conversationRequests=0、sessionRequestObserved=false、attempted=false、httpStatus=null；HTML 仍无图谱，图片下载和解码保持成功。Vault 在 2026-09-12 01:43:47 UTC 收到同轮 metrics。

含义：当前失败发生在请求发现/匹配阶段，不能认定 API 返回了 401、403 或空聊天，因为请求根本没有发出。现有匹配器限定 fetch/XHR、同源、两种固定路径、无查询参数；任意条件不匹配都会得到同一个结果。Resource Timing 也不等于完整的 DevTools 网络记录。

下一步改为取得实际 Network 请求路径及查询参数名，再决定如何修改匹配器。本轮不继续要求用户重复同一个探针，也不因这个结果扩大抓取范围或请求未验证的接口。需要的证据只是当前聊天请求的路径与参数名，不需要请求头、Cookie、Authorization 或 HAR。

## Network 实证与第四版匹配修复

用户截图确认，当前聊天加载时实际发起两个 GET、均返回 200：

- `/backend-api/conversations/{当前聊天ID}?include_has_versions=true&num_turns=10`
- `/backend-api/conversation/{当前聊天ID}/textdocs`

第一条的复数 `conversations` 和查询参数均不在第三版匹配规则内，这解释了为何 DevTools 存在请求而探针没有候选。第二条属于独立的 textdocs 资源路径，不当作聊天正文接口。截图没有提供正文响应结构，因此仍不能证明第一条返回全量消息。

第四版已按实际地址识别复数路径，参数只接受已观察的 `include_has_versions` 与 `num_turns`，沿用实际 URL，不删除或擅自增大轮数限制；仍要求该 URL 出现在当前页面的实际 fetch/XHR 记录中，拒绝其他聊天、未知参数和重复参数。

`diagnostics.request` 新增 requestedTurnLimit 与 responseShape。后者仅包含允许名单内的字段名、类型、集合数量、布尔/数字分页信号，省略正文、标题、ID、游标值和未知字段名。若返回 has_more 等明确不完整信号，即使发现结构化图谱也拒绝采用；`num_turns` 存在时始终附完整性待验证提示。字段诊断用于建立实际适配器，不等于已经实现分页。

64 项自动测试通过，覆盖截图所示请求、textdocs 排除、查询参数验证、分页拒绝和诊断脱敏。探针版本为 4，已重新构建 Chrome 产物；Obsidian 插件未改动，不需重新连接。下一次真实结果应首先验证 attempted/httpStatus/responseShape，再据实实现全量消息适配。

## 第四版实测：鉴权与读取通过，新接口使用消息数组

用户第四版结果：attempted=true、authSource=page-session、conversationRequests=1、httpStatus=200。响应根包含 conversation_id、current_node、messages（18 条）、page_info（4 个尚未识别字段），没有 mapping。浏览器仍显示 2 条消息，图片下载/解码为 1/1。

这已证明当前请求匹配、同源会话鉴权和 JSON 读取可用。`CURRENT_CHAT_API_NO_GRAPH` 来自旧 mapping 解析预期，不是服务端读取失败。`explicitlyPartial=false` 只表示此前允许名单未发现明确分页信号，不能在 page_info 的 4 个字段均未知时推断没有分页。

已独立实现并测试 `inspectMessageList`：检查准确聊天身份、消息 ID 唯一性、current_node 位于数组末尾，复用旧图谱的内容解析规则但不制造父子关系；未知分页或明确有更多页面时不返回可用消息。数组顺序、内部消息类型和分页语义仍需实测，不能用合成测试替代。`summarizeMessageShapes` 已可统计数组中的角色/通道/内容类型及隐藏标记。

本轮先等待用户提供实际 page_info 四个字段及脱敏值，再接入分页判定与页面探针。浏览器入口暂保留第四版，用户无需为本次辅助模块测试再次重载。69 项自动测试和完整工程检查通过。

## 第五版：已确认的 page_info 与数组适配

用户补充截图确认 page_info 为 start_cursor、end_cursor、has_previous_page、has_next_page；当前样例两个布尔值均为 false，end_cursor 与 current_node 相同。游标实际值不记录进仓库。

第五版已接入：要求两个分页布尔值为 false，start_cursor 对应数组第一条消息 ID，end_cursor 对应最后一条消息 ID 且与 current_node 相同，再检查全部消息 ID 唯一、当前聊天身份与消息内容类型。任何未知分页字段、边界不符、消息类型未支持或明确存在更多页均拒绝采用；不把数组转换成伪造的父子节点链。

响应数组中系统、工具、analysis 通道及明确隐藏的消息沿用原规则过滤；其他未支持内容保留固定错误码，不悄悄忽略。实际 18 条记录中各类型数量还需下一次探针验证，不能提前认定其中 16 条都可忽略。

`diagnostics.request.messageArray` 显示 coverage、identityMatches、uniqueIds、currentNodeAtEnd、recognizedVisibleMessages、ignoredInternalMessages、validated、issues 和脱敏类型计数。校验通过后数组驱动 capturedMessages 与可见消息 ID/顺序/末尾匹配。graphCandidates/verifiedGraphs 仍专指旧 mapping 路线，数组路线下为 0 不等于失败。full P0 仍需长聊天、分页、多图等实测。

72 项自动测试和完整检查通过；第五版 Chrome 产物已构建，Obsidian 插件不变。长聊天翻页请求尚未实现，有前页时会明确报部分响应，不能进入正式全量保存阶段。

## 第五版实测与第六版消息分类

用户粘贴结果已读取：coverage=complete、identityMatches=true、uniqueIds=true、currentNodeAtEnd=true，当前数组的分页与身份边界检查通过。18 条记录包含 system=1、tool=6、user=1、assistant=10；内容类型为 text=13、multimodal_text=1、model_editable_context=1、thoughts=2、reasoning_recap=1。旧内容规则忽略 7 条、解析 7 条、拒绝 4 条，故 validated=false、capturedMessages=0；图片下载/解码仍为 1/1。

第六版根据这些已观察的内部类型补充分类：仅对 assistant 的 model_editable_context、thoughts、reasoning_recap 排除内部记录，用户同名文本不受影响。对于 assistant 工具调用，检查 recipient 能否对应当前响应中 role=tool 的 author.name（精确名称或工具命名空间）；仅有工具接收方证据才排除，未知接收方拒绝。正文来源链接与普通 Markdown 文本继续原样保留。

`messageArray.ignoredReasons` 新增固定类别计数，`shape.recipients` 只输出 absent/all/tool/unverified 分类，不输出工具名称、正文或 ID。此前 7 条已识别消息可能混有工具调用文本，不能仅因去除四条未知内部类型就声称拿到了正确的两条对话。

新增合成样本复现同样的 18 条角色/内容类型计数，配备合成工具路由后校验得到 2 条对话、16 条内部记录，并验证未知可见内容、未知接收方和未完成回复仍失败。合成工具路由不代表真实 recipient 字段已确认；实际结果仍需第六版探针验证。76 项测试及完整工程检查通过，Chrome 产物已构建，Obsidian 连接不变。

## 取数路线修订

hydration 目前只是候选数据源。即使含完整 mapping，也必须确认聊天 ID、分支、首尾及最新消息与页面一致；同一 ID 下的过时图谱也不能仅凭 ID 通过。页面中没有证据时应明确失败，不能退回只保存 DOM 可见的几条消息并报告成功。

现阶段优先验证已确认可读取的新 API 消息数组，不继续把取得 hydration 图谱作为前置条件。首次加载与站内导航、长聊天与分支仍需覆盖，但取数细节先查阅开源实现再补适配。不得把未经真实样本验证的私有接口语义当作已通过验收。

图片原型只过滤已确认的 UI favicon，不用“小尺寸”或“无 alt”推断可以忽略。正式版本必须从完整消息建立图片清单，解决所有资源后再提交；当前最多 10 张 DOM 图片的探针不满足此要求。

## 第七版：开源源码审查与分页改编

用户提出优先参考现有开源 exporter 后，已审查六个仓库，证据与选择见 `open-source-review.md`。其中 ThierryAbalea/chatgpt-conversation-export 的 2026-09-06 提交 `543a98a3f6cfb0f59ad23cd1c0b6d070f4e98324` 已使用当前复数接口、messages/page_info 与 before 游标，是本轮直接采用的分页依据。

新增 `paginated-messages.ts`，保留已观察的每页轮数，对同一聊天向前读取直至没有前页。检查身份、唯一 ID、首尾游标、分支/revision、相同重叠和进度；失败不返回部分结果。最多 100 页、20,000 条记录、累计 JSON 24 Mi 字符；60 秒后不再启动下一次前页请求，单请求另有 15 秒/20 MiB 限制，这不是整次探针 60 秒硬超时保证。多页完成后重读最新页，发现变化则拒绝。合并 envelope 的首尾证据来自最早页与初始最新页，不把所有分页标志无条件改为 false。

`diagnostics.request.responseShape` 保留初始响应的形状，pagination 单独报告额外请求数、完成页数、完成状态与最新页复核。分页中途失败时 pages 仍可能为初始值，应以 completed=false 和错误码为准；失败诊断不包含游标、消息或请求头。

Pionxzh exporter 显示工具结果可能承载图片。当前解析器已对已知工具图形状报 `TOOL_IMAGE_REQUIRES_ASSET_ADAPTER`，替代原先静默忽略；正式工具图图片块归并、下载与落盘仍待开发。未知工具结构的完整支持不在本次保证范围。

90 项自动测试通过，含两页 200 条消息、三页与边界重叠、首尾异常、重复/冲突页、会话/分支/revision 变化、最新页正文变化、请求失败、页数上限及工具图保护。完整 lint、类型检查、两端打包、第三方许可附带检查和重复构建检查均通过。第三方许可与改动已记录，原型版本为 7。

此轮没有新增真实浏览器证据：前页 current_node/update_time 的行为、分页连续性、至少 200 条真实消息、生成图和真实图离线 Vault 显示仍需实测。P0 不标记完成，也不要求用户为了源码研究反复执行单步探针。下一次集中联调验证短聊天分类与长聊天分页，再进入图片原图链路。

## 第七版实测：当前短聊天抓取通过

用户提交第七版完整诊断：probeVersion=7、selectedSource=observed-request、HTTP 200、request.error=null。messageArray.coverage=complete、identityMatches/uniqueIds/currentNodeAtEnd/validated 均为 true，issues 为空。18 条记录识别出 2 条可见消息，排除 system=1、model-context=1、reasoning=3、tool-call=5、tool-result=6；这些类型及工具路由本次有真实诊断佐证。

metrics 为 capturedMessages=2、visibleMessages=2、chainMatchesVisible=true、imageElements=1、downloadedImages=1、decodedImages=1、failedImages=0。这说明当前一问一答样本的结构抓取、页面 ID 顺序及末尾一致性、单图浏览器下载和解码检查通过。未导出真实正文，因此不把计数和 ID 匹配等同于逐字渲染保真已通过。

分页两个标志均为 false，pagination=null：短样本不需要翻页，不能证明新增 before 分页已实测通过。graphCandidates/verifiedGraphs 为 0 是数组路线的正常结果。顶层唯一 issue 为 LIVE_FRESHNESS_AND_FULL_HISTORY_REQUIRE_MANUAL_VALIDATION，是探针固定附加的整体验证提醒，不是这次样本失败。

本样本不再重复验证。下一步覆盖真实长聊天分页和生成图/真实图片 Vault 离线显示；当前仍不具备正式保存聊天笔记功能，P0 阶段门槛保持未完成。以上仅记录用户报告的结构与计数，不复制正文、身份、游标、资源 URL 或凭据。

## 第八版：图片传输与 UI 结论接入

用户明确暂无长聊天，先验证图片；长聊天分页作为未完成验收保留，不以合成样本替代。UI 参考任务 01a0934e-d229-7b42-9a5b-de2905d9e05a 的最终固定图标方案已读取，主设计和新增 interaction-design.md 已同步：正式 toolbar action 直接执行、单卡反馈、图标不承载上次结果、中英文设置、默认网页右键保存、快捷键默认空。P0 暂保留测试弹窗，新增人可读摘要、独立本地预览路径和复制诊断，避免只给 JSON 让用户猜成功。

图片路线继续参考 Pionxzh 的“下载实际图片字节”和 OwlCt 的“落本地资源并替换图片路径”分层；本轮没有复制新的上游源码或引入依赖。现有 DOM 图片下载已在真实账号通过，先把这些字节接到 Vault。指针 resolver、工具图归并、完整历史图片清单仍按 open-source-review.md 的来源继续适配，没有改成仅 DOM 就算完整保存。

Chrome 官方 messaging 文档说明消息使用 JSON 序列化（https://developer.chrome.com/docs/extensions/develop/concepts/messaging）。第八版从扩展 isolated world 图片缓存读取 64 KiB base64 块，后台重新组装并校验 SHA-256；不把本机令牌传给网页，不把图片字节/签名 URL 写进扩展持久化报告。缓存核对本次随机 captureId 和页面 URL，转移完成/失败后清理，另设五分钟回收；worker 重启自动恢复仍不在本轮保证内。

新增固定 POST /v1/content-image，绑定原有令牌和 Vault，检查大小、实际格式头、SHA-256 后串行写入。插件内部生成 content-images/<摘要> 路径，回读原字节相同才确认；重复上传不覆盖已存在文件，已有图片改过则拒绝。生成本地 Markdown 预览和回读报告，不导出聊天正文。多个测试图片中途上传失败可能留下前面已验证的文件，不声称原子完成整批。

97 项自动测试通过：新增真实 loopback 图片接收、拒绝无鉴权/错误摘要/HTML、跨多块字节恢复、切换页面拒绝、损坏缓存拒绝、接收确认校验与摘要文案区分。完整 lint/类型/构建/许可与重复构建检查通过。

2026-09-12 02:49 UTC，已更新专用测试 Vault 插件并重载，run-1789181330973-f591e9。scripts/verify-p0-content-image.mjs 使用合成 fixture 调用真实新接口：HTTP 200、70 字节读写相同、重复上传 200 且文件 mtime 不变、生成本地预览。随后 Obsidian eval 经 Vault resourcePath 调用 Image.decode 成功，尺寸 1×1；这是本地合成图片显示证据，不是 Chrome 真实聊天图片或断网实测。令牌随重载已更新，用户需按 p0-testing.md 当前步骤重新连接一次。

真实图片最终验收待用户第八版结果：imageTransfer.status=complete、stored=offered=1，并在 Obsidian 打开预览，断网关闭重开仍显示。即使这些通过，也不能替代上传原文件摘要比对、生成图、多图和屏幕外全量图片验收。

## 第八版实测：真实上传图已落盘并可在 Obsidian 解码

用户提交的第八版诊断显示：request.error=null、messageArray.validated=true、coverage=complete，2 条消息与页面匹配。图片下载/解码各 1 张，失败 0；imageTransfer.offered=stored=1、status=complete，已返回本地预览路径。本样本没有触发分页。

已独立读取测试 Vault 文件并计算 SHA-256，与浏览器接收记录一致；PNG 实际大小 682,057 字节。真实 Obsidian 通过 Vault 本地资源地址 Image.decode 成功，尺寸 1179×2556，并已打开对应预览。预览只有本地图片嵌入，不含远程图片链接。显示验证另存于该图片旁的 -display-check.json；原接收报告保留不改。

结论：当前上传图的 Chrome 下载 → 字节传输 → Vault 写入/回读 → Obsidian 本地解码链路通过。没有实际切断网络，因此断网关闭重开预览的手工检查仍待用户反馈；原上传文件的摘要一致性、生成图和完整历史图片清单也未因此通过。无需重跑这次传输，不标记 P0 全部完成。

## 离线显示确认与独立内容转换开发

用户在断网重开预览检查后回复“图片正常”，已将本张真实上传图的离线显示记为用户确认通过；另外写入 -offline-check.json，保留原始自动报告不改。用户明确暂无生成图样本，要求先推进其他开发；长聊天和生成图的实测仍保留。

按此调整，独立完成候选图片解析/resolver 和正文转换核心，详见 content-rendering.md。复用两个 MIT exporter 的图片提取和下载路由，并引入五个精确锁定的 CommonMark/GFM/TeX 解析库，按语法树位置替换已本地化的图片。图片清单覆盖全部输入消息，代码/公式中的图片示例不会误下载。缺失图片、未适配引用标记和 HTML 明确失败。

候选工具图解析只有测试显式启用，P0 默认仍保留 TOOL_IMAGE_REQUIRES_ASSET_ADAPTER；新 resolver 和 renderer 尚未接入浏览器入口，因此不能声称生成图或整段聊天保存已经成功。没有重载测试插件，不要求用户重复验证或重新连接。

113 项测试、lint、类型检查、两端构建、许可打包和重复构建全部通过。新依赖完整许可证自动生成，新增 OwlCt 版权记录。P1-03 仅为可独立推进部分，不代表 P0/P1 整阶段完成。下一步按上游引用转换实现补齐 citations，再将确定性正文接入现有受保护的保存流程。
