#!/usr/bin/env python3
"""Quarantine one local biography upload and create a private intake receipt.

The script intentionally supports a small, deterministic first boundary:
plain-text files (``.txt``, ``.text`` and ``.md``) and PDFs.  It does not
write to the shared staging, record, release, or frontend directories.

Examples
--------
    python scripts/ingest_uploaded_source.py \
      --input C:\\uploads\\li-bai.txt \
      --source-id upload-li-bai-20260803

The resulting receipt supplies the verified SHA-256 and content type needed
by ``poet_map_job.py init``.  A later step copies the isolated input into the
job directory; the upload itself remains under ``var/quarantine``.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from poet_map_job import PROJECT_ROOT, file_sha256, require_id, utc_now, write_json_atomically


DEFAULT_QUARANTINE_ROOT = PROJECT_ROOT / "var" / "quarantine"
DEFAULT_MAX_BYTES = 50 * 1024 * 1024
RECEIPT_RECORD_TYPE = "upload-intake-receipt"
RECEIPT_SCHEMA_VERSION = "1.0.0"

TEXT_EXTENSIONS = {".txt": "text/plain", ".text": "text/plain", ".md": "text/markdown"}
PDF_EXTENSION = ".pdf"


class IntakeError(ValueError):
    """Raised when a file must not be admitted to private quarantine."""


def _control_ratio(text: str) -> float:
    if not text:
        return 0.0
    controls = sum(1 for char in text if ord(char) < 32 and char not in "\n\r\t\f")
    return controls / len(text)


def detect_text_encoding(raw: bytes) -> tuple[str, dict[str, float]]:
    """Strictly decode a text upload without silently replacing bad bytes."""
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        candidates = ("utf-16",)
    elif raw.startswith(b"\xef\xbb\xbf"):
        candidates = ("utf-8-sig",)
    else:
        # GB18030 covers common Windows Chinese text exports.  It comes after
        # UTF-8 so a normal UTF-8 document is never needlessly relabelled.
        candidates = ("utf-8", "gb18030")

    failures: list[str] = []
    for encoding in candidates:
        try:
            decoded = raw.decode(encoding, errors="strict")
        except UnicodeDecodeError:
            failures.append(encoding)
            continue
        controls = _control_ratio(decoded)
        if controls > 0.02:
            raise IntakeError("The declared text file contains too many binary control characters.")
        return encoding, {"controlCharacterRatio": round(controls, 6), "replacementCharacterRatio": 0.0}
    tried = ", ".join(failures) or "no supported encoding"
    raise IntakeError(f"Text upload is not valid UTF-8, UTF-16, or GB18030 ({tried}).")


def inspect_upload(input_path: Path, *, max_bytes: int) -> dict[str, Any]:
    """Check extension, size, signature, and text encoding before copying."""
    try:
        resolved = input_path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise IntakeError(f"Upload file does not exist: {input_path}") from exc
    if not resolved.is_file():
        raise IntakeError(f"Upload path must be a file: {input_path}")

    extension = resolved.suffix.lower()
    if extension not in {*TEXT_EXTENSIONS, PDF_EXTENSION}:
        raise IntakeError("Only .txt, .text, .md, and .pdf uploads are supported in the first pipeline.")
    size_bytes = resolved.stat().st_size
    if size_bytes == 0:
        raise IntakeError("Upload file is empty.")
    if size_bytes > max_bytes:
        raise IntakeError(f"Upload exceeds the {max_bytes} byte intake limit.")

    raw = resolved.read_bytes()
    pdf_offset = raw[:1024].find(b"%PDF-")
    is_pdf = pdf_offset >= 0
    if is_pdf:
        if extension != PDF_EXTENSION:
            raise IntakeError("File content is PDF but its extension is not .pdf; refusing a MIME mismatch.")
        return {
            "inputPath": resolved,
            "declaredExtension": extension,
            "detectedContentType": "application/pdf",
            "sizeBytes": size_bytes,
            "magic": "pdf-header" if pdf_offset == 0 else "pdf-header-with-prefix",
            "textEncoding": None,
            "textQuality": None,
        }

    if extension == PDF_EXTENSION:
        raise IntakeError("File extension is .pdf but the PDF signature is missing.")
    has_utf16_bom = raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff")
    if b"\x00" in raw and not has_utf16_bom:
        raise IntakeError("Text upload contains NUL bytes without a UTF-16 byte-order mark.")
    encoding, quality = detect_text_encoding(raw)
    return {
        "inputPath": resolved,
        "declaredExtension": extension,
        "detectedContentType": TEXT_EXTENSIONS[extension],
        "sizeBytes": size_bytes,
        "magic": "validated-text",
        "textEncoding": encoding,
        "textQuality": quality,
    }


def copy_file_atomically(source: Path, destination: Path) -> None:
    """Copy to a same-directory temporary file before making it visible."""
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as input_handle:
            while chunk := input_handle.read(1024 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, destination)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def _remove_new_quarantine_directory(path: Path) -> None:
    """Best-effort cleanup limited to a directory created by this invocation."""
    for child in path.iterdir():
        if child.is_file():
            child.unlink(missing_ok=True)
    path.rmdir()


def ingest_file(
    input_path: Path,
    *,
    source_id: str,
    quarantine_root: Path = DEFAULT_QUARANTINE_ROOT,
    max_bytes: int = DEFAULT_MAX_BYTES,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Admit one verified upload into a new private quarantine directory."""
    require_id(source_id, "source id")
    if max_bytes <= 0:
        raise IntakeError("Maximum upload size must be positive.")
    inspection = inspect_upload(input_path, max_bytes=max_bytes)
    source = inspection["inputPath"]
    extension = inspection["declaredExtension"]
    target = (quarantine_root.resolve() / source_id).resolve()
    root = quarantine_root.resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise IntakeError("Source id resolves outside the configured quarantine root.") from exc
    if target.exists():
        raise IntakeError(f"Quarantine directory already exists; refusing to overwrite: {target}")

    stored_file = f"source{extension}"
    receipt: dict[str, Any] = {
        "recordType": RECEIPT_RECORD_TYPE,
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "sourceId": source_id,
        "receivedAt": utc_now(),
        "originalFilename": source.name,
        "declaredExtension": extension,
        "detectedContentType": inspection["detectedContentType"],
        "sizeBytes": inspection["sizeBytes"],
        "sha256": file_sha256(source),
        "storedFile": stored_file,
        "checks": {
            "magic": inspection["magic"],
            "extensionMatchesDetected": True,
        },
    }
    if inspection["textEncoding"] is not None:
        receipt["checks"]["encoding"] = inspection["textEncoding"]
        receipt["checks"]["textQuality"] = inspection["textQuality"]

    if dry_run:
        return {"receipt": receipt, "quarantinePath": str(target), "dryRun": True}

    try:
        target.mkdir(parents=True)
    except FileExistsError as exc:
        raise IntakeError(f"Quarantine directory already exists; refusing to overwrite: {target}") from exc
    try:
        copy_file_atomically(source, target / stored_file)
        if file_sha256(target / stored_file) != receipt["sha256"]:
            raise IntakeError("Copied quarantine file does not match its source SHA-256.")
        write_json_atomically(target / "receipt.json", receipt)
    except BaseException:
        _remove_new_quarantine_directory(target)
        raise
    return {"receipt": receipt, "quarantinePath": str(target), "dryRun": False}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Local upload file to validate and quarantine.")
    parser.add_argument("--source-id", required=True, help="New lowercase kebab-case private upload id.")
    parser.add_argument("--quarantine-root", type=Path, default=DEFAULT_QUARANTINE_ROOT)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--dry-run", action="store_true", help="Inspect only; do not create a quarantine directory.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        outcome = ingest_file(
            args.input,
            source_id=args.source_id,
            quarantine_root=args.quarantine_root,
            max_bytes=args.max_bytes,
            dry_run=args.dry_run,
        )
    except (IntakeError, ValueError) as exc:
        print(f"Upload intake error: {exc}", file=os.sys.stderr)
        return 1
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
