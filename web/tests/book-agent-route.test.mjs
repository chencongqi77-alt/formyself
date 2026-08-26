import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(process.pid) + "-" + String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost" + path, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders the private book-agent workbench", async () => {
  const response = await render("/agent");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /site-shell module-page/);
  assert.match(html, /上传书籍，提取可核对的诗人线索/);
  assert.match(html, /从原文中提取人物、地点、作品和交游线索/);
  assert.match(html, /开始全自动分析/);
  assert.match(html, /启用大模型增强/);
  assert.match(html, /模型只产出待审核候选/);
  assert.doesNotMatch(html, /AGENT WORKBENCH · PRIVATE DRAFT/);
  assert.doesNotMatch(html, /上传书籍，自动整理三卷候选/);
  assert.doesNotMatch(html, /私有 job/);
  assert.doesNotMatch(html, /不会写入现有 public\/data/);
  assert.doesNotMatch(html, /接收与校验/);
  assert.doesNotMatch(html, /自动校验/);
});

test("private book views reuse the public reading shell and stage components", async () => {
  const [privateViews, agentPage, agentStyles, publicPoemWorld, publicWorkPage, workReadingTemplate] = await Promise.all([
    readFile(new URL("../app/components/BookAgentPrivateViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/agent/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/agent.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/poem-world/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/works/[workId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/WorkReadingTemplate.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(privateViews, /ReadingModuleHeader/);
  assert.match(privateViews, /<JourneyStage/);
  assert.match(privateViews, /<ContextAtlasStage/);
  assert.match(privateViews, /<SocialGraphStage/);
  assert.match(privateViews, /detail-page-content--works/);
  assert.match(privateViews, /open-works-button/);
  assert.match(privateViews, /PoemWorldWorkCard/);
  assert.match(privateViews, /PoetOverviewPanel/);
  assert.match(privateViews, /RelationshipStoryPanel/);
  assert.match(privateViews, /poemWorldMarkerVisual/);
  assert.match(privateViews, /关系边仅来自上传书籍中可回读的原文候选/);
  assert.match(privateViews, /socialReferenceEdges/);
  assert.doesNotMatch(privateViews, /cbdb-reference/);
  assert.doesNotMatch(privateViews, /visibleReferenceEdges/);
  assert.match(privateViews, /WorkReadingTemplate/);
  assert.match(privateViews, /private-work-reading-shell/);
  assert.match(publicWorkPage, /WorkReadingTemplate/);
  assert.match(workReadingTemplate, /work-reading-hero/);
  assert.match(workReadingTemplate, /work-reading-poem/);
  assert.match(workReadingTemplate, /reading-place-relation/);
  assert.doesNotMatch(privateViews, /ReferenceWorksList/);
  assert.doesNotMatch(privateViews, /privateModuleCanvas|privateViewPanel/);

  assert.match(publicPoemWorld, /PoemWorldWorkCard/);

  assert.match(agentPage, /site-shell agent-preview-shell/);
  assert.match(agentStyles, /\.privatePreviewStage\s*{\s*display:\s*contents;/);
  assert.doesNotMatch(agentStyles, /\.privateModuleCanvas\s+\.journey-stage/);
  assert.doesNotMatch(agentStyles, /\.privateModuleCanvas\s+\.social-layout/);
});

test("private journey and poetry previews keep the public interaction model", async () => {
  const privateViews = await readFile(
    new URL("../app/components/BookAgentPrivateViews.tsx", import.meta.url),
    "utf8",
  );

  assert.match(privateViews, /journeyRouteStops/);
  assert.match(privateViews, /groupJourneyStations/);
  assert.match(privateViews, /journey-traveler/);
  assert.match(privateViews, /onRouteRecordSelect/);
  assert.match(privateViews, /横向浏览 · \{stations\.length\} 站/);
  assert.match(privateViews, /同一地点的关联候选/);
  assert.match(privateViews, /<strong>\{place\?\.label \?\? "地点待补充"\}<\/strong>/);
  assert.match(privateViews, /PrivateWorkReader/);
  assert.match(privateViews, /backLabel="返回地点诗词"/);
  assert.match(privateViews, /work-reading-shell private-work-reading-shell/);
  assert.match(privateViews, /onOpenReader/);
  assert.match(privateViews, /result\.sourceText/);
  assert.doesNotMatch(privateViews, /private-candidate-reader/);
  assert.doesNotMatch(privateViews, /站内作品 · Agent 内阅读/);
  assert.doesNotMatch(privateViews, /href: "\/works\/" \+ encodeURIComponent\(work\.id\)/);
  assert.doesNotMatch(privateViews, /<Link className="work-entry"/);
  assert.doesNotMatch(
    privateViews,
    /<article className="work-entry" aria-label=\{`查看《\$\{work\.title\}》的私有阅读资料`\}>/,
  );
});
