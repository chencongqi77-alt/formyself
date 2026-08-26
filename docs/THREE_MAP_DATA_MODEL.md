# 上传书籍后的三张图数据结构设计

> 状态：设计提案，面向下一版 `private-poet-volume-bundle`。现有 v1 契约继续作为已实现基线，暂不通过本文件直接改写或发布数据。

## 0. 先给结论

上传一本书之后，系统不应该分别生成三份互不相认的“行迹数据”“诗境数据”“交游数据”。三张图应当共享同一套：

```text
人物 / 地点 / 作品
        │
      证据
        │
事实连接 ─── 故事卡
   │          │
行迹图     诗境图     交游录
```

最小公共模型只有六类东西：

1. `people`：诗人和被提及的人物；
2. `places`：历史地点及其现代展示位置；
3. `works`：诗、词、文、书信等作品；
4. `evidence`：书中可以回读的证据定位；
5. `storyCards`：面向阅读的短故事，不直接冒充独立史实；
6. 三种连接：`journey.items`、`poemWorld.items`、`social.edges`。

这里最关键的设计是：**故事卡是共享内容，三条线是共享内容的三种入口。**

## 1. 对现有网站的判断

现有网站的实体方向是对的：`people.json`、`places.json`、`works.json`、`events.json` 已经构成了很好的公共底座；行迹点、作品—地点关联和人物关系也已经分别有数据。

现在真正需要收拢的是以下四处：

| 现状 | 问题 | 设计处理 |
| --- | --- | --- |
| 行迹点有 `title / summary`，交游卡另有一套 `storyCards` | 同一种“小故事”不能跨模块复用 | 把故事卡移到顶层，三类连接只保存 `storyIds` |
| 黄鹤楼专题在 `lib/poem-world-spotlight.ts` 中硬编码 | 地点故事不能由书籍上传结果产生 | 改成 `poemWorld.spotlights + storyCards` |
| 交游阅读材料在 `lib/relationship-reading.ts` 中硬编码 | 关系故事无法由 Agent 统一生成和审核 | 改成顶层 `storyCards`，关系边只引用卡片 |
| 行迹、诗境、交游的 `sourceRefs` 定位格式不完全相同 | Agent 和审核器难以统一回读证据 | 私有层统一使用 `evidenceIds`，由 release adapter 展开成前端 `sourceRefs` |

因此，当前 v1 的方向不需要推倒重来，主要是把“故事卡”从交游卷中提升为三卷共享的内容层，并给三种连接补上引用字段。

## 2. 数据边界：候选、事实和展示要分开

上传书籍产生的是一个私有 job。推荐的边界如下：

```text
原书 / 上传文件
  → 书籍包与文本片段（私有）
  → 人物、地点、作品候选（私有）
  → 带 evidenceIds 的事实候选（私有）
  → 三卷 bundle（私有预览）
  → 审核后的 records
  → release adapter
  → 网站公开数据
```

三张图的数据结构不是原书，也不是 Agent 的原始回答，而是**受证据约束的阅读投影**。因此：

- 原书正文、完整模型提示词、模型响应和私有摘录留在 `var/jobs/<job-id>/`；
- bundle 中保存证据文件、页码/段落/章节等定位，以及摘录哈希；
- 公开 release 只保留允许公开的短引文或来源定位；
- 未消歧人物、地点、作品可以保留为 candidate，但不能伪装成已核定事实；
- 没有执行的卷必须写 `not-run`，无法处理的卷必须写 `blocked`，不能用空数组掩盖状态。

## 3. 推荐的 bundle 外壳

建议沿用现有 `private-poet-volume-bundle` 的外壳，只做下一版扩展，不另造三份接口：

```jsonc
{
  "recordType": "private-poet-volume-bundle",
  "schemaVersion": "2.0.0",
  "bundleId": "ppvb-li-bai-book-job",
  "jobId": "book-job-li-bai-001",
  "createdAt": "2026-08-25T00:00:00Z",
  "access": {
    "visibility": "private",
    "publicationState": "not-submitted"
  },
  "source": {
    "bookId": "uploaded-book-001",
    "bookTitle": "某诗人传记与诗文集",
    "packageId": "bpm-uploaded-book-001",
    "packageSha256": "<package sha256>",
    "packageOwnerJobId": "book-job-li-bai-001"
  },
  "poet": {
    "id": "li-bai",
    "name": "李白",
    "identityState": "resolved"
  },
  "evidence": [],
  "entities": {
    "people": [],
    "places": [],
    "works": []
  },
  "storyCards": [],
  "volumes": {
    "journey": { "state": "ready", "items": [] },
    "poemWorld": { "state": "ready", "items": [], "spotlights": [] },
    "social": { "state": "ready", "edges": [] }
  },
  "limitations": []
}
```

