"""Focused contract tests for the private journey, poem-world and social bundle."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from build_book_package_manifest import DIGEST_SPECIFICATION, package_sha256, validate_book_package_manifest  # noqa: E402
from validate_private_volume_bundle import validate_private_volume_bundle  # noqa: E402


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def source_manifest() -> dict:
    members = [
        {
            "id": "book-file-0001",
            "ordinal": 1,
            "relativePath": "KR4d0076_000.txt",
            "sizeBytes": 120,
            "sha256": SHA_A,
            "mediaTypeHint": "text/plain",
            "sectionHints": [{"kind": "juan", "title": "本传", "line": 6, "detector": "kanripo-org-juan-v1"}],
        },
        {
            "id": "book-file-0002",
            "ordinal": 2,
            "relativePath": "KR4d0076_001.txt",
            "sizeBytes": 130,
            "sha256": SHA_B,
            "mediaTypeHint": "text/plain",
            "sectionHints": [],
        },
    ]
    digest = package_sha256(members)
    manifest = {
        "recordType": "book-package-manifest",
        "schemaVersion": "1.0.0",
        "packageId": f"bpm-dongpo-quanji-{digest[:12]}",
        "jobId": "bmj-dongpo-baseline",
        "createdAt": "2026-08-24T00:00:00Z",
        "visibility": "private",
        "book": {"id": "dongpo-quanji", "title": "东坡全集"},
        "sourceRef": {"sourceId": "kanripo-kr4d0076"},
        "ordering": {"method": "relative-path-lexicographic-v1", "pathFormat": "posix"},
        "selection": {"includeExtensions": [".txt"], "excludedFileCount": 1},
        "memberCount": len(members),
        "totalBytes": 250,
        "packageSha256": digest,
        "digestSpecification": DIGEST_SPECIFICATION,
        "members": members,
    }
    assert validate_book_package_manifest(manifest).valid
    return manifest


def valid_bundle() -> dict:
    manifest = source_manifest()
    return {
        "recordType": "private-poet-volume-bundle",
        "schemaVersion": "1.0.0",
        "bundleId": "ppvb-dongpo-su-shi-000000000000",
        "jobId": "bmj-dongpo-baseline",
        "createdAt": "2026-08-24T00:00:00Z",
        "access": {"visibility": "private", "publicationState": "not-submitted"},
        "reviewState": "candidate-preview",
        "source": {
            "bookId": "dongpo-quanji",
            "bookTitle": "东坡全集",
            "packageId": manifest["packageId"],
            "packageSha256": manifest["packageSha256"],
            "packageOwnerJobId": manifest["jobId"],
        },
        "poet": {"id": "su-shi", "name": "苏轼", "identityState": "resolved", "externalIds": [{"scheme": "cbdb", "value": "3767"}]},
        "evidence": [
            {
                "id": "evidence-biography",
                "sourceFileId": "book-file-0001",
                "locator": {"kind": "text-span", "startOffset": 0, "endOffset": 20},
                "support": "direct",
                "excerptSha256": SHA_A,
                "createdByJobId": "bmj-dongpo-baseline",
            },
            {
                "id": "evidence-poem",
                "sourceFileId": "book-file-0002",
                "locator": {"kind": "chapter-section", "label": "诗文"},
                "support": "direct",
                "excerptSha256": SHA_B,
                "createdByJobId": "bmj-dongpo-baseline",
            },
            {
                "id": "evidence-social",
                "sourceFileId": "book-file-0002",
                "locator": {"kind": "named-anchor", "anchor": "与子由别"},
                "support": "direct",
                "excerptSha256": SHA_C,
                "createdByJobId": "bmj-dongpo-baseline",
            },
        ],
        "entities": {
            "people": [
                {"id": "su-zhe", "name": "苏辙", "resolutionState": "resolved", "evidenceIds": ["evidence-social"]}
            ],
            "places": [
                {
                    "id": "huangzhou",
                    "label": "黄州",
                    "resolutionState": "resolved",
                    "mapKind": "point",
                    "evidenceIds": ["evidence-biography"],
                }
            ],
            "works": [
                {
                    "id": "nian-nu-jiao",
                    "title": "念奴娇",
                    "genre": "词",
                    "discoveryState": "candidate",
                    "evidenceIds": ["evidence-poem"],
                }
            ],
        },
        "volumes": {
            "journey": {
                "state": "ready",
                "routeSemantics": "narrative-sequence-not-exact-route",
                "items": [
                    {
                        "id": "journey-huangzhou",
                        "placeId": "huangzhou",
                        "predicate": "exiled-to",
                        "sequence": 1,
                        "time": {"precision": "range", "label": "元丰年间", "startYear": 1080, "endYear": 1084},
                        "mapEligible": True,
                        "evidenceIds": ["evidence-biography"],
                        "reviewState": "candidate-preview",
                    }
                ],
                "limitations": ["路线表示阅读顺序，不表示精确交通路线。"],
            },
            "poemWorld": {
                "state": "ready",
                "items": [
                    {
                        "id": "poem-place-huangzhou",
                        "kind": "place-link",
                        "workId": "nian-nu-jiao",
                        "placeId": "huangzhou",
                        "relationType": "work-describes-place",
                        "evidenceIds": ["evidence-poem"],
                        "reviewState": "candidate-preview",
                    }
                ],
                "limitations": ["作品地点不反推作者行迹或写作地点。"],
            },
            "social": {
                "state": "ready",
                "edges": [
                    {
                        "id": "social-su-shi-su-zhe",
                        "sourcePersonId": "su-shi",
                        "targetPersonId": "su-zhe",
                        "displayBuckets": ["kin", "literary-exchange"],
                        "evidenceIds": ["evidence-social"],
                        "reviewState": "candidate-preview",
                    }
                ],
                "storyCards": [
                    {
                        "id": "story-su-shi-su-zhe",
                        "edgeId": "social-su-shi-su-zhe",
                        "kind": "source-bound-reading-note",
                        "title": "书中交往线索",
                        "summary": "此卡片只说明书内可回读的交往线索，等待人工审核。",
                        "evidenceIds": ["evidence-social"],
                        "reviewState": "candidate-preview",
                        "disclaimerCode": "not-independent-historical-fact",
                    }
                ],
                "limitations": ["故事卡不是独立历史事实。"],
            },
        },
        "limitations": ["本包只可在私有审核预览中使用。"],
    }


class PrivateVolumeBundleTest(unittest.TestCase):
    def validate(self, bundle: dict) -> object:
        return validate_private_volume_bundle(bundle, source_manifest())

    def test_valid_bundle_with_evidence_bound_story_card(self) -> None:
        validation = self.validate(valid_bundle())
        self.assertTrue(validation.valid, validation.payload())

    def test_story_requires_existing_edge_evidence_subset(self) -> None:
        bundle = valid_bundle()
        bundle["volumes"]["social"]["storyCards"][0]["evidenceIds"] = ["evidence-poem"]
        validation = self.validate(bundle)
        self.assertFalse(validation.valid)
        self.assertIn("story-evidence-outside-edge", {issue.code for issue in validation.errors})

    def test_missing_evidence_and_unknown_private_field_are_rejected(self) -> None:
        bundle = valid_bundle()
        bundle["volumes"]["journey"]["items"][0]["evidenceIds"] = ["evidence-missing"]
        bundle["poet"]["privateText"] = "must not be accepted"
        validation = self.validate(bundle)
        self.assertFalse(validation.valid)
        self.assertIn("evidence-id-missing", {issue.code for issue in validation.errors})
        self.assertIn("poet-unknown-field", {issue.code for issue in validation.errors})

    def test_public_access_and_unresolved_map_point_are_rejected(self) -> None:
        bundle = valid_bundle()
        bundle["access"]["visibility"] = "public"
        bundle["entities"]["places"][0]["resolutionState"] = "ambiguous"
        validation = self.validate(bundle)
        self.assertFalse(validation.valid)
        codes = {issue.code for issue in validation.errors}
        self.assertIn("access-visibility", codes)
        self.assertIn("place-unresolved-map", codes)
        self.assertIn("journey-map-place", codes)

    def test_nonready_volume_cannot_hide_items(self) -> None:
        bundle = valid_bundle()
        bundle["volumes"]["poemWorld"]["state"] = "not-run"
        bundle["volumes"]["poemWorld"]["reason"] = "尚未实现抽取器"
        validation = self.validate(bundle)
        self.assertFalse(validation.valid)
        self.assertIn("volume-nonready-items", {issue.code for issue in validation.errors})

    def test_story_cannot_be_reviewed_ahead_of_its_edge(self) -> None:
        bundle = valid_bundle()
        bundle["volumes"]["social"]["storyCards"][0]["reviewState"] = "approved-private-preview"
        validation = self.validate(bundle)
        self.assertFalse(validation.valid)
        self.assertIn("story-review-ahead-of-edge", {issue.code for issue in validation.errors})


if __name__ == "__main__":
    unittest.main()
