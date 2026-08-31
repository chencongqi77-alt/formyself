import {
  analyzeBook,
  getBookAnalysisSegments,
  mergeBookAgentModelResult,
  type BookAgentCatalogs,
  type BookAgentModelOutput,
  type BookAgentModelMeta,
  type BookAnalysisSegment,
  type JourneyItem,
  type PoemWorldItem,
  type SocialEdge,
} from "./book-agent.ts";

export interface BookAgentRuntimeEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  [key: string]: unknown;
}

type ModelProvider = "deepseek" | "openai" | "compatible";

interface ModelConfig {
  provider: ModelProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface AnalyzeRequestBody {
  text: string;
  fileName: string;
  bookTitle: string;
  poetName: string;
  fileSha256: string;
  catalogs: BookAgentCatalogs;
}

const MAX_BOOK_CHARS = 800_000;
const MODEL_WINDOW_CHARS = 7_500;
const MAX_MODEL_WINDOWS = 32;
const MODEL_TIMEOUT_MS = 55_000;
const MODEL_OUTPUT_TOKENS = 5_000;
const MODEL_RETRY_OUTPUT_TOKENS = 8_000;

const JOURNEY_PREDICATES: JourneyItem["predicate"][] = [
  "born-at",
  "died-at",
  "resided-at",
  "visited",
  "traveled-to",
  "held-office-at",
  "exiled-to",
  "studied-at",
  "stayed-at",
];

const POEM_RELATIONS: NonNullable<PoemWorldItem["relationType"]>[] = [
  "composed-at",
  "inscribed-at",
  "describes-place",
  "mentioned-place",
];

const SOCIAL_RELATIONS: SocialEdge["relationTypes"][number][] = [
  "kin",
  "literary-exchange",
  "official",
  "teacher-student",
  "friendship",
  "other",
];

const MODEL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          segmentIds: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        required: ["name", "aliases", "segmentIds", "note"],
      },
    },
    places: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          historicalNames: { type: "array", items: { type: "string" } },
          segmentIds: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        required: ["name", "historicalNames", "segmentIds", "note"],
      },
    },
    works: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          authorName: { type: ["string", "null"] },
          segmentIds: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        required: ["title", "authorName", "segmentIds", "note"],
      },
    },
    journey: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          personName: { type: "string" },
          placeName: { type: "string" },
          predicate: { enum: JOURNEY_PREDICATES },
          timeLabel: { type: ["string", "null"] },
          segmentIds: { type: "array", items: { type: "string" } },
          storyTitle: { type: "string" },
          storySummary: { type: "string" },
        },
        required: ["personName", "placeName", "predicate", "timeLabel", "segmentIds", "storyTitle", "storySummary"],
      },
    },
    poemWorld: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          workTitle: { type: "string" },
          placeName: { type: "string" },
          relationType: { enum: POEM_RELATIONS },
          segmentIds: { type: "array", items: { type: "string" } },
          storyTitle: { type: "string" },
          storySummary: { type: "string" },
        },
        required: ["workTitle", "placeName", "relationType", "segmentIds", "storyTitle", "storySummary"],
      },
    },
    social: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourcePersonName: { type: "string" },
          targetPersonName: { type: "string" },
          relationTypes: { type: "array", items: { enum: SOCIAL_RELATIONS } },
          placeNames: { type: "array", items: { type: "string" } },
          workTitles: { type: "array", items: { type: "string" } },
          segmentIds: { type: "array", items: { type: "string" } },
          storyTitle: { type: "string" },
          storySummary: { type: "string" },
        },
        required: ["sourcePersonName", "targetPersonName", "relationTypes", "placeNames", "workTitles", "segmentIds", "storyTitle", "storySummary"],
      },
    },
  },
  required: ["people", "places", "works", "journey", "poemWorld", "social"],
} as const;

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

