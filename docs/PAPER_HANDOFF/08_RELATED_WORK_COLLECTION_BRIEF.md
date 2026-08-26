# 相关工作检索简报

> 本文件不是文献综述，也不预设结论。它定义后续 Agent 需要收集什么，以便项目材料能放入真实的研究语境。

## 一、优先检索的四组问题

| 主题 | 论文中要解决的连接点 | 建议检索词 |
| --- | --- | --- |
| 数据溯源与可复现数字人文 | 如何记录来源版本、定位、审核和派生关系 | data provenance digital humanities；research data lineage；reproducible digital humanities；文化遗产数据溯源 |
| 历史空间与不确定性 | 如何避免将不精确时间/地名表现成精确地理事实 | historical GIS uncertainty；temporal uncertainty visualization；historical gazetteer provenance；历史地理 不确定性 可视化 |
| 文学空间与语义边界 | 如何区分文本提及、创作地、人物行迹和叙事空间 | literary geography；spatial humanities；literary cartography；文学地理 诗歌 地点 |
| 交互式证据呈现 | 如何让读者在聚合视图与来源/解释之间往返 | provenance visualization；evidence-centered interface；uncertainty communication visualization；可解释性 可视化 证据链 |

若最终选择“私有传记到路线草图”方向，可追加：document ingestion provenance、privacy-preserving humanities data、human-in-the-loop historical extraction。  
若最终选择“教育效果”方向，必须单列：digital humanities learning、map-based learning、historical thinking assessment，并同时设计用户研究，而非只引用文献。

## 二、建议的检索与筛选规则

1. 先以近十年同行评议论文、专著章节、权威数据标准/项目报告为主，再回溯经典理论。
2. 每个主题至少筛选 3 至 5 篇真正会进入正文的核心来源，避免堆砌宽泛背景文献。
3. 记录每篇文献解决的具体问题、方法、数据、评价方法和与本项目的差异。
4. 区分“技术上可借鉴”与“可直接支持论文主张”；例如历史 GIS 文献不能自动证明本项目的教育效果。
5. 引用前核查全文、版本、DOI/稳定链接和作者原意；不要引用搜索摘要或二手转述。

## 三、文献卡模板

后续 Agent 可以在 literature-search-log.md 中对每篇文献记录：

| 字段 | 内容 |
| --- | --- |
| citationKey | 自定义短键 |
| 完整书目信息 | 作者、年份、题名、出处、DOI/稳定链接 |
| 主题 | 对应上表四组中的哪一组 |
| 研究问题 | 文献要回答什么 |
| 方法与对象 | 数据、系统、案例或实验 |
| 关键发现 | 用自己的话概括，避免大段转录 |
| 可引用位置 | 引言、相关工作、方法讨论或局限 |
| 与本项目的差异 | 状态治理、语义分层、数据类型、评价范围等 |
| 可靠性核查 | 是否读到原文、是否同行评议、版本是否确定 |

## 四、与当前项目的连接方式

相关工作应帮助论文回答“为什么要这样设计”，而不是替项目补出不存在的结果：

- 溯源研究可帮助解释为何要保留 sourceRef、locator、snapshot、review state 和 release manifest。
- 历史空间不确定性研究可帮助解释为何路线、诗歌地点和展示坐标不能被一概当作确定事实。
- 文学空间研究可帮助定位“诗中世界”作为文本空间，而非生平旅行证据。
- 交互可解释性研究可帮助讨论读者如何从聚合图形回到来源与状态。

最终文献综述应明确：本项目贡献是一个在古典文学材料上的证据优先处理与多视图案例，不应声称已经验证了所有外部研究所讨论的用户效果或算法性能。
