# Repo Fact Audit

审计日期：2026-08-26  
范围：只读核对当前代码、README、文档、测试、数据与已有运行工件；未修改论文或产品实现。

## 1. 产品目标

这是一个古诗词知识地图站点，面向读者展示诗人的“行迹、诗境、交游”；同时提供一个面向研究者/策展审核者的私有书籍分析原型，把一本文本书中的候选关系回链到原文证据。公开站点与私有分析流程目前并未自动贯通。

依据：`web/README.md`、`AGENTS.md`。

## 2. 核心流程

- 网页 `/agent`：上传 `.txt/.text/.md` → 浏览器本地切段、读取公开种子目录 → 规则抽取人物/地点/作品及三类候选 → 生成证据位置、故事卡和校验报告 → 人工逐条通过/驳回 → 下载草稿和“私有发布清单”。可选模型增强会把文本片段发送到 Worker，但输出仍要重新绑定原文证据并校验。
- Python 流程：文本或文本层 PDF → quarantine、哈希和 job → 抽取/解析/候选/校验 → `draft.json` → `--approve-all` 人工审核 → 私有 `release-manifest.json`。
- 终点是“`approved-for-curation` 私有包”，不是公共网站；缺少 `records → derived → published → web/public/data` 的发布适配器。

依据：`docs/BOOK_AGENT_PROTOTYPE.md`、`web/app/components/BookAgentWorkbench.tsx`、`web/lib/book-agent.ts`、`scripts/run_book_analysis_agent.py`。

## 3. 核心实现

- 三类公开阅读界面：`web/app/journey/`、`web/app/poem-world/`、`web/app/social/`。
- 书籍规则抽取、证据绑定、模型结果合并、草稿校验、审核状态、私有 manifest：`web/lib/book-agent.ts`。
- 可选模型 API 和 Worker 路由：`web/lib/book-agent-api.ts`、`web/worker/index.ts`。
- 审核工作台与私有三视图：`web/app/components/BookAgentWorkbench.tsx`、`web/app/components/BookAgentPrivateViews.tsx`。
- 私有 job、数据契约和校验：`scripts/run_book_analysis_agent.py`、`scripts/poet_map_job.py`、`data/contracts/`。
- 现有公开静态数据契约：`data/published/README.md`；同步只实现 `data/published → web/public/data`。

## 4. 实现状态

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| 证据绑定 | 已实现 | 可见连接/故事卡必须有 `direct` evidence；校验证据引用、文本位置、锚点。见 `web/lib/book-agent.ts` 的 `validateBookDraft`。 |
| 行迹 | 已实现（私有候选层） | 规则抽取 `journey`，并有私有地图视图；不是自动公开事实。 |
| 诗境 | 已实现（私有候选层） | `poemWorld` 候选、地点聚焦和证据展示已实现。 |
| 交游 | 已实现（私有候选层） | `social.edges`、关系图和范围校验已实现。 |
| 人工审核 | 部分实现 | 网页可逐项通过/驳回，但状态在前端草稿中；Python 命令仅支持 `--approve-all`，缺少完整持久化的逐项审核记录流。 |
| 发布流程 | 部分实现 | 可导出私有 release manifest；公共发布 exporter 尚未实现。见 `web/lib/book-agent.ts` 的 `buildReleaseManifest`。 |

## 5. 仓库已有证据

- 来源：`source-materials/source-manifest.json` 当前有 25 条来源记录（22 approved）；`data/quality-reports/source-materials-quality-review-2026-07-27.json` 对其中 10 个材料快照报告 0 失败。
- 公开数据：当前为 26 人、89 地、152 事件、44 作品、16 来源，位于 `data/published/`。
- 已保存的原型 job：`var/jobs/_agent-test2/pmj-20260825-11d9c465807c4b978918f66f5bd4ffeb/` 含 `valid=true`、0 error/1 warning、人工审核记录及私有 manifest；这证明流程工件能生成，不证明历史语义正确。
- 测试：前端有 19 个测试文件、当前源码中 65 个 `test(...)` 块；Python 有 7 个 `test_*.py`。本次未重新运行测试。
- 论文案例证据：`docs/PAPER_EVIDENCE_AUDIT_V2.md` 记录 30 条真实材料的单轮人工审计：行迹 15、诗境 8、交游 7。它是审计记录，不是可一键重放的测试夹具包。
- 还有前端交互截图：`web/test-artifacts/`。

## 6. 与 `PAPER_DRAFT_V2.md` 的差异

论文已明确承认“审核界面和公共发布适配器尚未完全贯通”（第 6.3 节），因此“未自动发布公共数据”不是隐藏矛盾。仍应注意：

- 若论文中的“人工回读后由审核者决定候选状态”被理解为完整、可追溯的审核系统，则工程仅部分完成：网页审核是前端草稿状态，Python 只有整批批准；未见逐项审核者、理由、版本追踪贯通。
- 论文附录称“61 项测试通过”，而当前 `package.json` 枚举 19 个前端测试文件，源码有 65 个顶层 `test(...)`；该数字至少需要重新运行后更新或注明版本。
- 论文的 30 条案例结果有完整文字核对记录，但未发现与每条案例一一对应的可重放输入、自动输出和运行脚本工件；可支持“单轮案例审计”，不宜表述为完全可复现实验套件。
- 工程已实现、但论文未充分展开的能力：可选 LLM 增强、失败时回退本地规则、服务端对模型 `segmentId` 和证据重新绑定、网页端逐项审核 UI、私有三视图交互展示。这些能力存在，但论文不应把它们当作已验证的语义效果。

## 接手者最需要知道的项目事实

- 产品有公共阅读站与私有书籍分析原型两层，二者未自动打通。
- 自动输出始终应被视为待审核候选，不是史实。
- 三卷都已能生成和展示私有候选，但抽取质量有限。
- 每个可见候选被设计为可回到原文片段，而结构校验不等于语义正确。
- 人工审核可操作，但其逐项持久化审计链尚不完整。
- “发布”目前只是私有策展清单；公共发布适配器缺失。
- 公开数据是冻结种子，不能由上传 job 直接改写。
- 30 条真实材料是目的性、单人单轮案例审计，不能外推为总体准确率。
- 现有 job、质量报告和测试主要证明流程/契约可运行，不证明历史关系已经考定。
