#!/usr/bin/env python3
"""Build the project-wide raw-layer integrity manifest without VCS metadata."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

try:
    from .build_source_snapshots import build_inventory, write_json_atomic
except ImportError:
    from build_source_snapshots import build_inventory, write_json_atomic


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_MANIFEST_PATH = PROJECT_ROOT / "data" / "raw-layer-manifest.json"
POETRY_INVENTORY_PATH = (
    PROJECT_ROOT / "data" / "raw-inventories" / "chinese-poetry.snapshot.json"
)
CBDB_METADATA_PATH = PROJECT_ROOT / "cbdb" / "cbdb_20260718.json"
SOURCE_MANIFEST_PATH = PROJECT_ROOT / "source-materials" / "source-manifest.json"


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def main() -> int:
    cbdb_metadata = load_json(CBDB_METADATA_PATH)
    cbdb_path = PROJECT_ROOT / "cbdb" / cbdb_metadata["sqlite_filename"]
    cbdb_hash = hash_file(cbdb_path)
    if cbdb_hash != cbdb_metadata["sha256"]:
        raise ValueError("CBDB hash does not match its canonical metadata")

    poetry_root = PROJECT_ROOT / "chinese-poetry"
    poetry_inventory = build_inventory(
        "chinese-poetry", poetry_root, "chinese-poetry"
    )
    write_json_atomic(POETRY_INVENTORY_PATH, poetry_inventory)

    source_manifest = load_json(SOURCE_MANIFEST_PATH)
    source_count = len(source_manifest["sources"])
    approved_count = sum(
        record.get("ingestionStatus") == "approved"
        for record in source_manifest["sources"]
    )
    payload = {
        "schemaVersion": "1.0.0",
        "generatedAt": date.today().isoformat(),
        "integrityModel": "single files use SHA-256; directories use sorted per-file SHA-256 inventories",
        "characterPolicy": {
            "canonicalScript": "Simplified Chinese",
            "encoding": "UTF-8",
            "converter": "OpenCC 1.4.1",
            "configuration": "t2s.json",
            "stability": "repeat-until-stable",
        },
        "datasets": [
            {
                "id": "cbdb-20260718",
                "type": "sqlite",
                "path": "cbdb/cbdb_20260718.sqlite3",
                "metadataPath": "cbdb/cbdb_20260718.json",
                "sizeBytes": cbdb_path.stat().st_size,
                "sha256": cbdb_hash,
            },
            {
                "id": "chinese-poetry",
                "type": "directory-snapshot",
                "path": "chinese-poetry",
                "inventoryPath": "data/raw-inventories/chinese-poetry.snapshot.json",
                "fileCount": poetry_inventory["fileCount"],
                "totalBytes": poetry_inventory["totalBytes"],
                "digest": poetry_inventory["digest"],
            },
            {
                "id": "source-materials",
                "type": "governed-catalog",
                "path": "source-materials/source-manifest.json",
                "schemaVersion": source_manifest["schemaVersion"],
                "policyVersion": source_manifest["policyVersion"],
                "sourceCount": source_count,
                "approvedCount": approved_count,
                "sha256": hash_file(SOURCE_MANIFEST_PATH),
            },
        ],
    }
    write_json_atomic(RAW_MANIFEST_PATH, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
