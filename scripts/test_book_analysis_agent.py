#!/usr/bin/env python3
"""Tests for the private book-analysis prototype."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from poet_map_job import DEFAULT_RAW_MANIFEST, DEFAULT_SOURCE_MANIFEST, validate_job_manifest  # noqa: E402
from run_book_analysis_agent import approve_job, draft_validation, release_job, run_book_analysis  # noqa: E402


class BookAnalysisAgentTest(unittest.TestCase):
    def test_pipeline_builds_evidence_bound_three_volume_draft_and_private_release(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "book.txt"
            source.write_text(
                "苏轼生于长安，后寓居黄州。苏轼与王安石往来。"
                "苏轼《饮湖上初晴后雨二首（其二）》作于杭州。",
                encoding="utf-8",
            )
            outcome = run_book_analysis(
                input_path=source,
                book_title="苏轼书籍原型测试",
                poet_id="su-shi",
                poet_name="苏轼",
                data_processing_consent=True,
                job_root=root / "jobs",
                quarantine_root=root / "quarantine",
                raw_manifest=DEFAULT_RAW_MANIFEST,
                source_manifest=DEFAULT_SOURCE_MANIFEST,
            )
            self.assertTrue(outcome["completed"], outcome)
            self.assertEqual("awaiting-review", outcome["status"])
            draft_path = Path(outcome["draftPath"])
            draft = json.loads(draft_path.read_text(encoding="utf-8"))
            self.assertTrue(draft_validation(draft)["valid"])
            self.assertGreaterEqual(len(draft["evidence"]), 1)
            self.assertGreaterEqual(len(draft["storyCards"]), 1)
            self.assertTrue(all(card["anchorRefs"] for card in draft["storyCards"]))
            self.assertTrue(all(card["evidenceIds"] for card in draft["storyCards"]))
            self.assertGreaterEqual(len(draft["volumes"]["journey"]["items"]), 1)
            self.assertGreaterEqual(len(draft["volumes"]["poemWorld"]["items"]), 1)
            self.assertGreaterEqual(len(draft["volumes"]["social"]["edges"]), 1)

            job_path = Path(outcome["jobPath"])
            approved = approve_job(job_path, reviewer="fixture-reviewer", notes="fixture approval")
            self.assertEqual("approved-private-preview", approved["job"]["status"])
            self.assertTrue(Path(approved["approvedDraftPath"]).is_file())
            self.assertTrue(Path(approved["humanReviewPath"]).is_file())
            release = release_job(job_path, actor="fixture-reviewer", notes="fixture release")
            self.assertEqual("approved-for-curation", release["status"])
            self.assertTrue(Path(release["releasePath"]).is_file())

            final_job = json.loads(job_path.read_text(encoding="utf-8"))
            self.assertTrue(validate_job_manifest(final_job, artifact_root=job_path.parent).valid)
            self.assertEqual("approved-for-curation", final_job["status"])


if __name__ == "__main__":
    unittest.main()

