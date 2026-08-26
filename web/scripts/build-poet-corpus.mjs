import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const corpusDirectory = resolve(process.argv[2] ?? join(projectDirectory, "..", "chinese-poetry"));
const outputDirectory = join(projectDirectory, "public", "data", "corpus");

let people = [
  { id: "su-shi", name: "苏轼" },
  { id: "du-fu", name: "杜甫" },
  { id: "li-bai", name: "李白" },
  { id: "xin-qiji", name: "辛弃疾" },
  { id: "cao-cao", name: "曹操" },
  { id: "li-qingzhao", name: "李清照" },
  { id: "lu-you", name: "陆游" },
  { id: "wang-an-shi", name: "王安石" },
  { id: "ou-yang-xiu", name: "欧阳修" },
  { id: "huang-ting-jian", name: "黄庭坚" },
  { id: "qin-guan", name: "秦观" },
  { id: "yang-wan-li", name: "杨万里" },
];

let featuredTerms = {
  "su-shi": [
    "水调歌头",
    "念奴娇",
    "江城子",
    "定风波",
    "蝶恋花",
    "题西林壁",
    "惠崇春江晚景",
    "六月二十七日望湖楼醉书",
    "海棠",
    "浣溪沙",
  ],
  "du-fu": [
    "望岳",
    "春望",
    "春夜喜雨",
    "茅屋为秋风所破歌",
    "登高",
    "蜀相",
    "闻官军收河南河北",
    "绝句",
    "江畔独步寻花",
    "兵车行",
  ],
  "li-bai": [
    "静夜思",
    "将进酒",
    "蜀道难",
    "行路难",
    "望庐山瀑布",
    "早发白帝城",
    "赠汪伦",
    "黄鹤楼送孟浩然之广陵",
    "月下独酌",
    "望天门山",
  ],
  "xin-qiji": [
    "青玉案",
    "永遇乐",
    "破阵子",
    "西江月",
    "菩萨蛮",
    "水龙吟",
    "丑奴儿",
    "清平乐",
    "南乡子",
    "鹧鸪天",
  ],
  "cao-cao": [
    "观沧海",
    "龟虽寿",
    "短歌行",
    "蒿里行",
    "苦寒行",
    "度关山",
  ],
  "li-qingzhao": [
    "如梦令",
    "一剪梅",
    "醉花阴",
    "声声慢",
    "武陵春",
    "渔家傲",
    "凤凰台上忆吹箫",
    "蝶恋花",
  ],
  "lu-you": [
    "游山西村",
    "示儿",
    "书愤",
    "临安春雨初霁",
    "秋夜将晓出篱门迎凉有感",
    "十一月四日风雨大作",
    "卜算子",
    "钗头凤",
    "诉衷情",
    "关山月",
  ],
  "wang-an-shi": [
    "泊船瓜洲",
    "梅花",
    "元日",
    "登飞来峰",
    "桂枝香",
    "书湖阴先生壁",
    "江上",
  ],
  "ou-yang-xiu": [
    "蝶恋花",
    "生查子",
    "醉翁亭记",
    "踏莎行",
    "采桑子",
    "浪淘沙",
    "玉楼春",
  ],
  "huang-ting-jian": [
    "清平乐",
    "寄黄几复",
    "登快阁",
    "水调歌头",
    "虞美人",
    "雨中登岳阳楼望君山",
  ],
  "qin-guan": [
    "鹊桥仙",
    "踏莎行",
    "浣溪沙",
    "满庭芳",
    "江城子",
    "千秋岁",
    "八六子",
  ],
  "yang-wan-li": [
    "小池",
    "晓出净慈寺送林子方",
    "宿新市徐公店",
    "舟过安仁",
    "稚子弄冰",
    "过松源晨炊漆公店",
  ],
};

// Optional roster override:
//   node web/scripts/build-poet-corpus.mjs <chinese-poetry> --roster <json>
// The roster file may be the flat batch-roster shape used by the expansion
// orchestrator ({"poet-id": {"name": ..., "featured": [...]}}) or an object
// with a "people" array and optional "featuredTerms" map.  Defaults are kept
// when the roster does not replace them.
const rosterIndex = process.argv.indexOf("--roster");
if (rosterIndex !== -1) {
  const rosterPath = resolve(process.argv[rosterIndex + 1]);
  const roster = JSON.parse(readFileSync(rosterPath, "utf8"));
  const rosterPeople = Array.isArray(roster.people)
    ? roster.people
    : Object.entries(roster)
        .filter(
          ([, value]) =>
            value && typeof value === "object" && typeof value.name === "string",
        )
        .map(([id, value]) => ({
          id,
          name: value.name,
          featured: value.featured,
        }));
  if (rosterPeople.length > 0) {
    people = rosterPeople;
  }
  if (roster.featuredTerms && typeof roster.featuredTerms === "object") {
    featuredTerms = { ...featuredTerms, ...roster.featuredTerms };
  }
  for (const person of rosterPeople) {
    if (Array.isArray(person.featured)) {
      featuredTerms[person.id] = person.featured;
    }
  }
}

