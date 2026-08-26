import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL(
  "../app/components/GraphZoomControls.tsx",
  import.meta.url,
);
test("social graph controls expose only explicit zoom buttons", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.equal([...source.matchAll(/<button\b/g)].length, 2);
  assert.doesNotMatch(source, /onReset/);
  assert.doesNotMatch(source, /复位视图/);
});
