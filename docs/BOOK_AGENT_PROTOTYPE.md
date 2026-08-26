# 书籍 Agent 半成品

这版把“上传一本书后自动整理三卷候选”的第一条闭环跑起来，但仍然把上传内容锁在私有 job 中：

```text
上传
→ quarantine + SHA-256
→ 文本 / PDF 文本层抽取
→ 文本片段
→ 人物 / 地点 / 作品候选
→ 行迹 / 诗境 / 交游连接
→ storyCards + evidenceIds + anchorRefs
→ 自动校验
→ draft.json
→ 人工审核
→ approved-draft.json
→ private release-manifest.json
```

## 两个入口

### 网页端

打开 `/agent`，选择 `.txt`、`.text` 或 `.md`，补充书名和中心人物后开始分析。

- 默认使用浏览器内的本地规则基线，原文不上传到服务端；
- 如果环境配置了大模型 API key，页面会显示“可选增强”。单独勾选并同意后，文本才会发送到 Worker 服务端；
- 大模型使用结构化 JSON 只返回候选实体、三卷连接和故事摘要；服务端会重新绑定原文片段，生成 `evidenceIds` / `anchorRefs`，再调用同一套自动校验；
- 模型调用失败时会回退本地规则分析，并在结果页标明“本地规则回退”；
- 结果页展示人物、地点、作品、行迹、诗境、交游和共享故事卡；
- 每张候选卡可以单独“通过 / 驳回”，也可以全部通过；
- “下载 draft + 校验报告”导出两个 JSON；
- “审核通过并生成发布包”只导出私有 release manifest，不改写 `web/public/data/`。

网页端使用 `web/lib/book-agent.ts` 的规则抽取器，匹配现有 `data/published/` 对应的前端种子目录；大模型增强由 `web/lib/book-agent-api.ts` 和 Worker `/api/agent/analyze` 提供，模型输出永远不能绕过证据校验和人工审核。

#### 配置大模型

本地开发时复制 `web/.dev.vars.example` 为 `web/.dev.vars`，配置一个服务商的 key。当前原型优先支持 DeepSeek；也支持 OpenAI Responses API 或 OpenAI-compatible Chat Completions。key 只由 Worker 读取，不会进入浏览器 bundle。

启用模型后，流程仍然是：

```text
本地切分 / 目录匹配
→ 模型窗口抽取候选
→ 服务端核验 segmentIds
→ 合并本地与模型候选
→ 重新生成 evidenceIds / anchorRefs
→ 自动校验
→ 人工审核
```

模型增强的当前限制：每个模型窗口最多约 7,500 字符，单次最多处理 32 个窗口；超长书籍会在结果中显示处理范围提醒。未知实体可以保留为 candidate，但不会自动上图或发布。

### 本地 Python agent

Python 入口可以处理现有基线支持的文本和文本层 PDF：

```powershell
python scripts/run_book_analysis_agent.py run `
  --input C:\uploads\dongpo.txt `
  --book-title "东坡全集" `
  --poet-id su-shi `
  --poet-name 苏轼 `
  --data-processing-consent
```

它会返回 `jobPath`、`draftPath` 和 `validationPath`。候选草稿在：

```text
var/jobs/<job-id>/08-map/draft.json
```

校验：

```powershell
python scripts/validate_book_analysis_agent.py `
  --draft var/jobs/<job-id>/08-map/draft.json `
  --job var/jobs/<job-id>/job.json `
  --json
```

人工审核（原型先提供“全部通过”命令）：

```powershell
python scripts/run_book_analysis_agent.py review `
  --job var/jobs/<job-id>/job.json `
  --reviewer your-name `
  --approve-all `
  --notes "已回读候选证据"
```

审核不会覆盖原始 `draft.json`，而会追加两个不可变工件：

```text
07-review/human-review.json
08-map/approved-draft.json
```

生成私有发布清单：

```powershell
python scripts/run_book_analysis_agent.py publish `
  --job var/jobs/<job-id>/job.json `
  --actor your-name `
  --notes "通过人工审核，提交整理"
```

输出：

```text
var/jobs/<job-id>/09-release/release-manifest.json
```

当前状态会停在 `approved-for-curation`，还不会把用户上传内容写入 `data/records/`、`data/derived/`、`data/published/` 或 `web/public/data/`。

## draft 结构

原型 draft 使用 `data/contracts/book-analysis-draft.schema.json`，以现有 `private-poet-volume-bundle` 为外壳，采用设计文档中下一版共享模型：

- `entities.people / places / works`：候选实体；
- `evidence[]`：`sourceFileId + locator + support + excerptSha256 + createdByJobId`；
- `storyCards[]`：`claimType + anchorRefs[] + evidenceIds[]`，明确标记不是独立历史事实；
- `volumes.journey.items[]`：人—地—时间；
- `volumes.poemWorld.items[]`：诗—地—语义，并由 `spotlights[]` 索引地点故事；
- `volumes.social.edges[]`：人—人—往来；
- 每个可见连接和故事卡至少绑定一条 `direct` evidence；
- 关系卡不能创造关系边，作品地点不能反向创造行迹。

## 当前明确的半成品边界

- 不启用模型时不调用外部模型、网页搜索或 OCR；启用模型时也不会调用网页搜索或 OCR，未知实体不会被自动提升为公开事实；
- 网页端暂不直接读取 PDF；PDF 请先走 Python 入口；
- 作品识别优先匹配现有目录，书名号抽出的未匹配标题只标为 `extracted-title`；
- 年号会保留原文，无法安全换算时使用 `unknown` 或 `sequence-only`；
- “发布”目前只生成私有 curation manifest，真正的 `records → derived → public` exporter 仍需单独实现；
- 关系审核命令行目前只有 `--approve-all`，网页端可逐条通过或驳回。
