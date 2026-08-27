# 原始数据层

原始层包含三类数据，统一由 [`raw-layer-manifest.json`](raw-layer-manifest.json) 登记，不依赖版本控制元数据。所有可显示中文均采用 UTF-8 简体规范；当前正式数据已经过 OpenCC `1.4.1`、`t2s.json` 稳定转换和残留检查。

| 数据集 | 原始位置 | 完整性方法 | 当前用途 |
|---|---|---|---|
| CBDB 2026-07-18 | `cbdb/cbdb_20260718.sqlite3` | 官方 SHA-256、字节数、SQLite `quick_check` | 人物、地点、任官和关系 |
| chinese-poetry | `chinese-poetry/` | 2,282 个文件的逐文件 SHA-256 快照 | 诗、词和作者作品 |
| source-materials | `source-materials/` | 单文件摘要或目录逐文件 SHA-256；权利与质量准入 | 史传、年谱、文集和旁证 |

## 当前准入状态

`source-materials` 共 15 条记录：

- 10 条 `approved`：允许通过统一入口抽取；
- 4 条 `blocked`：缺卷、缺目标覆盖或权利不清；
- 1 条 `deprecated`：损坏的旧 Wikisource EPUB，仅保留审计记录。

批准来源覆盖曹操、苏轼、李白、杜甫、辛弃疾和李清照，包括《三国志》《宋史》《东坡全集》、李白与杜甫文集、杜甫年谱、辛弃疾与李清照词集，以及固定修订的苏轼年谱和本传。

批准表示文件完整、权利边界已记录、技术质量和目标内容定位通过审核；不等于其中每个历史事实已经完成独立学术考证。下游事实仍应保留 `sourceId + locator`。

## 下游使用

禁止直接递归扫描原始目录。程序必须使用：

```powershell
python scripts/source_catalog.py --json
```

这个入口会先校验内容快照、权利、质量和本地实物，只返回 `approved` 来源。

## 验证与更新

```powershell
python scripts/build_source_snapshots.py --check
python scripts/validate_source_materials.py --require-materialized-approved
python scripts/validate_raw_layer.py --require-simplified
```

引入新的目录型来源后，先登记到 `quarantine/`，完成简体规范化与审核，再运行 `python scripts/build_source_snapshots.py` 生成逐文件快照。除繁转简外的清洗、切段和结构化结果写入 `extracted/` 或 `data/`。