`evidence`、`entities`、`storyCards` 是公共层；`volumes` 是三条线的视图层。视图层只保存 ID，不复制完整人物、地点、作品和故事正文。

## 4. 公共实体

### 4.1 人物 `people[]`

```jsonc
{
  "id": "cui-hao",
  "name": "崔颢",
  "aliases": [],
  "resolutionState": "resolved",
  "externalIds": [],
  "evidenceIds": ["ev-person-cui-hao"]
}
```

人物的生卒年、朝代和简介可以继续作为实体属性；如果只在书中出现一次，仍然可以保存为 `candidate`，但不要因为同名就自动合并。

### 4.2 地点 `places[]`

```jsonc
{
  "id": "huanghelou",
  "label": "黄鹤楼",
  "historicalNames": ["黄鹤楼"],
  "modernName": "湖北省武汉市蛇山一带",
  "resolutionState": "resolved",
  "mapKind": "point",
  "coordinate": {
    "x": 114.30,
    "y": 30.55,
    "precision": "display-only"
  },
  "evidenceIds": ["ev-place-huanghelou"]
}
```

`coordinate` 是地图展示信息，不等于历史现场的精确坐标。无法精确定位时使用 `region` 或 `none`，不猜坐标。

### 4.3 作品 `works[]`

```jsonc
{
  "id": "li-bai-huanghelou-song-meng-haoran",
  "authorPersonId": "li-bai",
  "title": "黄鹤楼送孟浩然之广陵",
  "genre": "诗",
  "discoveryState": "matched",
  "evidenceIds": ["ev-work-li-bai-huanghelou"]
}
```

作品只保存身份和可回读来源。完整正文属于作品资料层，不要在每一条地点连接里复制诗全文。作品和地点的关系应放在 `poemWorld.items`，因为一首诗可能有多个地点、多个关系和不同的确定程度。

## 5. 证据 `evidence[]`

证据是所有可见条目的共同底座，沿用当前契约的方向：

```jsonc
{
  "id": "ev-story-huanghelou",
  "sourceFileId": "book-file-012",
  "locator": {
    "kind": "chapter-section",
    "label": "卷三·黄鹤楼故事"
  },
  "support": "direct",
  "excerptSha256": "<excerpt sha256>",
  "createdByJobId": "book-job-li-bai-001"
}
```

最低要求：每一条行迹点、作品—地点连接、人物关系边和故事卡，都至少绑定一条 `direct` 证据；`context` 只能补充，不能单独支撑一条新事实。具体书中定位继续支持页码、行号、段落、章节和稳定文本偏移。

## 6. 故事卡 `storyCards[]`：三条线的公共语言

一张故事卡只做一件事：把已经有证据的若干实体，用一两句话组织成可读内容。

```jsonc
{
  "id": "story-huanghelou-cui-hao-li-bai",
  "kind": "tradition",
  "title": "黄鹤楼上的两首诗",
  "summary": "后世诗话相传，李白登楼读到崔颢题诗后搁笔；这一说法把两首写于黄鹤楼传统中的作品放在同一处阅读。",
  "claimType": "tradition",
  "anchorRefs": [
    { "type": "place", "id": "huanghelou" },
    { "type": "person", "id": "cui-hao" },
    { "type": "person", "id": "li-bai" },
    { "type": "work", "id": "cui-hao-huanghelou" },
    { "type": "work", "id": "li-bai-huanghelou-song-meng-haoran" }
  ],
  "evidenceIds": ["ev-story-huanghelou"],
  "reviewState": "candidate-preview"
}
```

故事卡只需要这些核心字段：

| 字段 | 含义 |
| --- | --- |
| `kind` | 阅读用途：`journey`、`place`、`relationship`、`tradition` |
| `title` | 卡片标题，不承担事实判断 |
| `summary` | 短摘要，建议一至两句 |
| `claimType` | 证据性质：`fact`、`tradition`、`interpretation` |
| `anchorRefs` | 卡片关联的人物、地点、作品；这是通用关联接口 |
| `evidenceIds` | 卡片的来源证据 |
| `reviewState` | 当前审核状态 |

这里要特别区分：

- `kind` 是“这张卡从哪种阅读角度讲”；
- `claimType` 是“这张卡讲的是事实、传统还是解释”；
- `reviewState` 是“这张卡当前能不能进入下一层”。

因此，黄鹤楼卡可以同时挂住崔颢、李白、黄鹤楼和两首作品，但因为 `claimType = tradition`，**不能仅凭这张卡自动生成“李白与崔颢确有交游”的关系边**。

## 7. 三条线只保存各自的连接

