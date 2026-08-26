# 上传书籍工作流架构

## 目标

产品只保留一条主线：用户上传一本书，系统在私有 job 中解析出诗人的三类核心视图：

- **行迹图**：人物生平事件、地点和时间线。
- **诗境图**：作品中的地点、场景和证据关联。
- **交游录**：人物之间有证据支撑的交往关系。

网页上的“上传书籍”目前只是入口和接口占位。真正的解析、审核和发布由后续自动化 workflow 完成；在审核或发布之前，任何上传内容都不得进入公共数据。

## 目录边界

```text
source-materials/              不可变、已登记的公开证据和来源快照
cbdb/                          CBDB 原始快照（只读）
chinese-poetry/                诗词原始语料（只读）

var/
  quarantine/<upload-id>/      上传接收区：哈希、类型和保留策略
  jobs/<job-id>/                一个上传对应一个私有 job
    00-intake/                 收据和输入元数据
    01-extract/                文本分段与抽取报告
    02-resolve/                人物、地点、作品解析候选
    03-claims/                 带证据引用的事实候选
    04-corpus/                 诗词语料匹配候选
    05-enrichment/             可选外部补充，默认跳过
    06-events/                 行迹、诗境、交游的事件草稿
    07-review/                 自动策略和人工审核结果
    08-map/                    私有三类视图草稿
    09-release/                经过明确批准的发布清单

data/
  records/                     审核后的事实记录
  derived/                     从事实记录生成的版本化投影
  published/                   当前五文件公共契约（冻结种子）
  contracts/                   job、事实包和发布契约

web/public/data/               前端只读静态种子；禁止 job 直接写入
```

`source-materials` 和 `data` 不合并：前者回答“这段材料从哪里来”，后者回答“我们审核后发布了什么事实”。`var` 也不与它们合并，因为上传原文、模型输出和中间文件必须按 job 隔离，并且可以在保留策略到期后清理。

## 自动化流程

```text
上传入口
  → quarantine + SHA-256 / MIME / 同意与保留策略
  → job init
  → 文本抽取与分段
  → 人物/地点/作品解析
  → 证据绑定的 claims
  → 行迹 / 诗境 / 交游三类私有草稿
  → 校验与审核策略
  → release manifest
  → data/derived（必要时再更新 data/published 和 web/public/data）
```

当前可执行的安全基线是 `scripts/run_basic_poet_map.py`，它只支持可读文本和带文本层 PDF，并生成私有行迹草稿。后续扩展格式适配器、诗境抽取和交游抽取时，仍要写入同一个 job 的阶段目录，不能恢复共享 `data/staging` 缓存。

三类输出应当由同一个 job manifest 关联，并保留每条断言的 `sourceRefs`、快照标识、生产 job 和审核状态。模型、搜索、OCR 或标题匹配只能产生候选，不能直接成为公共事实。

## 当前种子与发布策略

现有 `data/published/` 和 `web/public/data/` 保留当前诗词网站的静态种子，作为页面回归和产品演示数据；它们不再由旧的全局批处理脚本生成。新的上传 job 只有在显式审核和发布步骤后，才可以产生新的 `data/derived` 版本或更新公共契约。

`data/staging/` 已退役，不再存放用户上传、模型缓存或新的全局候选。临时文件只能放在对应的 `var/jobs/<job-id>/` 下。

## 保留的最小命令集

```powershell
python scripts/run_basic_poet_map.py --input <book.txt-or-text-layer.pdf>
python scripts/poet_map_job.py init --input <quarantine-file> --job-id <job-id>
python scripts/poet_map_job.py validate --job <job.json>
python scripts/validate_poet_fact_package.py --package <fact-package.json>

python scripts/validate_source_materials.py --require-materialized-approved
python scripts/validate_published_data.py --json
python scripts/sync_published_data.py --dry-run --json
```

旧的全局地点搜索、批量扩展、候选合并和直接发布脚本已不属于这条主线，已从工作区移除。需要新增能力时，优先增加 job-local stage 和对应 contract，而不是恢复共享 staging。
