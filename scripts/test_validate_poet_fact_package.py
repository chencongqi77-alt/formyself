#!/usr/bin/env python3
"""Focused tests for provenance-first poet fact packages."""

from __future__ import annotations

import sys
import unittest
from copy import deepcopy
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from validate_poet_fact_package import validate_fact_package  # noqa: E402


SHA = "a" * 64
JOB_ID = "pmj-20260803-fixture"


def valid_package() -> dict:
    return {
        "recordType": "poet-fact-package",
        "schemaVersion": "1.0.0",
        "packageId": "pfp-li-bai-fixture",
        "jobId": JOB_ID,
        "createdAt": "2026-08-03T00:00:00Z",
        "poet": {"id": "li-bai", "name": "李白"},
        "evidence": [
            {
                "id": "evidence-biography-1",
                "reference": {"registry": "job-upload", "referenceId": "upload-li-bai", "snapshotSha256": SHA},
                "locator": {"kind": "text-span", "segmentId": "segment-1", "start": 0, "end": 16},
                "support": "supports",
                "visibility": "private",
                "excerptSha256": SHA,
                "createdByJobId": JOB_ID,
            }
        ],
        "assertions": [
            {
                "id": "assertion-li-bai-changan",
                "subject": {"type": "person", "id": "li-bai"},
                "predicate": "visited",
                "object": {"type": "place", "id": "changan", "label": "长安"},
                "qualifiers": {"time": {"precision": "era-only", "label": "天宝年间", "originalText": "天宝中"}},
                "claimClass": "biographical-route",
                "evidenceIds": ["evidence-biography-1"],
                "confidence": {"level": "possible", "score": 0.7, "basis": "rule-and-source"},
                "decision": {"state": "candidate", "policyId": "route-policy-v1"},
                "provenance": {"jobId": JOB_ID, "pipelineVersion": "test-v1", "createdAt": "2026-08-03T00:00:00Z"},
            }
        ],
        "reviewStatus": "candidate",
    }


class FactPackageValidationTest(unittest.TestCase):
    def test_private_candidate_package_is_valid(self) -> None:
        validation = validate_fact_package(valid_package())
        self.assertTrue(validation.valid, validation.payload())

    def test_assertion_must_reference_existing_evidence(self) -> None:
        package = valid_package()
        package["assertions"][0]["evidenceIds"] = ["missing-evidence"]
        validation = validate_fact_package(package)
        self.assertFalse(validation.valid)
        self.assertIn("assertion-evidence-missing", {issue.code for issue in validation.errors})

    def test_literary_place_cannot_be_biographical_route(self) -> None:
        package = valid_package()
        assertion = package["assertions"][0]
        assertion["predicate"] = "work-mentioned-place"
        assertion["claimClass"] = "biographical-route"
        validation = validate_fact_package(package)
        self.assertFalse(validation.valid)
        self.assertIn("literary-claim-class", {issue.code for issue in validation.errors})

    def test_published_package_rejects_private_evidence(self) -> None:
        package = deepcopy(valid_package())
        package["reviewStatus"] = "published"
        package["assertions"][0]["decision"]["state"] = "released"
        validation = validate_fact_package(package)
        self.assertFalse(validation.valid)
        self.assertIn("published-private-evidence", {issue.code for issue in validation.errors})

    def test_timestamps_require_valid_timezone_aware_values(self) -> None:
        package = valid_package()
        package["createdAt"] = "2026-08-03T00:00:00"
        validation = validate_fact_package(package)
        self.assertFalse(validation.valid)
        self.assertIn("package-created-at", {issue.code for issue in validation.errors})

        package = valid_package()
        package["assertions"][0]["provenance"].pop("createdAt")
        validation = validate_fact_package(package)
        codes = {issue.code for issue in validation.errors}
        self.assertIn("assertion-provenance-missing-field", codes)
        self.assertIn("assertion-provenance-created-at", codes)

        package = valid_package()
        package["assertions"][0]["provenance"]["createdAt"] = "not-a-timestamp"
        validation = validate_fact_package(package)
        self.assertFalse(validation.valid)
        self.assertIn("assertion-provenance-created-at", {issue.code for issue in validation.errors})

    def test_locator_kind_must_use_the_controlled_vocabulary(self) -> None:
        package = valid_package()
        package["evidence"][0]["locator"]["kind"] = "screen-scrape"
        validation = validate_fact_package(package)
        self.assertFalse(validation.valid)
        self.assertIn("evidence-locator-kind", {issue.code for issue in validation.errors})

    def test_all_closed_schema_boundaries_reject_private_unknown_fields(self) -> None:
        def add_editorial(package: dict) -> dict:
            package["editorial"] = [
                {
                    "id": "editorial-summary-1",
                    "kind": "summary",
                    "basisAssertionIds": ["assertion-li-bai-changan"],
                    "reviewStatus": "candidate",
                }
            ]
            return package

        cases = (
            ("package", lambda package: package.__setitem__("privatePrompt", "secret"), "package-unknown-field"),
            ("poet", lambda package: package["poet"].__setitem__("privatePrompt", "secret"), "poet-unknown-field"),
            (
                "poet external id",
                lambda package: package["poet"].__setitem__(
                    "externalIds", [{"scheme": "cbdb", "value": "123", "privatePrompt": "secret"}]
                ),
                "poet-external-id-unknown-field",
            ),
            ("evidence", lambda package: package["evidence"][0].__setitem__("privatePrompt", "secret"), "evidence-unknown-field"),
            (
                "evidence reference",
                lambda package: package["evidence"][0]["reference"].__setitem__("privatePrompt", "secret"),
                "evidence-reference-unknown-field",
            ),
            ("assertion", lambda package: package["assertions"][0].__setitem__("privatePrompt", "secret"), "assertion-unknown-field"),
            (
                "entity reference",
                lambda package: package["assertions"][0]["subject"].__setitem__("privatePrompt", "secret"),
                "entity-ref-unknown-field",
            ),
            (
                "confidence",
                lambda package: package["assertions"][0]["confidence"].__setitem__("privatePrompt", "secret"),
                "assertion-confidence-unknown-field",
            ),
            (
                "decision",
                lambda package: package["assertions"][0]["decision"].__setitem__("privatePrompt", "secret"),
                "assertion-decision-unknown-field",
            ),
            (
                "provenance",
                lambda package: package["assertions"][0]["provenance"].__setitem__("privatePrompt", "secret"),
                "assertion-provenance-unknown-field",
            ),
            (
                "qualifiers",
                lambda package: package["assertions"][0]["qualifiers"].__setitem__("privatePrompt", "secret"),
                "assertion-qualifiers-unknown-field",
            ),
            (
                "time",
                lambda package: package["assertions"][0]["qualifiers"]["time"].__setitem__("privatePrompt", "secret"),
                "time-unknown-field",
            ),
            (
                "editorial",
                lambda package: add_editorial(package)["editorial"][0].__setitem__("privatePrompt", "secret"),
                "editorial-unknown-field",
            ),
        )
        for label, mutate, expected_code in cases:
            with self.subTest(label=label):
                package = valid_package()
                mutate(package)
                validation = validate_fact_package(package)
                self.assertFalse(validation.valid)
                self.assertIn(expected_code, {issue.code for issue in validation.errors})


if __name__ == "__main__":
    unittest.main()
