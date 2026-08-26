#!/usr/bin/env python3
"""Synchronize validated canonical published data into the web public directory.

This script intentionally has a one-way flow:

    data/published/*.json --(validate)--> web/public/data/*.json

It never reads website data as a source and never falls back to phase-A data.
Validation happens before the target directory is created or modified.

The command-line interface is validation-only by default.  Supplying
``--apply`` is required before it can write into ``web/public/data``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:
    from .validate_published_data import (
        DATASET_NAMES,
        DEFAULT_DATA_DIR,
        DEFAULT_SOURCE_MANIFEST,
        PROJECT_ROOT,
        PublishedDataValidation,
        validate_published_data,
    )
except ImportError:  # Direct execution: python scripts/sync_published_data.py
    from validate_published_data import (
        DATASET_NAMES,
        DEFAULT_DATA_DIR,
        DEFAULT_SOURCE_MANIFEST,
        PROJECT_ROOT,
        PublishedDataValidation,
        validate_published_data,
    )


DEFAULT_TARGET_DIR = PROJECT_ROOT / "web" / "public" / "data"


@dataclass(frozen=True)
class SyncResult:
    valid: bool
    synced: tuple[dict[str, str], ...]
    would_sync: tuple[dict[str, str], ...]
    error: str | None
    validation: dict[str, Any]

    def payload(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "synced": list(self.synced),
            "wouldSync": list(self.would_sync),
            "error": self.error,
            "validation": self.validation,
        }


def _read_canonical_bytes(
    data_dir: Path, validation: PublishedDataValidation
) -> tuple[dict[str, bytes] | None, str | None]:
    """Guard against a source-file change after validation and before copy."""
    payloads: dict[str, bytes] = {}
    for name in DATASET_NAMES:
        path = data_dir / f"{name}.json"
        try:
            raw = path.read_bytes()
            decoded = raw.decode("utf-8")
            reparsed = json.loads(decoded)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return None, f"Could not reread validated canonical dataset {path}: {exc}"
        if reparsed != validation.datasets.get(name):
            return None, f"Canonical dataset changed after validation: {path}"
        payloads[name] = raw
    return payloads, None


def _file_descriptor(name: str, raw: bytes) -> dict[str, str]:
    return {
        "dataset": name,
        "path": f"{name}.json",
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def _write_atomically(target_dir: Path, payloads: dict[str, bytes]) -> None:
    """Stage every file before replacing any target file."""
    target_dir.mkdir(parents=True, exist_ok=True)
    temporary_paths: list[tuple[Path, Path]] = []
    try:
        for name in DATASET_NAMES:
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{name}.", suffix=".tmp", dir=target_dir
            )
            temporary_path = Path(temporary_name)
            target_path = target_dir / f"{name}.json"
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(payloads[name])
                handle.flush()
                os.fsync(handle.fileno())
            temporary_paths.append((temporary_path, target_path))

        # All temporary writes succeeded, so each replacement is an atomic
        # filesystem operation. No unvalidated payload reaches the target.
        for temporary_path, target_path in temporary_paths:
            os.replace(temporary_path, target_path)
    except BaseException:
        for temporary_path, _ in temporary_paths:
            temporary_path.unlink(missing_ok=True)
        raise


def sync_published_data(
    data_dir: Path = DEFAULT_DATA_DIR,
    manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
    target_dir: Path = DEFAULT_TARGET_DIR,
    *,
    dry_run: bool = False,
    validate_source_catalog: bool = True,
) -> SyncResult:
    """Validate first, then copy exactly the five canonical JSON files.

    ``validate_source_catalog`` is an internal test seam. The command-line
    interface always keeps it enabled, so ordinary syncs use the full governed
    source-catalog integrity check.
    """
    data_dir = data_dir.resolve()
    target_dir = target_dir.resolve()
    validation = validate_published_data(
        data_dir,
        manifest_path,
        validate_source_catalog=validate_source_catalog,
    )
    validation_payload = validation.payload()
    if not validation.valid:
        return SyncResult(False, (), (), "Published-data validation failed.", validation_payload)

    if data_dir == target_dir:
        return SyncResult(
            False,
            (),
            (),
            "Canonical data directory and web target directory must be different.",
            validation_payload,
        )

    payloads, reread_error = _read_canonical_bytes(data_dir, validation)
    if payloads is None:
        return SyncResult(False, (), (), reread_error, validation_payload)

    descriptors = tuple(_file_descriptor(name, payloads[name]) for name in DATASET_NAMES)
    if dry_run:
        return SyncResult(True, (), descriptors, None, validation_payload)

    try:
        _write_atomically(target_dir, payloads)
    except OSError as exc:
        return SyncResult(
            False,
            (),
            (),
            f"Could not synchronize validated datasets: {exc}",
            validation_payload,
        )
    return SyncResult(True, descriptors, (), None, validation_payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate canonical published JSON; use --apply to synchronize it into web/public/data."
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    parser.add_argument("--target-dir", type=Path, default=DEFAULT_TARGET_DIR)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and list files without writing them (the default).",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Write the validated canonical datasets into the target directory.",
    )
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable result.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = sync_published_data(
        args.data_dir,
        args.manifest,
        args.target_dir,
        dry_run=not args.apply,
    )
    payload = result.payload()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        if result.error:
            print(f"ERROR: {result.error}")
        for issue in result.validation["issues"]:
            if issue["severity"] == "error":
                location = " / ".join(
                    value
                    for value in (issue["dataset"], issue["record_id"], issue["field"])
                    if value
                )
                prefix = f" [{location}]" if location else ""
                print(f"ERROR {issue['code']}{prefix}: {issue['message']}")
        if result.valid and result.would_sync:
            print("Validated successfully; dry run would synchronize:")
            for item in result.would_sync:
                print(f"- {item['path']} ({item['sha256']})")
        elif result.valid:
            print("Validated successfully and synchronized:")
            for item in result.synced:
                print(f"- {item['path']} ({item['sha256']})")
    return 0 if result.valid else 1


if __name__ == "__main__":
    sys.exit(main())