### 7.1 行迹图：人生事件连接

```jsonc
{
  "id": "journey-li-bai-changan-01",
  "placeId": "changan",
  "predicate": "held-office-at",
  "sequence": 4,
  "time": {
    "precision": "year",
    "label": "天宝元年",
    "startYear": 742,
    "endYear": 742
  },
  "workIds": [],
  "storyIds": ["story-li-bai-hanlin"] ,
  "mapEligible": true,
  "evidenceIds": ["ev-journey-li-bai-changan"],
  "reviewState": "candidate-preview"
}
```

行迹点回答的是：**诗人在什么人生阶段，以什么身份，与这个地点发生了什么关系。**

- `predicate` 只表达生平动作，例如 `born-at`、`resided-at`、`visited`、`held-office-at`、`exiled-to`、`died-at`；
- `sequence` 是不能确定年份时仍然可用的叙事顺序；
- `workIds` 只在史料明确把作品和该人生事件联系起来时填写；
- 诗题中出现一个地点，不得反向制造行迹点；
- `storyIds` 可以为空，表示这个点暂时只有事实，没有独立小故事。

### 7.2 诗境图：作品—地点连接 + 地点故事索引

作品—地点连接：

```jsonc
{
  "id": "link-li-bai-work-huanghelou",
  "workId": "li-bai-huanghelou-song-meng-haoran",
  "placeId": "huanghelou",
  "relationType": "describes-place",
  "certainty": "verified",
  "storyIds": ["story-huanghelou-cui-hao-li-bai"],
  "evidenceIds": ["ev-work-li-bai-huanghelou"],
  "reviewState": "candidate-preview"
}
```

建议保留四个最小关系词：

| `relationType` | 含义 | 能否推出诗人到过这里 |
| --- | --- | --- |
| `composed-at` | 作品明确作于此地 | 只能在独立生平证据支持时推出 |
| `inscribed-at` | 作品明确题/刻/写于此地 | 不能单独替代生平事件 |
| `describes-place` | 作品题咏或描写此地 | 不能推出到访 |
| `mentioned-place` | 正文提及此地 | 不能推出到访 |

地点故事索引：

```jsonc
{
  "placeId": "huanghelou",
  "storyIds": ["story-huanghelou-cui-hao-li-bai"]
}
```

它可以放在 `poemWorld.spotlights[]` 中。这样长安、黄鹤楼、黄州等地点都可以拥有多张故事卡，而不必把故事硬塞进某一首诗或某一个行迹点。

### 7.3 交游录：人物关系边 + 具体往来故事

关系边：

```jsonc
{
  "id": "edge-su-shi-wang-an-shi",
  "sourcePersonId": "su-shi",
  "targetPersonId": "wang-an-shi",
  "relationTypes": ["official", "literary-exchange"],
  "time": {
    "precision": "range",
    "label": "熙宁年间"
  },
  "placeIds": ["changan", "jinling"],
  "workIds": ["su-shi-ci-jinggong-yun"],
  "storyIds": ["story-su-shi-wang-an-shi-jinling"],
  "evidenceIds": ["ev-edge-su-shi-wang-an-shi"],
  "reviewState": "candidate-preview"
}
```

关系边回答“他们属于什么关系”；故事卡回答“他们之间发生过哪一件可以回读的往来”。

- 一条边可以有多个 `relationTypes`；
- 一张关系卡可以有时间、地点和作品锚点；
- “赠、寄、答、和、见、荐、同游”等文本线索可以生成故事候选，但不能只凭一个标题就生成“好友”关系；
- 只有 `social.edges[]` 中真实存在的关系边，才能通过 `storyIds` 展示为交游故事；地点故事卡本身不能自动变成人物关系边。

## 8. 三条线的最小字段表

| 视图 | 必要字段 | 可选关联 | 一句话判断标准 |
| --- | --- | --- | --- |
| 行迹图 | `placeId + predicate + sequence/time + evidenceIds` | `workIds + storyIds` | 是否是诗人的人生行迹 |
| 诗境图 | `workId + placeId + relationType + evidenceIds` | `storyIds` | 是否是作品与地点的关系 |
| 交游录 | `sourcePersonId + targetPersonId + relationTypes + evidenceIds` | `time + placeIds + workIds + storyIds` | 是否有人物之间的关系或往来证据 |
| 故事卡 | `title + summary + anchorRefs + evidenceIds` | `time` | 是否能用短文本把已存在的线索讲清楚 |

不要在三种连接里再次嵌入完整 `person`、`place`、`work` 或 `storyCard` 对象；只使用 ID，避免同一故事在三处逐渐变成三个版本。

## 9. Agent 生成顺序与硬约束

Agent 不应一步生成三张图。推荐固定为四步：

