#!/usr/bin/env python3
"""End-to-end tests for private TXT/PDF intake and deterministic extraction."""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from build_biography_route_draft import build_route_draft  # noqa: E402
from extract_biography_text import extract_job  # noqa: E402
from ingest_uploaded_source import IntakeError, ingest_file  # noqa: E402
from poet_map_job import (  # noqa: E402
    REQUIRED_REFERENCE_IDS,
    build_job_manifest,
    initialize_job,
)
from validate_poet_fact_package import validate_fact_package  # noqa: E402
from run_basic_poet_map import run_basic_pipeline  # noqa: E402

try:
    from reportlab.pdfgen import canvas
except ImportError:  # pragma: no cover - development dependency only.
    canvas = None


def snapshots() -> list[dict[str, str]]:
    return [
        {
            "registry": "source-catalog" if reference_id == "source-materials" else "raw-layer",
            "referenceId": reference_id,
            "manifestPath": "source-materials/source-manifest.json"
            if reference_id == "source-materials"
            else "data/raw-layer-manifest.json",
            "sha256": hashlib.sha256(reference_id.encode("utf-8")).hexdigest(),
        }
        for reference_id in REQUIRED_REFERENCE_IDS
    ]


class UploadIntakeAndExtractTest(unittest.TestCase):
    def make_job(self, directory: Path, *, file_name: str, source_id: str) -> tuple[Path, dict]:
        quarantine_root = directory / "quarantine"
        receipt_outcome = ingest_file(
            directory / file_name,
            source_id=source_id,
            quarantine_root=quarantine_root,
        )
        receipt = receipt_outcome["receipt"]
        job = build_job_manifest(
            job_id="pmj-20260803-0123456789abcdef",
            created_at="2026-08-03T00:00:00Z",
            poet_id="li-bai",
            poet_name="李白",
            source_id=source_id,
            input_sha256=receipt["sha256"],
            content_type=receipt["detectedContentType"],
            access_level="quarantine",
            data_processing_consent=True,
            external_transfer_consent=False,
            allow_external_providers=False,
            max_api_requests=0,
            max_tokens=None,
            max_cost_cny=None,
            publication_mode="private-preview-only",
            source=None,
            snapshots=snapshots(),
        )
        job_directory = initialize_job(directory / "jobs", job)
        return job_directory / "job.json", receipt

    def test_utf8_text_is_quarantined_and_extracted_into_immutable_job_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            (directory / "bio.txt").write_text("李白生于蜀地。\n\n后来游历长安，并在此停留。", encoding="utf-8")
            job_path, receipt = self.make_job(
                directory, file_name="bio.txt", source_id="upload-li-bai-utf8"
            )
            outcome = extract_job(job_path, quarantine_root=directory / "quarantine")

            self.assertTrue(outcome["completed"], outcome)
            self.assertEqual("text-ok", outcome["status"])
            self.assertEqual("utf-8", receipt["checks"]["encoding"])
            job = json.loads(job_path.read_text(encoding="utf-8"))
            self.assertEqual(["succeeded", "succeeded"], [stage["status"] for stage in job["stages"][:2]])
            self.assertEqual(
                {"intake-original", "intake-receipt", "extract-segments", "extract-report"},
                {artifact["id"] for artifact in job["artifacts"]},
            )
            segments = (job_path.parent / "01-extract" / "segments.jsonl").read_text(encoding="utf-8")
            self.assertIn("游历长安", segments)

    def test_utf16_text_is_detected_without_being_rejected_as_binary(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            (directory / "bio.txt").write_text("苏轼曾居黄州。", encoding="utf-16")
            job_path, receipt = self.make_job(
                directory, file_name="bio.txt", source_id="upload-su-shi-utf16"
            )
            outcome = extract_job(job_path, quarantine_root=directory / "quarantine")

            self.assertTrue(outcome["completed"], outcome)
            self.assertEqual("utf-16", receipt["checks"]["encoding"])

    def test_biographical_actions_make_an_automatic_private_route_but_literary_mentions_do_not(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            (directory / "bio.txt").write_text(
                "李白生于长安。后谪居黄州。又游历杭州。作于徐州的诗篇流传很广。",
                encoding="utf-8",
            )
            job_path, _ = self.make_job(
                directory, file_name="bio.txt", source_id="upload-li-bai-route-draft"
            )
            extraction = extract_job(job_path, quarantine_root=directory / "quarantine")
            self.assertTrue(extraction["completed"], extraction)
            outcome = build_route_draft(job_path)

            self.assertEqual("automatic-private-preview", outcome["status"])
            self.assertEqual(3, outcome["includedRouteCount"])
            job = json.loads(job_path.read_text(encoding="utf-8"))
            self.assertEqual("approved-private-preview", job["status"])
            self.assertTrue(all(stage["status"] == "succeeded" for stage in job["stages"]))
            draft = json.loads((job_path.parent / "08-map" / "map-draft.json").read_text(encoding="utf-8"))
            self.assertEqual({"长安", "黄州", "杭州"}, {item["place"]["label"] for item in draft["routePoints"]})
            self.assertNotIn("徐州", {item["place"]["label"] for item in draft["routePoints"]})
            package = json.loads((job_path.parent / "03-claims" / "fact-package.json").read_text(encoding="utf-8"))
            self.assertTrue(validate_fact_package(package).valid)

    def test_pdf_bytes_renamed_as_txt_are_rejected_before_quarantine(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "renamed.txt"
            path.write_bytes(b"%PDF-1.7\nnot a full document")
            with self.assertRaisesRegex(IntakeError, "content is PDF"):
                ingest_file(path, source_id="upload-mismatch", quarantine_root=Path(temporary_directory) / "quarantine")

    def test_one_command_baseline_runs_without_any_manual_review_stage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            (directory / "bio.txt").write_text("李白生于长安，后游历杭州。", encoding="utf-8")
            outcome = run_basic_pipeline(
                input_path=directory / "bio.txt",
                poet_id="li-bai",
                poet_name="李白",
                data_processing_consent=True,
                quarantine_root=directory / "quarantine",
                job_root=directory / "jobs",
            )

            self.assertTrue(outcome["completed"], outcome)
            self.assertEqual("automatic-private-preview", outcome["status"])
            self.assertEqual(2, outcome["route"]["includedRouteCount"])

    @unittest.skipIf(canvas is None, "reportlab is only required for PDF test fixtures")
    def test_text_layer_pdf_reaches_the_same_private_extract_stage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            pdf_path = directory / "bio.pdf"
            document = canvas.Canvas(str(pdf_path))
            document.drawString(72, 720, "Li Bai traveled to Chang'an and later lived there for several years.")
            document.drawString(72, 690, "This long text verifies extraction from a genuine PDF text layer.")
            document.save()
            job_path, _ = self.make_job(directory, file_name="bio.pdf", source_id="upload-li-bai-pdf")
            outcome = extract_job(job_path, quarantine_root=directory / "quarantine")

            self.assertTrue(outcome["completed"], outcome)
            report = json.loads((job_path.parent / "01-extract" / "extract-report.json").read_text(encoding="utf-8"))
            self.assertEqual("application/pdf", report["contentType"])
            self.assertEqual(1, report["pageCount"])
            self.assertIn(report["status"], {"native-ok", "partial-low-confidence"})

    @unittest.skipIf(canvas is None, "reportlab is only required for PDF test fixtures")
    def test_blank_scan_style_pdf_is_reported_without_a_false_text_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            pdf_path = directory / "scan.pdf"
            document = canvas.Canvas(str(pdf_path))
            document.showPage()
            document.save()
            job_path, _ = self.make_job(directory, file_name="scan.pdf", source_id="upload-scan-pdf")
            outcome = extract_job(job_path, quarantine_root=directory / "quarantine")

            self.assertFalse(outcome["completed"])
            self.assertEqual("scan-unsupported", outcome["status"])
            job = json.loads(job_path.read_text(encoding="utf-8"))
            self.assertEqual("pending", job["stages"][0]["status"])
            self.assertFalse((job_path.parent / "01-extract" / "segments.jsonl").exists())
            self.assertTrue((job_path.parent / "audit" / "extract-blocked.json").is_file())


if __name__ == "__main__":
    unittest.main()