function segmentIdArray(value: unknown): string[] {
  return stringArray(value).filter((value) => /^seg-\d+$/.test(value));
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function normalizeModelOutput(value: unknown): BookAgentModelOutput {
  const root = recordValue(value);
  const parsePeople = Array.isArray(root.people) ? root.people.map((item) => {
    const record = recordValue(item);
    return {
      name: textValue(record.name),
      aliases: stringArray(record.aliases),
      segmentIds: segmentIdArray(record.segmentIds),
      note: textValue(record.note),
    };
  }).filter((item) => item.name && item.segmentIds.length) : [];
  const parsePlaces = Array.isArray(root.places) ? root.places.map((item) => {
    const record = recordValue(item);
    return {
      name: textValue(record.name),
      historicalNames: stringArray(record.historicalNames),
      segmentIds: segmentIdArray(record.segmentIds),
      note: textValue(record.note),
    };
  }).filter((item) => item.name && item.segmentIds.length) : [];
  const parseWorks = Array.isArray(root.works) ? root.works.map((item) => {
    const record = recordValue(item);
    return {
      title: textValue(record.title),
      authorName: record.authorName === null ? null : textValue(record.authorName),
      segmentIds: segmentIdArray(record.segmentIds),
      note: textValue(record.note),
    };
  }).filter((item) => item.title && item.segmentIds.length) : [];
  const journey = Array.isArray(root.journey) ? root.journey.map((item) => {
    const record = recordValue(item);
    return {
      personName: textValue(record.personName),
      placeName: textValue(record.placeName),
      predicate: enumValue(record.predicate, JOURNEY_PREDICATES, "visited"),
      timeLabel: record.timeLabel === null ? null : textValue(record.timeLabel) || null,
      segmentIds: segmentIdArray(record.segmentIds),
      storyTitle: textValue(record.storyTitle),
      storySummary: textValue(record.storySummary),
    };
  }).filter((item) => item.personName && item.placeName && item.segmentIds.length) : [];
  const poemWorld = Array.isArray(root.poemWorld) ? root.poemWorld.map((item) => {
    const record = recordValue(item);
    return {
      workTitle: textValue(record.workTitle),
      placeName: textValue(record.placeName),
      relationType: enumValue(record.relationType, POEM_RELATIONS, "mentioned-place"),
      segmentIds: segmentIdArray(record.segmentIds),
      storyTitle: textValue(record.storyTitle),
      storySummary: textValue(record.storySummary),
    };
  }).filter((item) => item.workTitle && item.placeName && item.segmentIds.length) : [];
  const social = Array.isArray(root.social) ? root.social.map((item) => {
    const record = recordValue(item);
    return {
      sourcePersonName: textValue(record.sourcePersonName),
      targetPersonName: textValue(record.targetPersonName),
      relationTypes: stringArray(record.relationTypes).filter((value): value is SocialEdge["relationTypes"][number] => SOCIAL_RELATIONS.includes(value as SocialEdge["relationTypes"][number])),
      placeNames: stringArray(record.placeNames),
      workTitles: stringArray(record.workTitles),
      segmentIds: segmentIdArray(record.segmentIds),
      storyTitle: textValue(record.storyTitle),
      storySummary: textValue(record.storySummary),
    };
  }).filter((item) => item.sourcePersonName && item.targetPersonName && item.segmentIds.length) : [];
  return { people: parsePeople, places: parsePlaces, works: parseWorks, journey, poemWorld, social };
}

interface ModelResponseOutput {
  text: string;
  status: string;
  finishReason: string;
  refusal: string;
}

function contentPartText(value: unknown): string {
  if (typeof value === "string") return value;
  const part = recordValue(value);
  const type = textValue(part.type);
  if (type && type !== "text" && type !== "output_text") return "";
  if (typeof part.text === "string") return part.text;
  const nestedText = recordValue(part.text);
  return typeof nestedText.value === "string" ? nestedText.value : "";
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map(contentPartText).join("").trim();
}

function modelOutputFromResponse(value: unknown): ModelResponseOutput {
  const root = recordValue(value);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = recordValue(choices[0]);
  const message = recordValue(firstChoice.message);
  const incompleteDetails = recordValue(root.incomplete_details);
  const finishReason = textValue(firstChoice.finish_reason) || textValue(incompleteDetails.reason);
  const status = textValue(root.status) || textValue(firstChoice.status);
  const refusal = textValue(message.refusal);
  const rootText = contentText(root.output_text);
  const messageText = contentText(message.content);
  if (rootText || messageText) return { text: rootText || messageText, status, finishReason, refusal };

  const output = Array.isArray(root.output) ? root.output : [];
  const outputParts: string[] = [];
  for (const item of output) {
    const content = recordValue(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      outputParts.push(contentPartText(part));
    }
  }
  return { text: outputParts.join("").trim(), status, finishReason, refusal };
}

function modelResponseFailure(output: ModelResponseOutput): Error {
  const diagnostics = [
    output.status ? `status=${output.status}` : "",
    output.finishReason ? `finish_reason=${output.finishReason}` : "",
  ].filter(Boolean).join("，");
  if (output.finishReason === "length" || output.finishReason === "max_output_tokens") {
    return new Error(`模型输出达到 token 上限，未生成完整文本${diagnostics ? `（${diagnostics}）` : ""}`);
  }
  if (output.refusal) {
    return new Error(`模型拒绝生成分析结果${diagnostics ? `（${diagnostics}）` : ""}`);
  }
  return new Error(`模型服务没有返回文本结果${diagnostics ? `（${diagnostics}）` : ""}`);
}

function parseJsonObject(text: string): unknown {
  const clean = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("模型没有返回可解析的 JSON。 ");
  }
}