const sourceGroups = [
  {
    directory: "曹操诗集",
    pattern: /^caocao\.json$/,
    genre: "诗",
    author: "曹操",
  },
  {
    directory: "全唐诗",
    pattern: /^poet\.tang\.\d+\.json$/,
    genre: "诗",
  },
  {
    directory: "全唐诗",
    pattern: /^poet\.song\.\d+\.json$/,
    genre: "诗",
  },
  {
    directory: "宋词",
    pattern: /^ci\.song\.\d+\.json$/,
    genre: "词",
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function stableHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function cleanTitlePart(value) {
  return String(value ?? "")
    .replace(/[，。！？；：“”‘’、·\s]/g, "")
    .slice(0, 12);
}

function workTitle(record, genre) {
  const title = String(record.title ?? "").trim();
  if (title) return title;

  const rhythmic = String(record.rhythmic ?? (genre === "词" ? "词作" : "诗作")).trim();
  const incipit = cleanTitlePart(record.paragraphs?.[0]);
  return incipit ? `${rhythmic}·${incipit}` : rhythmic;
}

function featuredRank(personId, title) {
  const terms = featuredTerms[personId] ?? [];
  const rank = terms.findIndex((term) => title.includes(term));
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

if (!existsSync(corpusDirectory)) {
  throw new Error(`找不到古诗词语料目录：${corpusDirectory}`);
}

const personByName = new Map(people.map((person) => [person.name, person]));
const recordsByPerson = new Map(people.map((person) => [person.id, []]));
const seenByPerson = new Map(people.map((person) => [person.id, new Set()]));

for (const group of sourceGroups) {
  const directory = join(corpusDirectory, group.directory);
  const files = readdirSync(directory)
    .filter((file) => group.pattern.test(file))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));

  for (const file of files) {
    const sourcePath = join(directory, file);
    const sourceRecords = readJson(sourcePath);
    if (!Array.isArray(sourceRecords)) continue;

    sourceRecords.forEach((record, recordIndex) => {
      if (!record || typeof record !== "object") return;
      const person = personByName.get(record.author ?? group.author);
      if (!person) return;

      const text = Array.isArray(record.paragraphs)
        ? record.paragraphs.map((line) => String(line).trim()).filter(Boolean)
        : [];
      if (text.length === 0) return;

      const title = workTitle(record, group.genre);
      const duplicateKey = [group.genre, title, ...text].join("\u241f");
      const seen = seenByPerson.get(person.id);
      if (seen.has(duplicateKey)) return;
      seen.add(duplicateKey);

      const sourceFile = relative(corpusDirectory, sourcePath).replaceAll("\\", "/");
      const upstreamRecordId =
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : stableHash(`${sourceFile}:${recordIndex}:${title}:${text.join("")}`);

      recordsByPerson.get(person.id).push({
        id: `corpus-${person.id}-${upstreamRecordId}`,
        personId: person.id,
        title,
        genre: group.genre,
        text,
        sourceRecord: {
          sourceId: "chinese-poetry",
          file: sourceFile,
          recordId: upstreamRecordId,
          recordKey: `/${recordIndex}`,
        },
        libraryStatus: "corpus",
      });
    });
  }
}

mkdirSync(outputDirectory, { recursive: true });

const peopleIndex = {};
for (const person of people) {
  const works = recordsByPerson.get(person.id);
  works.sort(
    (a, b) =>
      featuredRank(person.id, a.title) - featuredRank(person.id, b.title) ||
      a.title.localeCompare(b.title, "zh-CN") ||
      a.id.localeCompare(b.id),
  );

  writeFileSync(
    join(outputDirectory, `${person.id}.json`),
    `${JSON.stringify(works, null, 2)}\n`,
    "utf8",
  );

  peopleIndex[person.id] = {
    name: person.name,
    total: works.length,
    poems: works.filter((work) => work.genre === "诗").length,
    lyrics: works.filter((work) => work.genre === "词").length,
  };
}

const source = {
  id: "chinese-poetry",
  title: "chinese-poetry 古诗词数据集",
  sourceType: "dataset",
  sourceUrl: "https://github.com/chinese-poetry/chinese-poetry",
  license: "MIT",
  licenseUrl: "https://github.com/chinese-poetry/chinese-poetry/blob/master/LICENSE",
  attribution: "chinese-poetry contributors",
  snapshot: {
    algorithm: "sha256",
    digest: "ef51712df1329f1bc7c4c2bdcc4e1639c81a4c48c46cf1042b9f82ff4b1c8263",
  },
};

writeFileSync(
  join(outputDirectory, "index.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1.0.0",
      source,
      people: peopleIndex,
      total: Object.values(peopleIndex).reduce((sum, person) => sum + person.total, 0),
      notes: [
        "全集索引按原始数据的作者字段精确提取。",
        "保留异题、重出与版本条目，不把全集条目自动绑定为确定的人生地点或写作年代。",
        "地图中的地点关联仍仅使用已核对的精选作品。",
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

writeFileSync(join(outputDirectory, "source.json"), `${JSON.stringify(source, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      outputDirectory,
      people: peopleIndex,
      total: Object.values(peopleIndex).reduce((sum, person) => sum + person.total, 0),
    },
    null,
    2,
  ),
);