```text
1. 实体识别：people / places / works
2. 证据绑定：evidence + journey / poemWorld / social connections
3. 故事卡生成：只从已有连接和证据组织摘要
4. 交叉校验：引用、状态、语义边界、重复和矛盾
```

必须写入 prompt 和 validator 的规则：

1. 每个可见连接和故事卡至少有一条 `direct` 证据；
2. 所有 `storyIds`、`workIds`、`placeId`、人物 ID 必须能在公共实体或同一卷中找到；
3. `describes-place`、`mentioned-place`、作品题名地点不能自动变成行迹；
4. 未核定年份保留年号、原文时间或 `sequence-only`，不擅自换算公元年；
5. 未消歧的地点不能 `mapEligible = true`；
6. `tradition` 和 `interpretation` 必须在卡片中显式标出，不能改写成无保留的事实口吻；
7. 故事卡不能创造它所引用的关系边；关系边必须有自己的证据；
8. 同一事实只生成一个连接和一个故事卡，通过多个 ID 引用，不重复生成近义卡；
9. 没有材料就输出空数组和 `limitations`，不要补写一段“合理的故事”。

## 10. 对黄鹤楼、长安、交游的具体落法

### 黄鹤楼

- `places` 中有一个 `huanghelou`；
- 崔颢《黄鹤楼》和李白《黄鹤楼送孟浩然之广陵》分别进入 `works`；
- 两首诗与黄鹤楼的关系进入 `poemWorld.items`；
- “李白读崔颢而搁笔”进入一张 `kind = tradition` 的地点故事卡；
- 卡片通过 `anchorRefs` 同时连接地点、两位人物和两首作品；
- 如果书中没有可靠的当事人交往证据，`social.edges` 不新增“李白—崔颢”关系边。

这会同时满足“同一地点有多首诗”和“同一地点有故事”，又不会把后世诗话误当成现场史实。

### 长安

长安不需要在 `places` 里堆一个很大的 `stories` 字段。只需要：

```text
poemWorld.spotlights[{ placeId: "changan", storyIds: [...] }]
```

这些卡片分别通过 `anchorRefs` 连接不同人物、作品和地点；如果某张卡也要出现在具体行迹点上，由 `journey.items[].storyIds` 连接。前端按地点读取并排序即可。长安故事多时只是 `storyCards` 数组变长，结构不变。

### 交游录

先生成人物关系边，再从关系边下的直接材料中生成故事卡。比如苏轼与王安石：关系边保存“政务往来 / 诗文往来”等较稳定的关系类型；金陵会面、书信、唱和各自成为独立故事卡，并分别绑定对应地点、作品和证据。

## 11. 从当前网站到新模型的映射

| 当前文件/代码 | 新模型落点 |
| --- | --- |
| `public/data/people.json` | `entities.people` |
| `public/data/places.json` | `entities.places` |
| `public/data/works.json` 与 corpus | `entities.works` |
| `public/data/events.json` | `volumes.journey.items` |
| `public/data/work-place-links.json` | `volumes.poemWorld.items` |
| `public/data/poem-world-links.json` | `volumes.poemWorld.items` 的语料投影 |
| `lib/poem-world-spotlight.ts` | `volumes.poemWorld.spotlights + storyCards` |
| `public/data/poet-social-edges.json` | `volumes.social.edges` |
| `lib/relationship-reading.ts` | `storyCards` 的关系类卡片 |
| 各处 `sourceRefs` | 私有 bundle 中的 `evidenceIds`，由 adapter 展开 |

前端仍可以暂时继续消费现有五类静态文件；新增的上传流程应先生成私有 bundle，再由一个明确的 adapter 生成私有预览 DTO。不要让上传 job 直接写 `web/public/data/`。

## 12. 实施顺序

建议按以下顺序落地：

1. 在现有 v1 校验器基础上增加顶层 `storyCards[]`、`anchorRefs` 和三卷的 `storyIds`；
2. 把黄鹤楼专题和交游阅读中的硬编码卡片迁到一个 job-local / releaseable 数据文件；
3. 统一 `evidence` 定位格式，并让三类连接共用同一套交叉引用校验；
4. 再实现 book job 的多文件接收、章节抽取和三类 candidate extractor；
5. 完成私有预览和审核后，才设计 `records → derived → public` 的发布 adapter。

## 最终判断

这套设计把复杂度压在三个地方：**实体、连接、证据**。故事卡只是连接之上的一层短叙事，不再单独发展成第四套知识库。

最终需要记住的只有一句话：

> 行迹图看“人—地—时间”，诗境图看“诗—地—语义”，交游录看“人—人—往来”；三者通过同一组作品、故事卡和证据相互照见。
