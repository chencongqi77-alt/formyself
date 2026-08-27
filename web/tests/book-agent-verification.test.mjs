import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const verificationModuleUrl = new URL("../lib/book-agent-verification.ts", import.meta.url);
const bookAgentModuleUrl = new URL("../lib/book-agent.ts", import.meta.url);
const verificationTypeScript = await readFile(verificationModuleUrl, "utf8");
const verificationJavaScript = stripTypeScriptTypes(
  verificationTypeScript.replace(
    'from "./book-agent";',
    `from ${JSON.stringify(bookAgentModuleUrl.href)};`,
  ),
  { mode: "transform", sourceUrl: verificationModuleUrl.href },
);
const {
  applyAutomaticVerificationPolicy,
  assessBookRelationships,
  summarizeVerification,
  updateVerificationDecision,
  updateVerificationRelationType,
} = await import(`data:text/javascript;base64,${Buffer.from(verificationJavaScript).toString("base64")}`);

const SOURCE_TEXT = [
  "苏轼于元丰三年谪居黄州。",
  "《赤壁赋》作于黄州。",
  "苏轼与黄庭坚有文学交往。",
].join("\n");

function evidence(id, excerpt) {
  const startOffset = SOURCE_TEXT.indexOf(excerpt);
  assert.notEqual(startOffset, -1, `fixture excerpt not found: ${excerpt}`);
  return {
    id,
    sourceFileId: "book-file-test",
    locator: {
      kind: "text-span",
      startOffset,
      endOffset: startOffset + excerpt.length,
      label: `${startOffset}–${startOffset + excerpt.length}`,
    },
    support: "direct",
    excerptSha256: id.padEnd(64, "0").slice(0, 64),
    createdByJobId: "job-verification-test",
  };
}