function envString(env: BookAgentRuntimeEnv, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function modelConfig(env: BookAgentRuntimeEnv): ModelConfig | null {
  const genericKey = envString(env, "LLM_API_KEY");
  if (genericKey) {
    return {
      provider: "compatible",
      apiKey: genericKey,
      model: envString(env, "LLM_MODEL") || "deepseek-chat",
      baseUrl: (envString(env, "LLM_BASE_URL") || "https://api.deepseek.com").replace(/\/+$/, ""),
    };
  }
  const deepSeekKey = envString(env, "DEEPSEEK_API_KEY");
  if (deepSeekKey) {
    return {
      provider: "deepseek",
      apiKey: deepSeekKey,
      model: envString(env, "DEEPSEEK_MODEL") || "deepseek-chat",
      baseUrl: (envString(env, "DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/+$/, ""),
    };
  }
  const openAiKey = envString(env, "OPENAI_API_KEY");
  if (openAiKey) {
    return {
      provider: "openai",
      apiKey: openAiKey,
      model: envString(env, "OPENAI_MODEL") || "gpt-5.2",
      baseUrl: (envString(env, "OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""),
    };
  }
  return null;
}

export function getBookAgentModelStatus(env: BookAgentRuntimeEnv): { configured: boolean; provider: string; model: string } {
  const config = modelConfig(env);
  return {
    configured: Boolean(config),
    provider: config?.provider ?? "local-only",
    model: config?.model ?? "规则分析器",
  };
}

function compactCatalogHints(catalogs: BookAgentCatalogs, text: string): string {
  const contains = (value: string): boolean => Boolean(value) && text.includes(value);
  const people = catalogs.people.filter((item) => contains(item.name) || (item.aliases ?? []).some(contains)).map((item) => item.name).slice(0, 80);
  const places = catalogs.places.filter((item) => contains(item.name) || (item.historicalNames ?? []).some(contains)).map((item) => item.name).slice(0, 100);
  const works = catalogs.works.filter((item) => contains(item.title)).map((item) => item.title).slice(0, 100);
  return JSON.stringify({ people, places, works }, null, 2);
}

function makePrompt(bookTitle: string, poetName: string, segments: BookAnalysisSegment[], catalogs: BookAgentCatalogs): string {
  const segmentText = segments.map((segment) => `[${segment.id}] ${segment.text}`).join("\n");
  return `书名：${bookTitle}\n中心人物：${poetName}\n\n你正在分析一本中文古籍/诗人书籍的局部原文。只根据下面给出的原文片段提取候选，不要利用片段外的常识补写事实。\n\n硬性规则：\n1. 每个候选都必须填写至少一个真实存在的 segmentId；segmentId 必须原样复制方括号中的值。\n2. 如果证据不足，就不要输出该候选；不要把推测当成事实。\n3. 可以输出目录之外的候选，但要保留原文中的名称，不要擅自现代化或消歧。\n4. 本次只分析中心人物 ${poetName}：journey.personName 必须是中心人物或其原文别名；poemWorld 只收中心人物创作的作品；social 必须至少有一端是中心人物。与中心人物候选无关的其他人物、作品和地点不要单独输出。\n5. 行迹只在片段明确表达中心人物与地点的生平动作时输出；不得把其他人物的动作归给中心人物。\n6. 同一句包含多个“人物 + 动作 + 地点”时，必须逐项配对，不得把第一个人物或动作套给句内其他地点。\n7. predicate 语义必须区分：游历、游于、过访、拜访用 visited；抵达、到达、前往、行至用 traveled-to；寓居等用 resided-at；生于等用 born-at。\n8. 诗境只在片段同时支持中心人物作品与地点语义时输出；同句出现多部作品时，地点必须绑定最近且语义对应的作品；作品地点不等于人物到访。\n9. 交游只在同一原文片段明确同时提到中心人物、另一人物及二人之间的往来、师生、同僚、赠答或友谊时输出；不得仅因两人同现、常识、目录或 CBDB 资料补出关系，也不要对同句人物任意两两配对。\n10. social 的 storySummary 必须只概括该 segmentId 对应的原文线索；不能写入原文没有表达的关系事实。\n\n本窗口内已匹配到的 canonical 名称（仅作对照，不限制你发现新候选）：\n${compactCatalogHints(catalogs, segments.map((segment) => segment.text).join(""))}\n\n原文片段：\n${segmentText}\n\n请严格返回 JSON，不要 Markdown，不要解释。顶层必须包含 people、places、works、journey、poemWorld、social 六个数组。`;
}

async function callModel(config: ModelConfig, prompt: string): Promise<BookAgentModelOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const isOpenAi = config.provider === "openai";
    const url = isOpenAi ? `${config.baseUrl}/responses` : `${config.baseUrl}/chat/completions`;
    let lastOutput: ModelResponseOutput = { text: "", status: "", finishReason: "", refusal: "" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const maxOutputTokens = attempt === 0 ? MODEL_OUTPUT_TOKENS : MODEL_RETRY_OUTPUT_TOKENS;
      const body = isOpenAi
        ? {
            model: config.model,
            instructions: "你是严格的古籍知识抽取器。输出必须可被 JSON Schema 校验；不要输出分析过程。",
            input: prompt,
            reasoning: { effort: "low" },
            max_output_tokens: maxOutputTokens,
            store: false,
            text: {
              format: {
                type: "json_schema",
                name: "book_agent_extract",
                strict: true,
                schema: MODEL_OUTPUT_SCHEMA,
              },
            },
          }
        : {
            model: config.model,
            messages: [
              { role: "system", content: "你是严格的古籍知识抽取器。只返回 JSON，不要输出分析过程。" },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_tokens: maxOutputTokens,
            response_format: { type: "json_object" },
            ...(config.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}),
          };
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`模型服务返回 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
      }
      let payload: unknown;
      try {
        payload = await response.json() as unknown;
      } catch {
        throw new Error("模型服务返回 HTTP 200，但响应不是可解析的 JSON");
      }
      lastOutput = modelOutputFromResponse(payload);
      const incomplete = lastOutput.finishReason === "length"
        || lastOutput.finishReason === "max_output_tokens"
        || lastOutput.status === "incomplete";
      if (lastOutput.text && !incomplete) return normalizeModelOutput(parseJsonObject(lastOutput.text));
      if (attempt === 0) continue;
      throw modelResponseFailure(lastOutput);
    }
    throw modelResponseFailure(lastOutput);
  } finally {
    clearTimeout(timeout);
  }
}

function chunkSegments(segments: BookAnalysisSegment[]): BookAnalysisSegment[][] {
  const chunks: BookAnalysisSegment[][] = [];
  let current: BookAnalysisSegment[] = [];
  let currentLength = 0;
  for (const segment of segments) {
    const nextLength = currentLength + segment.text.length + 20;
    if (current.length && nextLength > MODEL_WINDOW_CHARS) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(segment);
    currentLength += segment.text.length + 20;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function runModelPass(config: ModelConfig, input: AnalyzeRequestBody): Promise<{ output: BookAgentModelOutput; chunkCount: number; candidateCount: number; warning?: string }> {
  const segments = getBookAnalysisSegments(input.text);
  const chunks = chunkSegments(segments);
  const selectedChunks = chunks.slice(0, MAX_MODEL_WINDOWS);
  const outputs: BookAgentModelOutput[] = [];
  const failures: string[] = [];
  for (const chunk of selectedChunks) {
    try {
      outputs.push(await callModel(config, makePrompt(input.bookTitle, input.poetName, chunk, input.catalogs)));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "unknown-model-error");
    }
  }
  if (!outputs.length) throw new Error(failures[0] || "模型分析没有成功完成");
  const output: BookAgentModelOutput = {
    people: outputs.flatMap((item) => item.people),
    places: outputs.flatMap((item) => item.places),
    works: outputs.flatMap((item) => item.works),
    journey: outputs.flatMap((item) => item.journey),
    poemWorld: outputs.flatMap((item) => item.poemWorld),
    social: outputs.flatMap((item) => item.social),
  };
  const candidateCount = Object.values(output).reduce((total, items) => total + items.length, 0);
  const warningParts = [];
  if (chunks.length > selectedChunks.length) warningParts.push(`文本过长，模型本次处理前 ${selectedChunks.length}/${chunks.length} 个窗口`);
  if (failures.length) warningParts.push(`${failures.length} 个窗口调用失败，已合并成功窗口`);
  return { output, chunkCount: selectedChunks.length, candidateCount, warning: warningParts.length ? warningParts.join("；") : undefined };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function validCatalogs(value: unknown): value is BookAgentCatalogs {
  const root = value as Record<string, unknown> | null;
  return Boolean(root && Array.isArray(root.people) && Array.isArray(root.places) && Array.isArray(root.works));
}

function parseAnalyzeBody(value: unknown): AnalyzeRequestBody | null {
  const body = value as Partial<AnalyzeRequestBody> | null;
  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_BOOK_CHARS) return null;
  if (typeof body.fileName !== "string" || typeof body.bookTitle !== "string" || typeof body.poetName !== "string") return null;
  if (typeof body.fileSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(body.fileSha256) || !validCatalogs(body.catalogs)) return null;
  return {
    text: body.text,
    fileName: body.fileName.slice(0, 300),
    bookTitle: body.bookTitle.slice(0, 300),
    poetName: body.poetName.slice(0, 200),
    fileSha256: body.fileSha256,
    catalogs: body.catalogs,
  };
}

export async function handleBookAgentApi(request: Request, env: BookAgentRuntimeEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/agent/status" && request.method === "GET") {
    return jsonResponse(getBookAgentModelStatus(env));
  }
  if (url.pathname !== "/api/agent/analyze") return jsonResponse({ error: "Not found" }, 404);
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const config = modelConfig(env);
  if (!config) return jsonResponse({ error: "当前环境没有配置大模型 API key。" }, 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "请求 JSON 无法解析。" }, 400);
  }
  const input = parseAnalyzeBody(body);
  if (!input) return jsonResponse({ error: "分析请求缺少必要字段，或文本超过 800000 字符。" }, 400);
  try {
    const baseline = await analyzeBook(input);
    const modelPass = await runModelPass(config, input);
    const analysis = await mergeBookAgentModelResult(baseline, modelPass.output, input.catalogs);
    const model: BookAgentModelMeta = {
      engine: "llm-hybrid",
      provider: config.provider,
      model: config.model,
      chunkCount: modelPass.chunkCount,
      candidateCount: modelPass.candidateCount,
      warning: modelPass.warning,
    };
    analysis.model = model;
    return jsonResponse({ analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型分析失败。";
    return jsonResponse({ error: `大模型分析失败：${message}` }, 502);
  }
}
