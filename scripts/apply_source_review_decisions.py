#!/usr/bin/env python3
"""Apply explicit, evidence-backed source review decisions to the catalog."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = PROJECT_ROOT / "source-materials" / "source-manifest.json"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path: Path, payload: Any) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        Path(temporary_name).replace(path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="把明确的质量审核决定写入来源清单。"
    )
    parser.add_argument("decisions", type=Path)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    decisions = load_json(args.decisions.resolve())
    evidence = load_json(args.evidence.resolve())
    manifest_path = args.manifest.resolve()
    manifest = load_json(manifest_path)

    if decisions.get("schemaVersion") != "1.0.0":
        raise ValueError("decision schemaVersion must be 1.0.0")
    evidence_by_id = {
        result["sourceId"]: result for result in evidence.get("results", [])
    }
    records_by_id = {record["id"]: record for record in manifest["sources"]}
    applied: list[str] = []

    for decision in decisions.get("decisions", []):
        source_id = decision["sourceId"]
        record = records_by_id.get(source_id)
        if record is None:
            raise ValueError(f"unknown source: {source_id}")
        source_evidence = evidence_by_id.get(source_id)
        if source_evidence is None or source_evidence.get("passed") is not True:
            raise ValueError(f"quality evidence did not pass: {source_id}")
        if decision.get("ingestionStatus") == "approved":
            if record.get("materializationStatus") != "local":
                raise ValueError(f"approved source is not local: {source_id}")
            if record.get("rights", {}).get("reviewStatus") != "verified":
                raise ValueError(f"approved source rights are not verified: {source_id}")
            local_path = record.get("localPath", "")
            if Path(local_path).suffix:
                if "artifact" not in record:
                    raise ValueError(f"file source lacks artifact digest: {source_id}")
            elif "snapshot" not in record:
                raise ValueError(f"directory source lacks content snapshot: {source_id}")

        for field in (
            "coverage",
            "quality",
            "ingestionStatus",
            "allowedUses",
            "blockReasons",
            "keyLocators",
            "review",
        ):
            if field in decision:
                if args.check and record.get(field) != decision[field]:
                    raise ValueError(
                        f"manifest field differs from decision: {source_id}.{field}"
                    )
                record[field] = decision[field]
        applied.append(source_id)

    expected_count = decisions.get("decisionCount")
    if expected_count != len(applied):
        raise ValueError(
            f"decisionCount mismatch: expected {expected_count}, applied {len(applied)}"
        )

    if args.check:
        print(f"review decisions valid: {len(applied)}")
        return 0
    write_json_atomic(manifest_path, manifest)
    print(f"review decisions applied: {len(applied)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