function makeResult({ withInternalSupport }) {
  const journeyEvidence = evidence("ev-journey", "苏轼于元丰三年谪居黄州。");
  const poemEvidence = evidence("ev-poem", "《赤壁赋》作于黄州。");
  const socialEvidence = evidence("ev-social", "苏轼与黄庭坚有文学交往。");
  return {
    draft: {
      recordType: "private-poet-volume-bundle",
      schemaVersion: "2.0.0-prototype",
      bundleId: "bundle-verification-test",
      jobId: "job-verification-test",
      createdAt: "2026-08-26T00:00:00.000Z",
      access: {
        visibility: "private",
        publicationState: "not-submitted",
      },
      reviewState: "needs-review",
      source: {
        bookId: "book-verification-test",
        bookTitle: "核验测试书",
        packageId: "package-verification-test",
        packageSha256: "a".repeat(64),
        packageOwnerJobId: "job-verification-test",
      },
      poet: {
        id: "su-shi",
        name: "苏轼",
        identityState: "resolved",
      },
      evidence: [journeyEvidence, poemEvidence, socialEvidence],
      entities: {
        people: [
          {
            id: "su-shi",
            name: "苏轼",
            aliases: ["东坡"],
            resolutionState: "resolved",
            evidenceIds: [journeyEvidence.id, socialEvidence.id],
          },
          {
            id: "huang-ting-jian",
            name: "黄庭坚",
            aliases: [],
            resolutionState: "resolved",
            evidenceIds: [socialEvidence.id],
          },
        ],
        places: [
          {
            id: "huangzhou",
            label: "黄州",
            historicalNames: [],
            modernName: "黄冈",
            resolutionState: "resolved",
            mapKind: "point",
            coordinate: { x: 114.88, y: 30.44, precision: "display-only" },
            evidenceIds: [journeyEvidence.id, poemEvidence.id],
          },
        ],
        works: [
          {
            id: "chibi-fu",
            authorPersonId: "su-shi",
            title: "赤壁赋",
            genre: "赋",
            discoveryState: "matched",
            evidenceIds: [poemEvidence.id],
          },
        ],
      },
      storyCards: [
        {
          id: "story-journey",
          kind: "journey",
          title: "谪居黄州",
          summary: "原文记载苏轼谪居黄州。",
          claimType: "fact",
          anchorRefs: [
            { type: "person", id: "su-shi" },
            { type: "place", id: "huangzhou" },
          ],
          evidenceIds: [journeyEvidence.id],
          reviewState: "needs-review",
          disclaimerCode: "not-independent-historical-fact",
        },
        {
          id: "story-poem",
          kind: "place",
          title: "赤壁赋与黄州",
          summary: "原文把《赤壁赋》与黄州相连。",
          claimType: "fact",
          anchorRefs: [
            { type: "work", id: "chibi-fu" },
            { type: "place", id: "huangzhou" },
          ],
          evidenceIds: [poemEvidence.id],
          reviewState: "needs-review",
          disclaimerCode: "not-independent-historical-fact",
        },
        {
          id: "story-social",
          kind: "relationship",
          title: "苏轼与黄庭坚",
          summary: "原文记载二人的文学交往。",
          claimType: "fact",
          anchorRefs: [
            { type: "person", id: "su-shi" },
            { type: "person", id: "huang-ting-jian" },
          ],
          evidenceIds: [socialEvidence.id],
          reviewState: "needs-review",
          disclaimerCode: "not-independent-historical-fact",
        },
      ],
      volumes: {
        journey: {
          state: "ready",
          routeSemantics: "narrative-sequence-not-exact-route",
          items: [
            {
              id: "journey-1",
              placeId: "huangzhou",
              predicate: "exiled-to",
              sequence: 1,
              time: { precision: "year", label: "1080 年", startYear: 1080, endYear: 1080 },
              storyIds: ["story-journey"],
              mapEligible: true,
              evidenceIds: [journeyEvidence.id],
              reviewState: "needs-review",
            },
          ],
          limitations: [],
        },
        poemWorld: {
          state: "ready",
          items: [
            {
              id: "poem-1",
              kind: "place-link",
              workId: "chibi-fu",
              placeId: "huangzhou",
              relationType: "composed-at",
              storyIds: ["story-poem"],
              evidenceIds: [poemEvidence.id],
              reviewState: "needs-review",
            },
          ],
          spotlights: [],
          limitations: [],
        },
        social: {
          state: "ready",
          edges: [
            {
              id: "social-1",
              sourcePersonId: "su-shi",
              targetPersonId: "huang-ting-jian",
              relationTypes: ["literary-exchange"],
              time: { precision: "unknown", label: "时间未定" },
              placeIds: [],
              workIds: [],
              storyIds: ["story-social"],
              evidenceIds: [socialEvidence.id],
              reviewState: "needs-review",
            },
          ],
          limitations: [],
        },
      },
      limitations: [],
    },
    validation: { valid: true, errorCount: 0, warningCount: 0, issues: [] },
    sourceText: SOURCE_TEXT,
    segmentCount: 3,
    fileName: "verification-fixture.txt",
    references: withInternalSupport
      ? {
          status: "available",
          sources: [
            { id: "published-events", label: "站内已发布生平资料", available: true },
            { id: "chinese-poetry", label: "chinese-poetry 作品语料", available: true },
            { id: "cbdb", label: "CBDB 关系资料", available: true },
          ],
          journeyByPlace: {
            huangzhou: [
              {
                id: "published-huangzhou-event",
                title: "元丰三年谪居黄州",
                summary: "站内资料记录苏轼于元丰三年谪居黄州。",
                startYear: 1080,
                endYear: 1080,
                timeLabel: "1080 年",
                sequence: 1,
                workIds: [],
                sourceIds: ["published-events-source"],
              },
            ],
          },
          worksByPlace: {
            huangzhou: [
              {
                id: "chibi-fu",
                title: "赤壁赋",
                genre: "赋",
                text: ["壬戌之秋，七月既望。"],
                placeId: "huangzhou",
                relationType: "composed-at",
                certainty: "verified",
                sourceIds: ["chinese-poetry"],
                origin: "published-work-place-link",
              },
            ],
          },
          socialEdges: [
            {
              id: "cbdb-su-shi-huang-ting-jian",
              sourcePersonId: "su-shi",
              targetPersonId: "huang-ting-jian",
              sourceName: "苏轼",
              targetName: "黄庭坚",
              relationTypes: ["literary-exchange"],
              relationLabels: ["文学交往"],
              evidenceCount: 2,
              sourceIds: ["cbdb-20260718"],
            },
          ],
        }
      : {
          status: "unavailable",
          sources: [
            { id: "published-events", label: "站内已发布生平资料", available: false },
            { id: "chinese-poetry", label: "chinese-poetry 作品语料", available: false },
            { id: "cbdb", label: "CBDB 关系资料", available: false },
          ],
          journeyByPlace: {},
          worksByPlace: {},
          socialEdges: [],
        },
  };
}

