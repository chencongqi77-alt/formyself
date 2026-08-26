# 项目现状审计与复现记录

> 快照日期：2026-08-21  
> 结论（历史快照）：项目具有“事实优先、视图派生”的明确边界；本次收尾后，旧的全局候选链已退役，后续只沿上传 job → 三类视图 → release 这条主线推进。论文仍不能把它概括成一条已经完成的“上传即公开发布”自动管线。

## 一、已核验的基础数据与命令

本次仅运行了只读校验、dry-run 和测试；没有修改原始资料、记录层、发布层或前端数据。

| 校验对象 | 结果 | 可用于论文的谨慎表述 |
| --- | --- | --- |
| 受治理来源目录 | 25 条来源、0 error、0 warning | 来源目录具有可复查的准入与完整性校验 |
| 公开五表 | 26 人、89 地、152 事件、44 作品、16 来源；0 error、0 warning | 当前公开历史数据遵守五表契约和来源定位约束 |
| 发布同步预演 | valid；五个 canonical JSON 均列入 wouldSync | 遗留公开数据链可通过校验后单向同步；本次未执行写入 |
| 私有上传/提取测试 | 7 项测试通过，其中 2 项按设计跳过 | 文本型上传和阻断策略有自动测试覆盖 |
| job 契约测试 | 14 项测试通过 | 私有作业的状态、路径和快照边界可复验 |
| 事实包校验测试 | 7 项测试通过 | evidence/assertion 引用、时间与语义隔离具备规则校验 |

复现实验可从下列命令开始：

    python scripts/validate_source_materials.py --require-materialized-approved --json
    python scripts/validate_published_data.py --json
    python scripts/sync_published_data.py --dry-run --json
    python scripts/test_upload_intake_and_extract.py
    python scripts/test_poet_map_job.py
    python scripts/test_validate_poet_fact_package.py

## 二、状态盘点

| 层或模块 | 当前状态 | 已存在的材料 | 论文中的正确位置 |
| --- | --- | --- | --- |
| 受治理原始资产 | 已验证实现 | source-materials、CBDB、chinese-poetry、raw-layer/source manifest | 数据来源与治理前提 |
| 私有传记地图基础线 | 已验证实现，仅私有 | 隔离接收、job、文本提取、规则化路线候选、private map draft | 方法案例；不作为公开发布结果 |
| 公开五表与静态网站数据 | 已验证实现，遗留发布契约 | people、places、events、works、sources 与同步校验 | 主案例的可信数据基线 |
| 行迹卷 | 已发布数据驱动的交互视图 | 事件、地点、作品、来源的联动阅读 | 主展示案例 |
| 诗中世界 | 候选预览 | 7,016 条原始候选；5,450 条点图层、896 条区域注解、670 条严格门记录 | 补充案例，展示文学空间的候选与歧义管理 |
| 交游录 | 候选预览 | 27 位诗人的索引；510 条直接边；1,768 条阅读网络边 | 补充案例，展示关系线索的渐进阅读 |
| 通用 job 到公开网站的 release/exporter | 设计目标 | 架构文档、schema、后续脚本清单 | 展望，不能写成已实现能力 |

## 三、两条已实现链与一条规划链

### 1. 私有上传作业线

本地文本型传记经类型、大小、魔数或编码与 SHA-256 校验后进入隔离区；系统创建单独 job，提取可定位的文本段，基于“正式地点名 + 同句明确生平动作”生成私有 evidence、assertion、路线候选和 map-draft。

终点是 private preview，不是当前公开网站。扫描、加密、损坏或无有效文本的 PDF 会被阻断；基础线不调用外部模型、网页搜索或 OCR 来猜测内容。

### 2. 遗留公开网站数据链

当前公开网站仍使用五个 canonical JSON。它们先经过来源、字段、关系和定位校验，再通过 dry-run，最后才能单向同步至前端静态数据副本。

这是一条已实现的数据发布链，但不是通用 fact-package 发布器。

### 3. 规划中的通用事实发布链

从已审核 poet fact-package 到 records、完整 release、release adapter 和前端网站的通用自动衔接，仍是架构目标。它应在流程图中以虚线或“未来工作”表示。

## 四、复现锚点

当前目录不是 Git 工作树，不能用 commit 作为论文复现锚点。论文冻结时应记录：

- 检查日期与运行命令；
- source manifest、public data 与相关 release manifest 的 SHA-256；
- 前端候选数据的 releaseId 和 generatedAt；
- 每张截图的页面路径、人物筛选条件、数据状态和截图日期。

当前诗境/交游前端数据是冻结的候选种子；旧的 20260810 全局批处理输入已清理。社会阅读器的事件证据叠层仍保留单独 manifest：poet-social-reader-pilot-20260820；这不提升关系边本身的候选状态。

## 五、主要证据入口

- docs/SHORT_TERM_ACCEPTANCE_PROCESS_FLOW.md
- docs/BASELINE_UPLOAD_PIPELINE.md
- docs/AUTOMATED_POET_AGENT_ARCHITECTURE.md
- data/published/README.md
- data/records/README.md
- data/derived/README.md
- web/public/data/poetry-modules-manifest.json
- web/public/data/poet-social-index.json
- data/derived/releases/poet-social-reader-pilot-20260820/reader-content-manifest.json（冻结种子）

这些文件用于支持项目方法与状态，不应替代论文所需的外部相关工作文献。
