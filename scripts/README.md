# 工作流脚本

脚本目录只保留上传 job、来源治理和发布校验三类职责。新功能必须写入
`var/jobs/<job-id>/` 的阶段目录，不得重新引入共享 `data/staging`。

## 上传 job 基线

- `run_basic_poet_map.py`：单本可读文本/文本层 PDF 的私有垂直切片。
- `ingest_uploaded_source.py`：接收、哈希和格式检查。
- `poet_map_job.py`：创建、读取和验证 job manifest。
- `extract_biography_text.py`：抽取私有文本分段。
- `build_biography_route_draft.py`：生成带证据引用的行迹草稿。
- `validate_poet_fact_package.py`：校验事实包和发布边界。
- `run_book_analysis_agent.py`：书籍上传、文本切分、人物/地点/作品/事件/关系候选、故事卡、校验、人工审核和私有 release manifest 的原型闭环。
- `validate_book_analysis_agent.py`：校验原型 v2 draft 以及所属 job 的工件哈希。

原型工作流的详细说明见 `docs/BOOK_AGENT_PROTOTYPE.md`。它仍是离线规则抽取，不调用模型或搜索；
“publish”只生成 `var/jobs/<job-id>/09-release/release-manifest.json`，不会直接改写公共数据。

## 书籍验证基线（私有、未接入上传）

- `build_book_package_manifest.py`：为已拥有 job 的目录型书籍生成固定在
  `00-intake/book-package-manifest.json` 的有序、逐文件哈希清单；不复制原文，
  只接受显式 `input.kind=ordered-package-pending` 的书籍 job，不会接入现有单文件提取器。
- `validate_book_package_manifest.py`：校验书籍包清单及其集合摘要。
- `validate_private_volume_bundle.py`：校验 `08-map/` 内行迹图、诗境图、交游录的
  私有候选展示包；故事卡必须绑定交游边及其证据，不能成为公开事实。

这组脚本只可读输入并写入所属 `var/jobs/<job-id>/`，不写入
`data/records/`、`data/derived/`、`data/published/` 或 `web/public/data/`。完整边界和
后续实现顺序见 `docs/BOOK_VALIDATION_BASELINE.md`。

## 来源与公共契约

- `source_catalog.py`、`validate_source_materials.py`、`build_source_snapshots.py`：来源登记和快照。
- `build_raw_layer_manifest.py`、`validate_raw_layer.py`、`audit_source_materials_quality.py`：原始层审计。
- `apply_source_review_decisions.py`：应用明确的来源审核决定。
- `validate_published_data.py`、`sync_published_data.py`：公共五文件契约校验与同步预览。
- `audit_simplified_chinese.py`：原始层校验所需的简繁残留审计库。

旧的地点搜索、全局批扩展、候选合并、社会关系预览和直接发布脚本已经删除；当前 `data/published/` 与 `web/public/data/` 只作为冻结种子。后续行迹图、诗境图、交游录应在同一个上传 job 中实现，再经过 release manifest 发布。
