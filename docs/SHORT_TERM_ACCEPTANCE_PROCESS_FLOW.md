# 项目处理工程流（短期验收简述）

> **验收定位**：本项目以“证据优先”的古诗词知识地图为目标。地图、网页 JSON 和专题页面均为事实记录的派生产物；模型结果、OCR、网页检索结果或作品题名匹配只能作为候选或证据线索，不能直接成为公开历史事实。

## 1. 总体流程

```text
受治理的原始资料（source-materials / cbdb / chinese-poetry）
                         │
用户上传 ──> 私有隔离区 ──> 独立 job ──> 证据与断言候选 ──> 私有地图草图

（全局发布目标链，非本次自动化验收项）
候选经审核／策略批准 → 事实记录（data/records）→ 版本化 release（data/derived）
                                      ↓
                  旧版五表契约（data/published）→ 前端静态数据（web/public/data）→ 网站
```

流程分为两条线：

- **用户作业线**：处理单次上传并生成私有预览，绝不直接修改全局数据或网站。
- **全局策展线**：将已审核、可追溯的事实投影为版本化发布包，再更新网站数据。

## 2. 已实现的私有作业主链路

当前可直接验收的自动基础线由 `scripts/run_basic_poet_map.py` 提供：

1. 接收 `.txt`、`.text`、`.md` 或带文本层的 `.pdf`；校验类型、大小、SHA-256 与处理同意，原件进入 `var/quarantine/<source-id>/`。
2. 创建独立的 `var/jobs/<job-id>/job.json`，记录输入标识、哈希和 CBDB／语料／来源目录快照。
3. 提取分页或分段文本，解析地点与明确的生平动作（如任职、贬谪、游历），形成带原文定位的候选断言和路线事件。
4. 生成自动策略报告及私有地图草图：`var/jobs/<job-id>/08-map/map-draft.json`。

作业中的主要阶段目录为：`00-intake`、`01-extract`、`02-resolve`、`03-claims`、`04-corpus`、`05-enrichment`、`06-events`、`07-review`、`08-map` 和 `audit`。每个阶段产物应可通过输入、参考快照和输出哈希追溯。

正常成功的 job 状态为 `approved-private-preview`；没有符合规则的路线点时，`empty-draft` 也是正常的私有结果。扫描件、加密件、损坏件或无有效文本的 PDF 会被阻断（扫描／无有效文本 PDF 为 `scan-unsupported`），不会被猜测性地画入地图。诗句、诗题或文学空间中的地点也不能单独推断为诗人到访记录。

## 3. 审核与发布目标链（非本次自动化验收项）

以下是项目规定的全局策展与发布边界，用于约束后续扩展；它不表示完整的 Agent release adapter／exporter 已经实现。

1. 只有附带精确证据定位、来源／数据集快照、作业信息与审核状态的断言，才可由策展流程写入 `data/records/`。
2. 从事实记录和批准的参考快照生成 `data/derived/` 下带 manifest、文件哈希和校验报告的版本化 release。
3. 当前网站仍使用 `data/published/` 的五个核心 JSON（人物、地点、事件、作品、来源）及其 `web/public/data/` 副本。它们不得手工编辑；同步前先执行验证和 `--dry-run`。
4. 行迹图、诗境图和交游录均复用上述“候选 → 审核 → 事实／release → 前端”的边界；`data/staging/` 已退役，不能放用户上传、私有文本或 job 缓存。详见 [`UPLOAD_WORKFLOW_ARCHITECTURE.md`](UPLOAD_WORKFLOW_ARCHITECTURE.md)。

## 4. 短期验收边界

| 项目 | 本次可验收内容 | 不应误判为已自动发布的能力 |
| --- | --- | --- |
| 上传与地图 | 本地、无外部 API 的私有传记地图基础线 | 扫描 PDF 的 OCR、模型自动补史、公开发布 |
| 历史事实 | 证据定位、时间／地点不确定性保留、路线与文学空间分离 | 由模型、搜索结果或题名匹配直接定论 |
| 网站数据 | 旧版五表的完整性校验与安全 dry-run | 将 job 草图直接写入 `data/published/` 或 `web/public/data/` |
| 发布能力 | 版本化 release 的数据边界和校验要求 | 完整 Agent release adapter／exporter 已全部落地 |

## 5. 建议的验收命令

```powershell
# 原始资料与公开五表：只读校验
python scripts/validate_source_materials.py --require-materialized-approved --json
python scripts/validate_published_data.py --json
python scripts/sync_published_data.py --dry-run --json

# 私有作业基础线的自动测试
python scripts/test_upload_intake_and_extract.py
python scripts/test_poet_map_job.py
python scripts/test_validate_poet_fact_package.py

# 以一份本地传记进行演示（结果仅写入 var/quarantine 与 var/jobs）
python scripts/run_basic_poet_map.py `
  --input C:\uploads\li-bai-biography.txt `
  --poet-id li-bai `
  --poet-name 李白 `
  --data-processing-consent

# 对演示 job 的进一步核验
python scripts/poet_map_job.py validate --job var/jobs/<job-id>/job.json --verify-current
python scripts/validate_poet_fact_package.py --package var/jobs/<job-id>/03-claims/fact-package.json

# 前端构建核验（在 web 目录执行）
cd web
npm run build
```

不要将 `sync_published_data.py --apply` 用作检查命令；只有在明确的发布决策和完整验证后，才可由负责发布的流程执行。

## 6. 本次核验记录

2026-08-20 已执行前述原始资料校验、公开数据校验、同步 dry-run 及三组私有作业测试，均通过：来源目录共 28 项且无错误／警告；公开五表共 26 名人物、89 个地点、152 条事件、44 部作品和 16 条来源；私有作业相关测试共 28 项通过（其中 2 项按设计跳过）。
