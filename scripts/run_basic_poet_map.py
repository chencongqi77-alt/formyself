#!/usr/bin/env python3
"""Run the first fully automatic private poet-map baseline in one command.

The command is intentionally local-only:

``upload -> quarantine -> job -> text extraction -> private route draft``

It supports TXT/text-layer PDF now.  A scan with no usable text returns
``scan-unsupported`` (exit code 2) after creating its isolated job, so a
future OCR adapter can resume from the same quarantined input.  It never calls
an external model and never writes public/shared data.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from build_biography_route_draft import DEFAULT_PLACE_CATALOG, build_route_draft
from extract_biography_text import DEFAULT_MAX_SEGMENT_CHARS, DEFAULT_QUARANTINE_ROOT, extract_job
from ingest_uploaded_source import DEFAULT_MAX_BYTES, IntakeError, ingest_file, inspect_upload
from poet_map_job import (
    DEFAULT_JOB_ROOT,
    DEFAULT_RAW_MANIFEST,
    DEFAULT_SOURCE_MANIFEST,
    build_job_manifest,
    file_sha256,
    generated_job_id,
    initialize_job,
    reference_snapshots,
    require_id,
    source_record,
    utc_now,
)


class BasicPipelineError(ValueError):
    """Raised when a one-command baseline job cannot be created safely."""


def _default_source_id(poet_id: str, digest: str) -> str:
    return f"upload-{poet_id}-{digest[:12]}"


def run_basic_pipeline(
    *,
    input_path: Path,
    poet_id: str,
    poet_name: str,
    data_processing_consent: bool,
    source_id: str | None = None,
    job_id: str | None = None,
    quarantine_root: Path = DEFAULT_QUARANTINE_ROOT,
    job_root: Path = DEFAULT_JOB_ROOT,
    place_catalog: Path = DEFAULT_PLACE_CATALOG,
    raw_manifest: Path = DEFAULT_RAW_MANIFEST,
    source_manifest: Path = DEFAULT_SOURCE_MANIFEST,
    max_upload_bytes: int = DEFAULT_MAX_BYTES,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
) -> dict[str, Any]:
    """Create and advance one private, automatic baseline job."""
    require_id(poet_id, "poet id")
    if not poet_name.strip():
        raise BasicPipelineError("Poet name must not be empty.")
    if not data_processing_consent:
        raise BasicPipelineError("Data-processing consent is required to process an uploaded biography.")

    # Inspect once without writing so an automatic source id can incorporate
    # the verified input digest.  The actual admission remains atomic.
    inspection = inspect_upload(input_path, max_bytes=max_upload_bytes)
    actual_source_id = source_id or _default_source_id(poet_id, file_sha256(inspection["inputPath"]))
    receipt_outcome = ingest_file(
        input_path,
        source_id=actual_source_id,
        quarantine_root=quarantine_root,
        max_bytes=max_upload_bytes,
    )
    receipt = receipt_outcome["receipt"]
    created_at = utc_now()
    actual_job_id = job_id or generated_job_id(created_at)
    source = source_record(actual_source_id, source_manifest)
    job = build_job_manifest(
        job_id=actual_job_id,
        created_at=created_at,
        poet_id=poet_id,
        poet_name=poet_name,
        source_id=actual_source_id,
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
        source=source,
        snapshots=reference_snapshots(raw_manifest, source_manifest),
    )
    job_directory = initialize_job(job_root, job)
    job_path = job_directory / "job.json"
    extraction = extract_job(
        job_path,
        quarantine_root=quarantine_root,
        max_segment_chars=max_segment_chars,
    )
    base = {
        "jobId": actual_job_id,
        "jobPath": str(job_path),
        "sourceId": actual_source_id,
        "quarantinePath": receipt_outcome["quarantinePath"],
        "inputContentType": receipt["detectedContentType"],
        "extraction": extraction,
    }
    if not extraction["completed"]:
        return {**base, "completed": False, "status": extraction["status"]}
    route = build_route_draft(job_path, place_catalog=place_catalog)
    return {**base, "completed": True, "status": route["status"], "route": route}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Local .txt, .text, .md, or .pdf biography upload.")
    parser.add_argument("--poet-id", required=True, help="Stable lowercase kebab-case id for this poet.")
    parser.add_argument("--poet-name", required=True, help="Display name of the target poet.")
    parser.add_argument("--data-processing-consent", action="store_true", help="Required to copy and process the private upload.")
    parser.add_argument("--source-id", help="Optional new private upload id; defaults to a hash-based id.")
    parser.add_argument("--job-id", help="Optional new pmj job id; defaults to a generated id.")
    parser.add_argument("--quarantine-root", type=Path, default=DEFAULT_QUARANTINE_ROOT)
    parser.add_argument("--job-root", type=Path, default=DEFAULT_JOB_ROOT)
    parser.add_argument("--place-catalog", type=Path, default=DEFAULT_PLACE_CATALOG)
    parser.add_argument("--raw-manifest", type=Path, default=DEFAULT_RAW_MANIFEST)
    parser.add_argument("--source-manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    parser.add_argument("--max-upload-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--max-segment-chars", type=int, default=DEFAULT_MAX_SEGMENT_CHARS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        outcome = run_basic_pipeline(
            input_path=args.input,
            poet_id=args.poet_id,
            poet_name=args.poet_name,
            data_processing_consent=args.data_processing_consent,
            source_id=args.source_id,
            job_id=args.job_id,
            quarantine_root=args.quarantine_root,
            job_root=args.job_root,
            place_catalog=args.place_catalog,
            raw_manifest=args.raw_manifest,
            source_manifest=args.source_manifest,
            max_upload_bytes=args.max_upload_bytes,
            max_segment_chars=args.max_segment_chars,
        )
    except (BasicPipelineError, IntakeError, ValueError) as exc:
        print(f"Basic poet-map pipeline error: {exc}", file=os.sys.stderr)
        return 1
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    return 0 if outcome["completed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
