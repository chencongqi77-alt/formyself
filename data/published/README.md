# 发布数据包（canonical published data）

本目录是网站公开数据的唯一上游。发布流程只能单向执行：

~~~
data/published/*.json
        │  validate_published_data.py
        ▼
web/public/data/*.json
~~~

旧的阶段 A 小样本和共享 staging 已退役，不再作为本目录的输入。新的上传
job 只能在完成事实校验和 release 决定后生成本目录的下一版。

## 文件

目录根下必须同时存在下列 UTF-8 JSON 数组文件：

- people.json
- places.json
- events.json
- works.json
- sources.json

所有记录的 id 使用小写 ASCII kebab-case，所有实体记录的 reviewStatus 必须为
"published"。校验器拒绝未知字段，以防止字段拼写错误静默进入前台。

## 来源卡与精确定位

sources.json 的每条卡片必须是 source-materials/source-manifest.json 中一个可公开
再分发的 approved 来源的逐字段投影：

~~~
{
  "id": "kanripo-kr2a0032",
  "title": "与 source-manifest 完全一致",
  "sourceType": "与 source-manifest 完全一致",
  "sourceUrl": "与 source-manifest 完全一致",
  "version": { "type": "edition", "value": "与 source-manifest 完全一致" },
  "license": "与 source-manifest rights.license 完全一致",
  "licenseUrl": "与 source-manifest rights.licenseUrl 完全一致",
  "attribution": "与 source-manifest rights.attribution 完全一致",
  "reviewStatus": "published"
}
~~~

每个人物、地点、事件、作品都必须有非空 sourceRefs。每项严格使用：

~~~
{
  "sourceId": "kanripo-kr2a0032",
  "locator": {
    "kind": "line-range",
    "path": "KR2a0032_338.txt",
    "startLine": 15,
    "endLine": 17
  }
}
~~~

可选的 purpose 可以提供面向读者的简短用途说明，但不会替代 locator：

~~~
{
  "sourceId": "kanripo-kr2a0032",
  "locator": { "kind": "line-range", "path": "KR2a0032_338.txt", "startLine": 15, "endLine": 17 },
  "purpose": "生平时间线依据"
}
~~~

sourceId 必须同时存在于本目录的 sources.json 和来源清单，且来源的
ingestionStatus 为 approved、允许 data-extraction 与 public-redistribution。不接受
自由文本 locator；支持以下精确定位形式：

| kind | 必填字段 |
| --- | --- |
| line-range | path、startLine、endLine |
| page-range | pageStart、pageEnd |
| json-pointer | path、pointer（以 / 开始） |
| record-id | table、recordId |
| chapter-section | chapter、section |
| named-anchor | path、anchor |

定位中的 path 相对于该来源根目录，使用 /，不得是绝对路径或包含 ..。
完整来源目录校验开启时，line-range 的文件与行号会实际核对，json-pointer 也会
实际解析到对应 JSON 节点；其余定位类型则执行严格的结构校验。

## 实体结构

~~~
people: id, name, aliases, dynasty, birthYear, deathYear, intro,
        sourceRefs, reviewStatus

places: id, name, historicalNames, modernName,
        sourceCoordinates{x, y, source, sourceRef}, intro, sourceRefs,
        reviewStatus

events: id, personId, placeId, lifeStage, role, title, summary, workIds,
        sourceRefs, reviewStatus,
        [startYear, endYear, timePrecision, timeLabel, sequence]

works:  id, personId, placeIds, eventIds, title, genre, text,
        plainExplanation, sourceRefs, reviewStatus
~~~

- 地点 x 为经度（[-180, 180]），y 为纬度（[-90, 90]）；
  sourceCoordinates.sourceRef 必须也出现在该地点的 sourceRefs。
- personId、placeId、workIds、eventIds 都必须指向已有 ID。
- 事件与作品关联必须严格双向：事件的每个 workIds 都要在作品的 eventIds 中反向
  出现，反之亦然；双方的 personId 也必须一致。

### 事件时间与路线顺序

为兼容既有数据，旧事件仍可只带 `startYear` 和 `endYear`，不带任何新的时间字段。
新事件若带 `timePrecision`，则必须同时带非空的 `timeLabel` 和正整数
`sequence`：

- `year`、`range`：必须同时有 `startYear` 和 `endYear`；`year` 的两者必须相等。
- `era-only`、`era-and-month`、`sequence-only`：公元年可以省略；若填写，则
  `startYear` 与 `endYear` 必须成对出现且不能倒置。
- `timeLabel` 是界面展示的史料时间标签。`sequence-only` 绝不可用推测的公元年替代。
- 同一 `personId` 只要任一事件带 `sequence`，该人物的所有事件都必须带互不重复的
  正整数 `sequence`，以便前端按史料顺序完整排序。

## 收录边界

- 生平路线只发布可由 approved 史传、年谱或作品附注直接支持的节点；来源未给出公元
  年时使用 `sequence-only`，不把朝代年号换算成未经核对的年份。
- 作品题名或正文中的地名可建立“作品地点选读”节点，但必须明确标注为非生平排序，
  不得把诗词空间直接写成作者的确定行迹、任职经历或创作日期。
- 需要将古地名呈现在现代地图时，摘要应说明近似展示的边界；地点坐标仍须各自具有
  可审计的 `sourceCoordinates.sourceRef`。

## 校验与同步

先校验，再预演同步，最后才写入网站目录：

~~~powershell
python scripts/validate_published_data.py --json
python scripts/sync_published_data.py --dry-run
python scripts/sync_published_data.py
~~~

同步脚本会重新执行完整的 source-materials 实物与治理校验；任何错误都会阻止写入
web/public/data/。同步从不反向读取或合并网站目录中的 JSON。