function relationStates(result) {
  return [
    ...result.draft.volumes.journey.items,
    ...result.draft.volumes.poemWorld.items,
    ...result.draft.volumes.social.edges,
  ].map((item) => [item.id, item.reviewState]);
}

function storyState(result, id) {
  return result.draft.storyCards.find((story) => story.id === id)?.reviewState;
}

test("internal site, chinese-poetry, and CBDB support auto-approve low-risk relationships", () => {
  const input = makeResult({ withInternalSupport: true });
  const assessments = assessBookRelationships(input);

  assert.deepEqual(
    assessments.map(({ kind, risk, policyStatus, autoApproved }) => ({ kind, risk, policyStatus, autoApproved })),
    [
      { kind: "journey", risk: "low", policyStatus: "confirmed", autoApproved: true },
      { kind: "poemWorld", risk: "low", policyStatus: "confirmed", autoApproved: true },
      { kind: "social", risk: "low", policyStatus: "confirmed", autoApproved: true },
    ],
  );
  assert.deepEqual(
    assessments.map((assessment) => assessment.existingChecks[0].state),
    ["supporting", "supporting", "supporting"],
  );

  const verified = applyAutomaticVerificationPolicy(input);
  assert.deepEqual(relationStates(verified), [
    ["journey-1", "approved-private-preview"],
    ["poem-1", "approved-private-preview"],
    ["social-1", "approved-private-preview"],
  ]);
  assert.ok(verified.draft.storyCards.every((story) => story.reviewState === "approved-private-preview"));
  assert.equal(verified.draft.reviewState, "approved-private-preview");
  assert.equal(verified.validation.valid, true);

  const summary = summarizeVerification(verified);
  assert.equal(summary.autoApprovedCount, 3);
  assert.equal(summary.pendingExceptions.length, 0);
  assert.equal(summary.complete, true);
  assert.ok(input.draft.volumes.journey.items.every((item) => item.reviewState === "needs-review"));
});

test("relationships without internal support stay in the human exception queue", () => {
  const input = makeResult({ withInternalSupport: false });
  const verified = applyAutomaticVerificationPolicy(input);
  const summary = summarizeVerification(verified);

  assert.deepEqual(relationStates(verified), [
    ["journey-1", "needs-review"],
    ["poem-1", "needs-review"],
    ["social-1", "needs-review"],
  ]);
  assert.equal(summary.autoApprovedCount, 0);
  assert.equal(summary.pendingExceptions.length, 3);
  assert.equal(summary.insufficientCount, 3);
  assert.equal(summary.complete, false);
  assert.ok(summary.pendingExceptions.every((assessment) => assessment.webSearchRequired));
  assert.ok(summary.pendingExceptions.every((assessment) => assessment.reasonCode === "evidence-insufficient"));
});

