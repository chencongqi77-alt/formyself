import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(process.pid) + "-" + String(Date.now()));
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost" + path, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the viewport-fit home and three reading paths", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /诗行漫记/);
  assert.match(html, /行迹卷/);
  assert.match(html, /26 位诗人 · 152 段行迹/);
  assert.match(html, /诗境图/);
  assert.match(html, /交游录/);
  assert.match(html, /上传书籍/);
  assert.doesNotMatch(html, /东坡全集|宋史|人物卷宗|壹|贰|叁/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /react-loading-skeleton|Your site is taking shape/);
});

test("server renders the journey module loading shell", async () => {
  const response = await render("/journey");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /候选数据|archive-module-shell/);
  assert.match(html, /正在整理行迹卷/);
});

test("server renders the poem-world module loading shell", async () => {
  const response = await render("/poem-world");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /候选数据|archive-module-shell/);
  assert.match(html, /正在整理诗境图/);
});

test("server renders the social module loading shell", async () => {
  const response = await render("/social");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /候选数据|archive-module-shell/);
  assert.match(html, /正在整理交游录/);
});

test("server renders the relationship reading loading shell", async () => {
  const response = await render(
    "/social/su-shi/relationships/net-su-shi-wang-an-shi",
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /正在整理两位诗人的关系资料/);
});
