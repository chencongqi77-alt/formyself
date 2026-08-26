# 自动传记地图：第一条可运行的基础线

这一版已经把最小闭环跑通了：

```text
上传文件
→ 私有隔离区
→ 建立 job
→ 文本/分页提取
→ 本地地点与生平动作规则
→ 私有游历地图草图
```

它不调用 DeepSeek、网页搜索或任何外部 API，也不改动 `data/published/`、
`web/public/data/` 和现有全局数据。这样先把最常见的上传和自动出图路径稳定下来，
后续再给少数疑难段落接 OCR 或模型能力。

## 一条命令运行

先在项目 Python 环境中安装运行依赖：

```powershell
python -m pip install -r requirements-agent.txt
```

然后运行：

```powershell
python scripts/run_basic_poet_map.py `
  --input C:\uploads\li-bai-biography.txt `
  --poet-id li-bai `
  --poet-name 李白 `
  --data-processing-consent
```

命令会返回 `jobPath` 与 `mapPath`。私有地图在：

```text
var/jobs/<job-id>/08-map/map-draft.json
```

输入文件及其接收回执仅保存在：

```text
var/quarantine/<source-id>/
var/jobs/<job-id>/
```

## 第一版支持边界

| 输入 | 处理方式 |
| --- | --- |
| `.txt` / `.text` / `.md` | 支持 UTF-8（含 BOM）、UTF-16、GB18030；记录原始 SHA-256 和实际编码。 |
| 有文本层的 `.pdf` | 先用 `pypdf` 按页提取，低质量页再用 `pdfplumber`。每页会记录字符数、可打印率、乱码率和提取方法。 |
| 扫描 PDF、纯图片 PDF | 返回 `scan-unsupported`，不会把空白页交给模型猜传记。后续可加本地 OCR 或经用户授权的外部 OCR adapter。 |
| 加密、损坏、超大、扩展名与真实内容不一致 | 在接收/提取阶段拒绝，不进入地图。 |

当前 `requirements-agent.txt` 固定文本型 PDF 的运行依赖；
`requirements-agent-dev.txt` 只增加测试用的 `reportlab`。本地 OCR 需要单独固定
Tesseract/PaddleOCR 及中文语言包，不能默认假设每台机器都有。

## 自动出图规则

第一版的目标是“尽量不画错”，不是覆盖所有古今地名：

- 只解析当前 `data/published/places.json` 中的**正式地点名**，不默认把展示性别名当成等价地点；
- 只有“地点名 + 明确生平动作”在同一个传记句段中才进入路线，例如 `生于`、`谪居`、`任职`、`寓居`、`游历`、`抵达`；
- `作于`、诗题、诗句、赠答、怀古等文学空间不会变成“诗人到过这里”；
- 没有可靠公元年份时只保留文本中的年号，或按照文本顺序排序，绝不擅自换算年份；
- 每个路线点都有输入 SHA、段落/页码定位和规则置信度，但这些只用于私有草图，不会写回全局事实库。

`07-review/` 在这一版不是人工待办，而是 `auto-policy-report.json`：它记录自动纳入、
仅作背景或跳过的数量和原因。通过规则的 job 会直接成为
`approved-private-preview`；这不等于公开发布。

## Job 内的关键产物

```text
00-intake/receipt.json                 # 类型、大小、SHA、编码等接收信息
01-extract/segments.jsonl              # 私有、稳定定位的文本段
01-extract/extract-report.json         # PDF 页级质量和提取方式
02-resolve/place-resolutions.json       # 地名解析或跳过理由
03-claims/fact-package.json             # 私有 evidence + assertion 包
03-claims/route-candidates.json         # 自动规则生成的路线候选
06-events/map-events.json               # 可画入草图的事件
07-review/auto-policy-report.json       # 无人工介入的自动策略报告
08-map/map-draft.json                   # 供前端/下一阶段消费的私有地图草图
```

`04-corpus/` 和 `05-enrichment/` 会在第一版明确写出“跳过”报告：当前尚未建立任意诗人的
完整语料索引，也没有启用外部 API；它们绝不会悄悄用诗句地点反推行旅。

若 PDF 因扫描、加密或无有效文本被阻断，原因会写到
`audit/extract-blocked.json`，job 不会被错误地推进到地图阶段。

## 验证

```powershell
python scripts/test_upload_intake_and_extract.py
python scripts/test_poet_map_job.py
python scripts/test_validate_poet_fact_package.py
python scripts/validate_published_data.py --json
```

下一阶段再做两件事：建立按 `chinese-poetry` 快照版本化的离线作品索引，并给扫描 PDF 加一个
明确授权、可替换的 OCR adapter。两者都只产生 job-local 候选，不直接污染公开数据。
