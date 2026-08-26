#!/usr/bin/env python3
"""Focused standard-library tests for the published-data gate and synchronizer."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import patch


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import sync_published_data as sync_module
from sync_published_data import sync_published_data
from validate_published_data import validate_published_data


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def approved_source() -> dict[str, Any]:
    return {
        "id": "test-approved-source",
        "title": "Test approved source",
        "sourceType": "primary-text",
        "sourceUrl": "https://example.test/source",
        "version": {"type": "edition", "value": "test edition"},
        "rights": {
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "Test contributors",
            "redistributionAllowed": True,
        },
        "allowedUses": ["data-extraction", "public-redistribution"],
        "ingestionStatus": "approved",
    }


def blocked_source() -> dict[str, Any]:
    source = approved_source()
    source["id"] = "test-blocked-source"
    source["ingestionStatus"] = "blocked"
    return source


def canonical_source(source: dict[str, Any]) -> dict[str, Any]:
    rights = source["rights"]
    return {
        "id": source["id"],
        "title": source["title"],
        "sourceType": source["sourceType"],
        "sourceUrl": source["sourceUrl"],
        "version": deepcopy(source["version"]),
        "license": rights["license"],
        "licenseUrl": rights["licenseUrl"],
        "attribution": rights["attribution"],
        "reviewStatus": "published",
    }


def source_ref() -> dict[str, Any]:
    return {
        "sourceId": "test-approved-source",
        "locator": {
            "kind": "line-range",
            "path": "volume-01.txt",
            "startLine": 10,
            "endLine": 12,
        },
        "purpose": "Test citation",
    }


def valid_package() -> dict[str, list[dict[str, Any]]]:
    ref = source_ref()
    return {
        "people": [
            {
                "id": "test-person",
                "name": "Test Person",
                "aliases": ["Test Alias"],
                "dynasty": "Test dynasty",
                "birthYear": 1000,
                "deathYear": 1050,
                "intro": "A tested published person.",
                "sourceRefs": [deepcopy(ref)],
                "reviewStatus": "published",
            }
        ],
        "places": [
            {
                "id": "test-place",
                "name": "Test place",
                "historicalNames": ["Historic test place"],
                "modernName": "Modern test place",
                "sourceCoordinates": {
                    "x": 120.25,
                    "y": 30.25,
                    "source": "Test gazetteer",
                    "sourceRef": deepcopy(ref),
                },
                "intro": "A tested published place.",
                "sourceRefs": [deepcopy(ref)],
                "reviewStatus": "published",
            }
        ],
        "events": [
            {
                "id": "test-event",
                "personId": "test-person",
                "placeId": "test-place",
                "startYear": 1020,
                "endYear": 1020,
                "lifeStage": "Test stage",
                "role": "Test role",
                "title": "Test event",
                "summary": "A tested published event.",
                "workIds": ["test-work"],
                "sourceRefs": [deepcopy(ref)],
                "reviewStatus": "published",
            }
        ],
        "works": [
            {
                "id": "test-work",
                "personId": "test-person",
                "placeIds": ["test-place"],
                "eventIds": ["test-event"],
                "title": "Test work",
                "genre": "Test genre",
                "text": ["A test line."],
                "plainExplanation": "A tested published work.",
                "sourceRefs": [deepcopy(ref)],
                "reviewStatus": "published",
            }
        ],
        "sources": [canonical_source(approved_source())],
    }


class PublishedDataPipelineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.data_dir = self.root / "published"
        self.target_dir = self.root / "web-public-data"
        self.data_dir.mkdir()
        self.manifest_path = self.root / "source-manifest.json"
        write_json(
            self.manifest_path,
            {"schemaVersion": "test", "sources": [approved_source(), blocked_source()]},
        )
        self.write_package(valid_package())

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_package(self, package: dict[str, list[dict[str, Any]]]) -> None:
        for name, payload in package.items():
            write_json(self.data_dir / f"{name}.json", payload)

    def validate(self):
        return validate_published_data(
            self.data_dir,
            self.manifest_path,
            validate_source_catalog=False,
        )

    def codes(self) -> set[str]:
        return {issue.code for issue in self.validate().issues}

    def test_valid_package_passes_all_published_gates(self) -> None:
        validation = self.validate()
        self.assertTrue(validation.valid, validation.payload())
        self.assertEqual([], validation.errors)

    def test_explicit_temporal_precisions_are_accepted(self) -> None:
        cases = [
            ("year", 1020, 1020),
            ("range", 1020, 1021),
            ("era-only", None, None),
            ("era-and-month", None, None),
            ("sequence-only", None, None),
        ]
        for precision, start_year, end_year in cases:
            with self.subTest(precision=precision):
                package = valid_package()
                event = package["events"][0]
                event["timePrecision"] = precision
                event["timeLabel"] = f"Test {precision} label"
                event["sequence"] = 1
                if start_year is None:
                    del event["startYear"]
                    del event["endYear"]
                else:
                    event["startYear"] = start_year
                    event["endYear"] = end_year
                self.write_package(package)
                validation = self.validate()
                self.assertTrue(validation.valid, validation.payload())

    def test_explicit_temporal_contract_requires_label_sequence_and_years(self) -> None:
        package = valid_package()
        event = package["events"][0]
        event["timePrecision"] = "year"
        event["timeLabel"] = ""
        event["sequence"] = 0
        del event["startYear"]
        del event["endYear"]
        self.write_package(package)
        codes = self.codes()
        self.assertIn("event-time-label-required", codes)
        self.assertIn("event-sequence-required", codes)
        self.assertIn("event-temporal-year-required", codes)

    def test_route_sequences_must_be_complete_and_unique_per_person(self) -> None:
        package = valid_package()
        first = package["events"][0]
        first.update(
            {
                "timePrecision": "year",
                "timeLabel": "1020",
                "sequence": 1,
            }
        )
        second = deepcopy(first)
        second["id"] = "second-test-event"
        second["workIds"] = []
        second.pop("sequence")
        second.pop("timePrecision")
        second.pop("timeLabel")
        package["events"].append(second)
        self.write_package(package)
        self.assertIn("event-route-sequence-required", self.codes())

        second.update(
            {
                "timePrecision": "year",
                "timeLabel": "1020",
                "sequence": 1,
            }
        )
        self.write_package(package)
        self.assertIn("event-route-sequence-duplicate", self.codes())

    def test_free_text_locator_is_rejected(self) -> None:
        package = valid_package()
        package["events"][0]["sourceRefs"][0]["locator"] = "chapter one"
        self.write_package(package)
        self.assertIn("locator-type", self.codes())

    def test_unapproved_manifest_source_is_rejected(self) -> None:
        package = valid_package()
        package["events"][0]["sourceRefs"][0]["sourceId"] = "test-blocked-source"
        self.write_package(package)
        self.assertIn("source-ref-not-approved", self.codes())

    def test_event_and_work_links_must_be_bidirectional(self) -> None:
        package = valid_package()
        package["works"][0]["eventIds"] = []
        self.write_package(package)
        self.assertIn("event-work-asymmetry", self.codes())

    def test_foreign_keys_and_coordinate_bounds_are_checked(self) -> None:
        package = valid_package()
        package["places"][0]["sourceCoordinates"]["x"] = 181
        package["works"][0]["placeIds"] = ["missing-place"]
        self.write_package(package)
        codes = self.codes()
        self.assertIn("coordinate-longitude", codes)
        self.assertIn("foreign-key-missing", codes)

    def test_source_card_must_match_the_approved_manifest_record(self) -> None:
        package = valid_package()
        package["sources"][0]["title"] = "Different title"
        self.write_package(package)
        self.assertIn("source-metadata-mismatch", self.codes())

    def test_dry_run_validates_without_creating_a_web_target(self) -> None:
        result = sync_published_data(
            self.data_dir,
            self.manifest_path,
            self.target_dir,
            dry_run=True,
            validate_source_catalog=False,
        )
        self.assertTrue(result.valid, result.payload())
        self.assertEqual(5, len(result.would_sync))
        self.assertFalse(self.target_dir.exists())

    def test_cli_requires_apply_before_it_can_write(self) -> None:
        fake_result = sync_module.SyncResult(
            True,
            (),
            ({"dataset": "people", "path": "people.json", "sha256": "test"},),
            None,
            {"issues": []},
        )
        cases = (((), True), (("--dry-run",), True), (("--apply",), False))
        for arguments, expected_dry_run in cases:
            with self.subTest(arguments=arguments):
                with patch.object(sys, "argv", ["sync_published_data.py", *arguments]):
                    with patch.object(
                        sync_module, "sync_published_data", return_value=fake_result
                    ) as synchronizer:
                        with redirect_stdout(io.StringIO()):
                            self.assertEqual(0, sync_module.main())
                self.assertEqual(
                    expected_dry_run,
                    synchronizer.call_args.kwargs["dry_run"],
                )

        with patch.object(
            sys, "argv", ["sync_published_data.py", "--dry-run", "--apply"]
        ):
            with redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    sync_module.parse_args()

    def test_sync_writes_only_after_successful_validation(self) -> None:
        self.target_dir.mkdir()
        sentinel_path = self.target_dir / "people.json"
        sentinel_path.write_text("sentinel", encoding="utf-8")

        result = sync_published_data(
            self.data_dir,
            self.manifest_path,
            self.target_dir,
            validate_source_catalog=False,
        )
        self.assertTrue(result.valid, result.payload())
        self.assertEqual(
            (self.data_dir / "people.json").read_bytes(),
            sentinel_path.read_bytes(),
        )

        before_failure = sentinel_path.read_bytes()
        package = valid_package()
        package["people"][0]["reviewStatus"] = "needsReview"
        self.write_package(package)
        rejected = sync_published_data(
            self.data_dir,
            self.manifest_path,
            self.target_dir,
            validate_source_catalog=False,
        )
        self.assertFalse(rejected.valid)
        self.assertIn("not-published", {issue["code"] for issue in rejected.validation["issues"]})
        self.assertEqual(before_failure, sentinel_path.read_bytes())


if __name__ == "__main__":
    unittest.main()
