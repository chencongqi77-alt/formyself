import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PUBLIC_MODULE_PERSON_ID,
  resolvePublicModulePerson,
} from "../lib/public-module-person.ts";

const people = [
  { id: "bai-ju-yi", name: "白居易" },
  { id: "su-shi", name: "苏轼" },
];

test("public historical modules default to Su Shi instead of the first person", () => {
  assert.equal(DEFAULT_PUBLIC_MODULE_PERSON_ID, "su-shi");
  assert.equal(resolvePublicModulePerson(people, undefined)?.id, "su-shi");
  assert.equal(resolvePublicModulePerson(people, "unknown")?.id, "su-shi");
});

test("an explicit valid public person remains selected", () => {
  assert.equal(
    resolvePublicModulePerson(people, "bai-ju-yi")?.id,
    "bai-ju-yi",
  );
});