test("human decisions and relation-type edits synchronize linked story states", () => {
  const input = makeResult({ withInternalSupport: false });

  const approved = updateVerificationDecision(input, "journey-1", "approved-private-preview");
  assert.equal(approved.draft.volumes.journey.items[0].reviewState, "approved-private-preview");
  assert.equal(storyState(approved, "story-journey"), "approved-private-preview");

  const rejected = updateVerificationDecision(approved, "social-1", "rejected");
  assert.equal(rejected.draft.volumes.social.edges[0].reviewState, "rejected");
  assert.equal(storyState(rejected, "story-social"), "rejected");

  const poemApproved = updateVerificationDecision(rejected, "poem-1", "approved-private-preview");
  assert.equal(storyState(poemApproved, "story-poem"), "approved-private-preview");

  const journeyEdited = updateVerificationRelationType(poemApproved, "journey-1", "visited");
  assert.equal(journeyEdited.draft.volumes.journey.items[0].predicate, "visited");
  assert.equal(journeyEdited.draft.volumes.journey.items[0].reviewState, "needs-review");
  assert.equal(storyState(journeyEdited, "story-journey"), "needs-review");
  assert.match(journeyEdited.draft.storyCards.find((story) => story.id === "story-journey").title, /到访/);

  const poemEdited = updateVerificationRelationType(journeyEdited, "poem-1", "describes-place");
  assert.equal(poemEdited.draft.volumes.poemWorld.items[0].relationType, "describes-place");
  assert.equal(poemEdited.draft.volumes.poemWorld.items[0].reviewState, "needs-review");
  assert.equal(storyState(poemEdited, "story-poem"), "needs-review");

  const socialEdited = updateVerificationRelationType(poemEdited, "social-1", "friendship");
  assert.deepEqual(socialEdited.draft.volumes.social.edges[0].relationTypes, ["friendship"]);
  assert.equal(socialEdited.draft.volumes.social.edges[0].reviewState, "needs-review");
  assert.equal(storyState(socialEdited, "story-social"), "needs-review");
  assert.equal(socialEdited.draft.reviewState, "needs-review");
  assert.equal(socialEdited.validation.valid, true);
});

test("same-place context with a different journey predicate never auto-approves", () => {
  const input = makeResult({ withInternalSupport: true });
  input.draft.volumes.journey.items[0].predicate = "born-at";

  const journey = assessBookRelationships(input).find((assessment) => assessment.id === "journey-1");
  assert.ok(journey);
  assert.equal(journey.existingChecks[0].state, "not-found");
  assert.equal(journey.autoApproved, false);
  assert.notEqual(journey.policyStatus, "confirmed");

  const verified = applyAutomaticVerificationPolicy(input);
  assert.equal(verified.draft.volumes.journey.items[0].reviewState, "needs-review");
  assert.ok(summarizeVerification(verified).pendingExceptions.some((assessment) => assessment.id === "journey-1"));
});

test("a modified auto-eligible relationship is forced back into the exception queue", () => {
  const verified = applyAutomaticVerificationPolicy(makeResult({ withInternalSupport: true }));
  const edited = updateVerificationRelationType(verified, "poem-1", "composed-at");
  const summary = summarizeVerification(edited);

  assert.equal(edited.draft.volumes.poemWorld.items[0].reviewState, "needs-review");
  assert.ok(summary.pendingExceptions.some((assessment) => assessment.id === "poem-1"));
  assert.equal(summary.complete, false);
  const editedAssessment = summary.assessments.find((assessment) => assessment.id === "poem-1");
  assert.equal(editedAssessment?.decisionActor, "human");
  assert.equal(editedAssessment?.displayStatus, "pending");
  assert.match(editedAssessment?.reason ?? "", /人工修改/);
});

test("a different CBDB relation type is insufficient evidence, not a contradiction", () => {
  const input = makeResult({ withInternalSupport: true });
  input.references.socialEdges[0].relationTypes = ["official"];
  input.references.socialEdges[0].relationLabels = ["同僚 / 官场"];

  const social = assessBookRelationships(input).find((assessment) => assessment.id === "social-1");
  assert.ok(social);
  assert.equal(social.reasonCode, "evidence-insufficient");
  assert.notEqual(social.policyStatus, "conflict");
  assert.equal(social.autoApproved, false);
});

test("explicit contradictory evidence becomes a high-risk conflict", () => {
  const input = makeResult({ withInternalSupport: true });
  input.draft.evidence.find((item) => item.id === "ev-journey").support = "contradicts";

  const journey = assessBookRelationships(input).find((assessment) => assessment.id === "journey-1");
  assert.ok(journey);
  assert.equal(journey.policyStatus, "conflict");
  assert.equal(journey.displayStatus, "conflict");
  assert.equal(journey.reasonCode, "conflict");
  assert.equal(journey.risk, "high");
  assert.equal(journey.autoApproved, false);

  const verified = applyAutomaticVerificationPolicy(input);
  const summary = summarizeVerification(verified);
  assert.equal(verified.draft.volumes.journey.items[0].reviewState, "needs-review");
  assert.equal(summary.conflictCount, 1);
  assert.ok(summary.pendingExceptions.some((assessment) => assessment.id === "journey-1"));
});
