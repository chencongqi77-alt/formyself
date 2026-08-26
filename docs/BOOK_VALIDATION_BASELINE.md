# 书籍验证基线：私有三卷候选包

## 本次决策

这不是“上传书籍”功能的上线实现，也不实际运行《东坡全集》的解析。
本次只建立一个可复用、可校验的离线基础层：

1. 把目录型书籍表示为有稳定顺序、逐文件哈希和结构提示的私有书籍包；
2. 为一个诗人的“行迹图、诗境图、交游录”定义统一的私有候选展示契约；
3. 为二者提供不触碰公共数据的构建、校验和测试脚本。

这样后续优化三卷的抽取逻辑、叙事方式和前端表现时，不会被一次性的上传接口或现有静态页面数据形状锁定。

《东坡全集》是首个**验证样本**，不是本次运行任务。受治理来源为
`kanripo-kr4d0076`，正文由 `KR4d0076_000.txt` 至
`KR4d0076_115.txt` 组成；`000` 卷含本传、墓志铭、年谱等适合验证行迹
线索的结构材料，后续分卷可验证作品与交游线索。脚本、测试和文档均不会
生成该书的实际候选结果。

## 安全边界与落点

所有新工件只允许位于拥有它的私有 job：

```text
var/jobs/<job-id>/
  job.json
  00-intake/book-package-manifest.json
  08-map/private-poet-volume-bundle.json
```

生成书籍包时，拥有它的 job 必须显式声明
`input.kind = "ordered-package-pending"`。这是一个防误用锚点：当前
`poet-map-job` 是单一 blob 合同，因此脚本会拒绝把目录型书籍包附着到它上面。
完整的 book-job 初始化器仍属于下一阶段工作。

在 book-job 初始化器落地前，最小锚点的形状如下（它不是完整 job 合同，也不会
触发处理）：

```json
{
  "jobId": "bmj-dongpo-validation",
  "input": { "kind": "ordered-package-pending" }
}
```

- 书籍包清单只保存相对路径、大小、哈希和少量显式章节提示；不保存绝对路径、原书正文、提示词或模型响应。
- 三卷候选包只保存证据定位、候选实体和受证据约束的展示说明；它不是事实库，也不能直接进入 `data/records/`、`data/derived/`、`data/published/` 或 `web/public/data/`。
- 脚本拒绝越出 job 根目录的输出、符号链接成员、空成员和已有输出；没有 `--force`。
- 任何模型、OCR 或标题匹配的结果仍是 candidate。它们需要可回读的证据、审核和独立 release 才能成为公开内容。

## 新增的两个契约

### 1. `book-package-manifest`

文件：`data/contracts/book-package-manifest.schema.json`。

它描述一个“有序目录型书籍包”，关键字段包括：

- `members[]`：每个正文成员的 POSIX 相对路径、原始字节 SHA-256、大小和序号；
- `packageSha256`：将 **序号 + 路径 + 大小 + 成员哈希** 顺序编码后的集合摘要，因此调换成员顺序也会改变摘要；
- `sectionHints[]`：只识别明确标记的 Org/Kanripo `#+TITLE:`、`#+PROPERTY: JUAN` 和 Markdown 标题。它们仅用于导航，不是作者、作品或历史事实判断；
- `selection`：记录本次允许的扩展名和排除数量，避免 `Readme.org` 一类目录页被静默当作正文。

初版顺序固定为 `relative-path-lexicographic-v1`，即 POSIX 相对路径字典序。不做
“2 一定在 10 前面”之类的猜测。《东坡全集》的文件名已零填充，恰好符合这个规则；
未来遇到未编码阅读顺序的档案，必须新增经过审核的显式顺序清单，而不是改用启发式排序。

### 2. `private-poet-volume-bundle`

文件：`data/contracts/private-poet-volume-bundle.schema.json`。

它是 job 内 `08-map/` 的私有投影，统一容纳三卷：

```text
证据（evidence）
  ├─ 行迹图：地点、行迹谓词、时间/顺序候选
  ├─ 诗境图：作品—地点链接，或不落点的场景说明
  └─ 交游录：人物关系边，以及绑定关系边的故事卡
```

所有可见条目都必须至少引用一条 `direct` 证据。地点、作品、人物和条目间的
引用都在校验器中检查；未消歧地点可以被保留为候选，但不能标记为可上图。

三卷总会出现，并各自显式标示 `ready`、`empty`、`not-run` 或 `blocked`。这样
“尚未实现诗境/交游”是可读的状态，而不是暗中缺字段。

### 交游“小故事”的约束

`storyCards[]` 的 `kind` 固定为 `source-bound-reading-note`。它是带来源的阅读说明，
不是一条独立历史事实：

