#!/usr/bin/env python3
"""Build byte-level inventories for directory-shaped raw sources.

The snapshot is independent of any version-control system.  Every regular file
is recorded with its relative path, byte size and SHA-256.  A deterministic
digest over the ordered inventory gives the source catalog a compact integrity
key while the inventory preserves file-level auditability.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "source-materials"
DEFAULT_MANIFEST = SOURCE_ROOT / "source-manifest.json"
INVENTORY_ROOT = SOURCE_ROOT / "inventories"


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_inventory(source_id: str, root: Path, local_path: str) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    total_bytes = 0
    snapshot_digest = hashlib.sha256()

    paths = sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    for path in paths:
        relative_path = path.relative_to(root).as_posix()
        size_bytes = path.stat().st_size
        sha256 = hash_file(path)
        entry = {
            "path": relative_path,
            "sizeBytes": size_bytes,
            "sha256": sha256,
        }
        files.append(entry)
        total_bytes += size_bytes
        snapshot_digest.update(relative_path.encode("utf-8"))
        snapshot_digest.update(b"\0")
        snapshot_digest.update(str(size_bytes).encode("ascii"))
        snapshot_digest.update(b"\0")
        snapshot_digest.update(bytes.fromhex(sha256))
        snapshot_digest.update(b"\n")

    return {
        "schemaVersion": "1.0.0",
        "sourceId": source_id,
        "generatedAt": date.today().isoformat(),
        "root": local_path,
        "algorithm": "sha256",
        "digestSpecification": "sha256(path_utf8 + NUL + size_ascii + NUL + file_sha256_bytes + LF), sorted by path",
        "fileCount": len(files),
        "totalBytes": total_bytes,
        "digest": snapshot_digest.hexdigest(),
        "files": files,
    }


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
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


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sources"), list):
        raise ValueError("source manifest must contain a sources array")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="为目录型原始来源生成逐文件 SHA-256 快照。"
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--source-id",
        action="append",
        help="只处理指定来源；可重复。默认处理全部本地目录型来源。",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="仅重新计算并检查现有清单，不写文件。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    manifest = load_manifest(manifest_path)
    selected_ids = set(args.source_id or [])
    found_ids: set[str] = set()
    changed = False

    for record in manifest["sources"]:
        if not isinstance(record, dict):
            continue
        source_id = record.get("id")
        local_path = record.get("localPath")
        if not isinstance(source_id, str) or not isinstance(local_path, str):
            continue
        if selected_ids and source_id not in selected_ids:
            continue
        if record.get("materializationStatus") != "local":
            continue
        pure_path = PurePosixPath(local_path)
        if pure_path.suffix:
            continue
        source_path = SOURCE_ROOT.joinpath(*pure_path.parts).resolve()
        if not source_path.is_dir():
            raise FileNotFoundError(f"{source_id}: directory missing: {source_path}")

        found_ids.add(source_id)
        inventory = build_inventory(source_id, source_path, local_path)
        inventory_relative = f"inventories/{source_id}.snapshot.json"
        inventory_path = SOURCE_ROOT / inventory_relative
        snapshot = {
            "inventoryPath": inventory_relative,
            "algorithm": "sha256",
            "fileCount": inventory["fileCount"],
            "totalBytes": inventory["totalBytes"],
            "digest": inventory["digest"],
        }

        if args.check:
            if record.get("version") != {
                "type": "content-snapshot",
                "value": inventory["digest"],
            }:
                raise ValueError(f"{source_id}: manifest version digest mismatch")
            if record.get("snapshot") != snapshot:
                raise ValueError(f"{source_id}: manifest snapshot metadata mismatch")
            with inventory_path.open("r", encoding="utf-8") as handle:
                existing_inventory = json.load(handle)
            stable_fields = {
                "schemaVersion",
                "sourceId",
                "root",
                "algorithm",
                "digestSpecification",
                "fileCount",
                "totalBytes",
                "digest",
                "files",
            }
            if any(
                existing_inventory.get(field) != inventory.get(field)
                for field in stable_fields
            ):
                raise ValueError(f"{source_id}: file inventory mismatch")
        else:
            write_json_atomic(inventory_path, inventory)
            record["version"] = {
                "type": "content-snapshot",
                "value": inventory["digest"],
            }
            record["snapshot"] = snapshot
            changed = True
            print(
                f"{source_id}: {inventory['fileCount']} files, "
                f"{inventory['totalBytes']} bytes, {inventory['digest']}"
            )

    missing_ids = selected_ids - found_ids
    if missing_ids:
        raise ValueError(
            f"not local directory sources: {', '.join(sorted(missing_ids))}"
        )

    if not args.check and changed:
        manifest["schemaVersion"] = "3.1.0"
        manifest["policyVersion"] = "3.0.0"
        manifest["characterPolicy"] = {
            "canonicalScript": "Simplified Chinese",
            "encoding": "UTF-8",
            "converter": "OpenCC 1.4.1",
            "configuration": "t2s.json",
            "stability": "repeat-until-stable",
        }
        manifest["generatedAt"] = date.today().isoformat()
        write_json_atomic(manifest_path, manifest)
    if args.check:
        print(f"snapshot check passed: {len(found_ids)} sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
