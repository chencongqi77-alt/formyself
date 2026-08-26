#!/usr/bin/env python3
"""Extract deterministic, job-local biography text from a quarantined upload.

This is the second step of the small automatic baseline:

``var/quarantine/<source-id>`` -> ``var/jobs/<job-id>/00-intake,01-extract``

It supports validated text and text-layer PDFs.  A scanned, encrypted, or
otherwise unreadable PDF is reported as a machine-readable blocked status;
the pipeline never invents text or lets a language model guess from a blank
document.  No global data and no frontend files are changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Iterable

from ingest_uploaded_source import IntakeError, detect_text_encoding
from poet_map_job import (
    PROJECT_ROOT,
    complete_stages,
    file_sha256,
    job_root_for_manifest,
    load_job,
    make_artifact,
    read_json,
    relative_path_is_safe,
    write_json_atomically,
)


DEFAULT_QUARANTINE_ROOT = PROJECT_ROOT / "var" / "quarantine"
DEFAULT_MAX_SEGMENT_CHARS = 1200
EXTRACTOR_VERSION = "biography-extract-v1"
REPORT_RECORD_TYPE = "biography-extraction-report"
SEGMENT_RECORD_TYPE = "biography-text-segment"


class ExtractionError(ValueError):
    """Raised for an invalid job/input relationship or a failed extractor."""


class ExtractionBlocked(ExtractionError):
    """A valid input that needs an unavailable capability such as OCR."""

    def __init__(self, status: str, message: str, report: dict[str, Any]) -> None:
        super().__init__(message)
        self.status = status
        self.report = report


def _normalise_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _text_quality(text: str) -> dict[str, float | int | bool]:
    if not text:
        return {
            "characterCount": 0,
            "usableCharacterCount": 0,
            "printableRatio": 0.0,
            "replacementCharacterRatio": 0.0,
            "controlCharacterRatio": 0.0,
            "cjkRatio": 0.0,
            "lowQuality": True,
        }
    usable = [char for char in text if not char.isspace()]
    printable = sum(1 for char in text if char.isprintable() or char in "\n\r\t\f")
    replacements = text.count("\ufffd")
    controls = sum(1 for char in text if ord(char) < 32 and char not in "\n\r\t\f")
    cjk = sum(1 for char in usable if "\u3400" <= char <= "\u9fff")
    usable_count = len(usable)
    printable_ratio = printable / len(text)
    replacement_ratio = replacements / len(text)
    control_ratio = controls / len(text)
    return {
        "characterCount": len(text),
        "usableCharacterCount": usable_count,
        "printableRatio": round(printable_ratio, 6),
        "replacementCharacterRatio": round(replacement_ratio, 6),
        "controlCharacterRatio": round(control_ratio, 6),
        "cjkRatio": round(cjk / usable_count, 6) if usable_count else 0.0,
        "lowQuality": usable_count < 40 or printable_ratio < 0.95 or replacement_ratio > 0.01 or control_ratio > 0.02,
    }


def _load_pdf_text(path: Path) -> tuple[list[str], list[dict[str, Any]], list[str], dict[str, str]]:
    """Extract each PDF page with pypdf, retrying weak pages via pdfplumber."""
    try:
        import pypdf  # type: ignore[import-not-found]
    except ImportError as exc:
        raise ExtractionError("PDF support is unavailable: install pypdf from requirements-agent.txt.") from exc

    versions = {"pypdf": getattr(pypdf, "__version__", "unknown")}
    warnings: list[str] = []
    try:
        reader = pypdf.PdfReader(str(path), strict=False)
    except Exception as exc:  # pypdf uses several parser exception classes.
        raise ExtractionError(f"PDF could not be opened: {exc}") from exc
    try:
        if reader.is_encrypted:
            try:
                unlocked = reader.decrypt("")
            except Exception:
                unlocked = 0
            if not unlocked:
                report = {
                    "recordType": REPORT_RECORD_TYPE,
                    "schemaVersion": "1.0.0",
                    "extractorVersion": EXTRACTOR_VERSION,
                    "status": "encrypted-pdf",
                    "pageCount": 0,
                    "pages": [],
                    "warnings": ["PDF is encrypted and cannot be opened without a password."],
                    "backends": versions,
                }
                raise ExtractionBlocked("encrypted-pdf", "PDF is encrypted and requires a password.", report)
        page_count = len(reader.pages)
        page_texts: list[str] = []
        page_metadata: list[dict[str, Any]] = []
        fallback_indexes: list[int] = []
        for index, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception as exc:
                text = ""
                warnings.append(f"pypdf-page-error:{index}:{type(exc).__name__}")
            text = _normalise_newlines(text)
            quality = _text_quality(text)
            page_texts.append(text)
            page_metadata.append({"page": index, "method": "pypdf", **quality})
            if bool(quality["lowQuality"]):
                fallback_indexes.append(index)
    finally:
        close = getattr(reader, "close", None)
        if callable(close):
            close()

    if fallback_indexes:
        try:
            import pdfplumber  # type: ignore[import-not-found]
        except ImportError:
            warnings.append("pdfplumber-unavailable: low-quality native pages were not retried.")
        else:
            versions["pdfplumber"] = getattr(pdfplumber, "__version__", "unknown")
            try:
                with pdfplumber.open(str(path)) as document:
                    if len(document.pages) != len(page_texts):
                        warnings.append("pdfplumber-page-count-mismatch")
                    for page_number in fallback_indexes:
                        try:
                            alternative = _normalise_newlines(
                                document.pages[page_number - 1].extract_text() or ""
                            )
                        except Exception as exc:
                            warnings.append(f"pdfplumber-page-error:{page_number}:{type(exc).__name__}")
                            continue
                        alternative_quality = _text_quality(alternative)
                        original_quality = _text_quality(page_texts[page_number - 1])
                        if int(alternative_quality["usableCharacterCount"]) > int(
                            original_quality["usableCharacterCount"]
                        ):
                            page_texts[page_number - 1] = alternative
                            page_metadata[page_number - 1] = {
                                "page": page_number,
                                "method": "pdfplumber",
                                "fallbackFrom": "pypdf",
                                **alternative_quality,
                            }
                        else:
                            page_metadata[page_number - 1]["fallbackAttempted"] = "pdfplumber"
            except Exception as exc:
                warnings.append(f"pdfplumber-document-error:{type(exc).__name__}")

    usable_total = sum(int(page["usableCharacterCount"]) for page in page_metadata)
    low_quality_pages = [page["page"] for page in page_metadata if page["lowQuality"]]
    if low_quality_pages:
        warnings.append("low-quality-pages:" + ",".join(str(page) for page in low_quality_pages))
    if usable_total == 0:
        report = {
            "recordType": REPORT_RECORD_TYPE,
            "schemaVersion": "1.0.0",
            "extractorVersion": EXTRACTOR_VERSION,
            "status": "scan-unsupported",
            "pageCount": page_count,
            "pages": page_metadata,
            "warnings": [
                *warnings,
                "No usable text layer was found. Local OCR is intentionally not assumed by this pipeline.",
            ],
            "backends": versions,
        }
        raise ExtractionBlocked(
            "scan-unsupported",
            "PDF has no usable text layer; configure an OCR adapter before continuing.",
            report,
        )
    return page_texts, page_metadata, warnings, versions


def _read_receipt(job: dict[str, Any], quarantine_root: Path) -> tuple[dict[str, Any], Path]:
    input_record = job.get("input")
    if not isinstance(input_record, dict):
        raise ExtractionError("Job input record is invalid.")
    source_id = input_record.get("sourceId")
    if not isinstance(source_id, str):
        raise ExtractionError("Job input has no sourceId.")
    source_directory = (quarantine_root.resolve() / source_id).resolve()
    root = quarantine_root.resolve()
    try:
        source_directory.relative_to(root)
    except ValueError as exc:
        raise ExtractionError("Job source id resolves outside the configured quarantine root.") from exc
    receipt = read_json(source_directory / "receipt.json", "Upload receipt")
    if not isinstance(receipt, dict):
        raise ExtractionError("Upload receipt must be a JSON object.")
    if receipt.get("recordType") != "upload-intake-receipt":
        raise ExtractionError("Upload receipt has an unexpected record type.")
    if receipt.get("sourceId") != source_id:
        raise ExtractionError("Upload receipt sourceId does not match the job.")
    if receipt.get("sha256") != input_record.get("blobSha256"):
        raise ExtractionError("Upload receipt SHA-256 does not match the job input.")
    if receipt.get("detectedContentType") != input_record.get("contentType"):
        raise ExtractionError("Upload receipt content type does not match the job input.")
    stored_file = receipt.get("storedFile")
    if not isinstance(stored_file, str) or not relative_path_is_safe(stored_file):
        raise ExtractionError("Upload receipt has an unsafe storedFile path.")
    source_path = (source_directory / stored_file).resolve()
    try:
        source_path.relative_to(source_directory)
    except ValueError as exc:
        raise ExtractionError("Upload receipt storedFile resolves outside quarantine.") from exc
    if not source_path.is_file():
        raise ExtractionError("Quarantined upload blob is missing.")
    if file_sha256(source_path) != receipt["sha256"]:
        raise ExtractionError("Quarantined upload blob does not match its receipt SHA-256.")
    return receipt, source_path


def _trim_span(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _break_span(text: str, start: int, end: int, max_chars: int) -> Iterable[tuple[int, int]]:
    """Split a non-empty source span, preferring paragraph/Chinese punctuation."""
    cursor = start
    separators = "\n。！？；.!?;"
    while cursor < end:
        limit = min(cursor + max_chars, end)
        if limit < end:
            boundary = max((text.rfind(separator, cursor + 1, limit + 1) for separator in separators), default=-1)
            if boundary > cursor + max_chars // 3:
                limit = boundary + 1
        part_start, part_end = _trim_span(text, cursor, limit)
        if part_start < part_end:
            yield part_start, part_end
        cursor = limit


def text_spans(text: str, max_chars: int) -> list[tuple[int, int]]:
    """Return stable, non-blank spans without modifying their source offsets."""
    if max_chars < 200:
        raise ExtractionError("Maximum segment length must be at least 200 characters.")
    spans: list[tuple[int, int]] = []
    # A paragraph has content bounded by two blank-line boundaries.  The exact
    # source offsets remain valid even after we trim formatting whitespace.
    pattern = re.compile(r"\S(?:.*?\S)?(?=(?:\n[ \t]*){2,}|[ \t\r\n]*\Z)", re.DOTALL)
    for paragraph in pattern.finditer(text):
        spans.extend(_break_span(text, paragraph.start(), paragraph.end(), max_chars))
    return spans


def _line_range(text: str, start: int, end: int) -> tuple[int, int]:
    start_line = text.count("\n", 0, start) + 1
    end_line = text.count("\n", 0, max(start, end - 1)) + 1
    return start_line, end_line


def _segment_id(input_sha256: str, page: int | None, start: int, end: int) -> str:
    seed = f"{EXTRACTOR_VERSION}|{input_sha256}|{page if page is not None else 'text'}|{start}|{end}"
    return "seg-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]


def build_segments(
    *,
    job_id: str,
    input_sha256: str,
    pages: Iterable[tuple[int | None, str]],
    max_segment_chars: int,
) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for page, page_text in pages:
        for start, end in text_spans(page_text, max_segment_chars):
            value = page_text[start:end]
            line_start, line_end = _line_range(page_text, start, end)
            locator: dict[str, Any]
            if page is None:
                locator = {
                    "kind": "line-range",
                    "startLine": line_start,
                    "endLine": line_end,
                    "charStart": start,
                    "charEnd": end,
                }
            else:
                locator = {
                    "kind": "page-char-span",
                    "page": page,
                    "charStart": start,
                    "charEnd": end,
                    "startLine": line_start,
                    "endLine": line_end,
                }
            record: dict[str, Any] = {
                "recordType": SEGMENT_RECORD_TYPE,
                "schemaVersion": "1.0.0",
                "id": _segment_id(input_sha256, page, start, end),
                "jobId": job_id,
                "ordinal": len(segments) + 1,
                "charStart": start,
                "charEnd": end,
                "text": value,
                "textSha256": hashlib.sha256(value.encode("utf-8")).hexdigest(),
                "locator": locator,
            }
            if page is not None:
                record["page"] = page
            segments.append(record)
    if not segments:
        raise ExtractionBlocked(
            "no-text",
            "Upload contains no non-blank text to map.",
            {
                "recordType": REPORT_RECORD_TYPE,
                "schemaVersion": "1.0.0",
                "extractorVersion": EXTRACTOR_VERSION,
                "status": "no-text",
                "pageCount": 0,
                "pages": [],
                "warnings": ["No non-blank text segments were produced."],
                "backends": {},
            },
        )
    return segments


def _write_text_atomically(path: Path, value: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _pending_stage(job: dict[str, Any], name: str) -> bool:
    return any(isinstance(stage, dict) and stage.get("name") == name and stage.get("status") == "pending" for stage in job.get("stages", []))


def extract_job(
    job_path: Path,
    *,
    quarantine_root: Path = DEFAULT_QUARANTINE_ROOT,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Copy a verified private upload into its job and complete intake/extract."""
    job = load_job(job_path)
    root = job_root_for_manifest(job_path, job)
    if job.get("input", {}).get("dataProcessingConsent") is not True:
        raise ExtractionError("The job lacks data-processing consent.")
    if not _pending_stage(job, "intake") or not _pending_stage(job, "extract"):
        raise ExtractionError("Intake and extract stages must both be pending; create a new job to rerun them.")
    receipt, source_path = _read_receipt(job, quarantine_root)
    content_type = receipt["detectedContentType"]
    source_suffix = source_path.suffix.lower()

    try:
        if content_type == "application/pdf":
            page_texts, page_metadata, warnings, backends = _load_pdf_text(source_path)
            pages = list(enumerate(page_texts, start=1))
            status = "partial-low-confidence" if any(page["lowQuality"] for page in page_metadata) else "native-ok"
            source_details: dict[str, Any] = {"pageCount": len(page_texts), "pages": page_metadata}
        elif content_type in {"text/plain", "text/markdown"}:
            raw = source_path.read_bytes()
            checks = receipt.get("checks") if isinstance(receipt.get("checks"), dict) else {}
            encoding = checks.get("encoding")
            if not isinstance(encoding, str):
                encoding, _ = detect_text_encoding(raw)
            try:
                text = raw.decode(encoding, errors="strict")
            except UnicodeDecodeError as exc:
                raise ExtractionError("Quarantined text does not match the encoding recorded at intake.") from exc
            text = _normalise_newlines(text)
            pages = [(None, text)]
            page_metadata = [{"page": None, "method": "native-text", **_text_quality(text)}]
            warnings = []
            backends = {"textDecoder": encoding}
            source_details = {"pageCount": 1, "pages": page_metadata}
            status = "text-ok"
        else:
            raise ExtractionError(f"Receipt content type is not supported by the extractor: {content_type}")
        segments = build_segments(
            job_id=job["jobId"],
            input_sha256=job["input"]["blobSha256"],
            pages=pages,
            max_segment_chars=max_segment_chars,
        )
    except IntakeError as exc:
        raise ExtractionError(str(exc)) from exc
    except ExtractionBlocked as blocked:
        blocked_path = root / "audit" / "extract-blocked.json"
        blocked_report = {
            **blocked.report,
            "jobId": job["jobId"],
            "sourceId": job["input"]["sourceId"],
            "inputSha256": job["input"]["blobSha256"],
            "contentType": content_type,
        }
        if not dry_run and not blocked_path.exists():
            write_json_atomically(blocked_path, blocked_report)
        return {
            "jobId": job["jobId"],
            "completed": False,
            "status": blocked.status,
            "message": str(blocked),
            "report": blocked_report,
            "blockedReportPath": str(blocked_path),
        }

    report: dict[str, Any] = {
        "recordType": REPORT_RECORD_TYPE,
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "sourceId": job["input"]["sourceId"],
        "inputSha256": job["input"]["blobSha256"],
        "contentType": content_type,
        "extractorVersion": EXTRACTOR_VERSION,
        "status": status,
        "segmentCount": len(segments),
        "extractedCharacterCount": sum(len(segment["text"]) for segment in segments),
        "warnings": warnings,
        "backends": backends,
        **source_details,
    }
    original_relative = f"00-intake/original{source_suffix}"
    receipt_relative = "00-intake/receipt.json"
    segments_relative = "01-extract/segments.jsonl"
    report_relative = "01-extract/extract-report.json"
    outputs = [root / relative for relative in (original_relative, receipt_relative, segments_relative, report_relative)]
    existing = [path for path in outputs if path.exists()]
    if existing:
        raise ExtractionError(
            "Job already contains immutable intake/extract output; refusing to overwrite: "
            + ", ".join(str(path.relative_to(root)) for path in existing)
        )

    if dry_run:
        return {
            "jobId": job["jobId"],
            "completed": False,
            "dryRun": True,
            "status": status,
            "segmentCount": len(segments),
            "report": report,
        }

    _write_text_atomically(root / segments_relative, "".join(
        json.dumps(segment, ensure_ascii=False, separators=(",", ":")) + "\n" for segment in segments
    ))
    try:
        # Source copy is created only after extraction has succeeded in memory.
        from ingest_uploaded_source import copy_file_atomically

        copy_file_atomically(source_path, root / original_relative)
        write_json_atomically(root / receipt_relative, receipt)
        write_json_atomically(root / report_relative, report)
        artifacts = [
            make_artifact(
                root,
                stage="intake",
                artifact_id="intake-original",
                record_type="private-upload-blob",
                relative_path=original_relative,
            ),
            make_artifact(
                root,
                stage="intake",
                artifact_id="intake-receipt",
                record_type="upload-intake-receipt",
                relative_path=receipt_relative,
                parent_artifact_ids=("intake-original",),
            ),
            make_artifact(
                root,
                stage="extract",
                artifact_id="extract-segments",
                record_type="biography-text-segments",
                relative_path=segments_relative,
                parent_artifact_ids=("intake-original", "intake-receipt"),
            ),
            make_artifact(
                root,
                stage="extract",
                artifact_id="extract-report",
                record_type=REPORT_RECORD_TYPE,
                relative_path=report_relative,
                parent_artifact_ids=("extract-segments",),
            ),
        ]
        complete_stages(
            job_path,
            stage_names=("intake", "extract"),
            artifacts=artifacts,
            actor="extract-biography-text:v1",
            reason="Verified upload copied into the private job and text segments extracted.",
            final_status="running",
        )
    except BaseException:
        # Do not erase stage artifacts: they may be useful private diagnostics
        # and the manifest remains unadvanced if registration was not atomic.
        raise
    return {
        "jobId": job["jobId"],
        "completed": True,
        "dryRun": False,
        "status": status,
        "segmentCount": len(segments),
        "reportPath": str(root / report_relative),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True, help="Path to var/jobs/<job-id>/job.json.")
    parser.add_argument("--quarantine-root", type=Path, default=DEFAULT_QUARANTINE_ROOT)
    parser.add_argument("--max-segment-chars", type=int, default=DEFAULT_MAX_SEGMENT_CHARS)
    parser.add_argument("--dry-run", action="store_true", help="Extract and validate without writing job artifacts.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        outcome = extract_job(
            args.job,
            quarantine_root=args.quarantine_root,
            max_segment_chars=args.max_segment_chars,
            dry_run=args.dry_run,
        )
    except ExtractionError as exc:
        print(f"Biography extraction error: {exc}", file=os.sys.stderr)
        return 1
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    return 0 if outcome["completed"] or outcome.get("dryRun") else 2


if __name__ == "__main__":
    raise SystemExit(main())