- 卡片必须绑定一条交游边，且卡片的证据必须是该边证据的子集；
- 它只能处于私有候选审核状态，不能使用 `published`、`released` 或 `public`；
- 摘要不得只基于模型生成；审核者应能从 `sourceFileId + locator` 回到书内材料；
- 将来如要成为公开事实，必须先建立专门的人物—人物关系 assertion 契约。现有
  `poet-fact-package` 尚没有该谓词，不能把关系硬塞进自由文本 qualifier。

下一版三卷公共模型的设计见 [`THREE_MAP_DATA_MODEL.md`](THREE_MAP_DATA_MODEL.md)。该设计保留本文件的私有 job、证据优先和显式审核边界，只把故事卡从交游卷提升为三卷共享层。

## 已有能力如何衔接

可直接复用的基础设施：

- `poet_map_job.py` 的私有 job 目录、阶段工件、SHA-256 和原子 JSON 写入；
- 受治理来源的快照、版权/质量审核以及 `source-materials` 只读边界；
- 现有 fact package 的“证据先于投影”原则和行迹/文学地点受控谓词；
- 现有三套前端在地图、诗词和社交图上的表现组件，作为后续私有 adapter 的视觉参考。

不能直接复用、必须后续实现的部分：

1. **书籍 job 与上传服务**：当前 `poet-map-job` 的 `input` 是单一 blob，
   `extract_biography_text.py` 也只认识单一 quarantine receipt；它不能被伪装成多文件书籍输入。
2. **package-aware extractor**：读取书籍清单、提取章节/页/字符定位，并派生一个诗人一个子 job；
   子 job 的三卷包通过 `packageOwnerJobId` 回指父书籍包，而不是复制原书。
3. **实体与关系解析**：人物识别/消歧、作品识别、历史地名消歧、人物—人物关系 assertion。
4. **三类 candidate extractor**：行迹、诗境和交游必须分别产出证据，不能从一种结果反推另一种。
5. **私有预览 adapter 与审核界面**：现有 `/journey`、`/poem-world`、`/social` 直接读取全局静态 JSON，
   不可直接消费本契约，更不能将其写入公开数据。
6. **review → records → release exporter**：用户上传默认不能自动公开。

## 分阶段实施规划

| 阶段 | 目标 | 产物 | 发布边界 |
| --- | --- | --- | --- |
| 0（本次） | 固化输入与私有候选契约 | 书籍包清单、三卷候选包、校验器、测试 | 仅 `var/jobs` |
| 1 | 引入真正的 book job 和上传接收 | package-aware intake、格式 adapter、进度/失败状态 | 仅私有 job |
| 2 | 生成可审核候选 | 人/地/作品/关系候选与精确证据定位 | 仅私有 job |
| 3 | 做三卷私有预览 | bundle → 私有 DTO adapter、阅读与审核 UI | 不接触现有公开路由 |
| 4 | 审核和发布 | relation assertion、records、release manifest、exporter | 显式人工 release 后才可公开 |

在阶段 2 中建议先对《东坡全集》按以下顺序做人工抽样验证：

1. `KR4d0076_000.txt`：验证传记性行迹证据的定位；
2. 含诗文的分卷：验证作品候选和诗境的“作品—地点”不等于行迹；
3. 含“与、寄、赠、答、怀”等交往材料的分卷：验证关系边和故事卡必须同证据回读。

这不是要求自动相信这些词，而是为审核界面提供高价值的候选集。

## 脚本与验证方式

```powershell
# 目录型书籍的私有清单；job.json 必须已存在。
python scripts/build_book_package_manifest.py `
  --job var/jobs/<job-id>/job.json `
  --input-root source-materials/open/kanripo/kanripo-kr4d0076 `
  --book-id dongpo-quanji --book-title "东坡全集" `
  --source-id kanripo-kr4d0076 --dry-run

# 校验一个已经生成的书籍包清单。
python scripts/validate_book_package_manifest.py `
  --manifest var/jobs/<job-id>/00-intake/book-package-manifest.json

# 校验私有三卷候选包及其引用的书籍包清单。
python scripts/validate_private_volume_bundle.py `
  --bundle var/jobs/<job-id>/08-map/private-poet-volume-bundle.json `
  --source-manifest var/jobs/<job-id>/00-intake/book-package-manifest.json
```

本次不会执行上面的《东坡全集》命令；`--dry-run` 仅用于未来人工检查输出位置和摘要。

验收基线是：所有新增单元测试通过；书籍包和三卷包都能拒绝越界、篡改、未知字段、
缺失证据、无效交叉引用和任何公开状态；公开数据校验保持不变。
