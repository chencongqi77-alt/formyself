#!/usr/bin/env python3
"""The only supported programmatic entry point for raw source ingestion."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

try:
    from .validate_source_materials import DEFAULT_MANIFEST, SOURCE_ROOT, Validation
except ImportError:  # Direct execution: python scripts/source_catalog.py
    from validate_source_materials import DEFAULT_MANIFEST, SOURCE_ROOT, Validation


class SourceCatalogError(RuntimeError):
    """Raised when the catalog is invalid or an approved source is unavailable."""


@dataclass(frozen=True)
class ApprovedSource:
    id: str
    title: str
    path: Path
    format: str
    target_people: tuple[str, ...]
    key_locators: tuple[str, ...]
    record: dict[str, Any]


def load_approved_sources(
    manifest_path: Path = DEFAULT_MANIFEST,
) -> tuple[ApprovedSource, ...]:
    """Return only sources that pass every governance and local integrity check."""
    manifest_path = manifest_path.resolve()
    validation = Validation(require_materialized_approved=True)
    manifest = validation.validate(manifest_path)
    errors = [issue for issue in validation.issues if issue.severity == "error"]
    if errors:
        details = "\n".join(
            f"- {issue.code}"
            f"{f' [{issue.source_id}]' if issue.source_id else ''}: {issue.message}"
            for issue in errors
        )
        raise SourceCatalogError(f"source-materials 治理校验未通过：\n{details}")
    if not isinstance(manifest, dict):
        raise SourceCatalogError("source-materials 清单不可用")

    approved: list[ApprovedSource] = []
    for record in manifest.get("sources", []):
        if record.get("ingestionStatus") != "approved":
            continue
        pure_path = PurePosixPath(record["localPath"])
        resolved_path = SOURCE_ROOT.joinpath(*pure_path.parts).resolve()
        if not resolved_path.exists():
            raise SourceCatalogError(
                f"approved 来源缺少本地实物：{record['id']} -> {record['localPath']}"
            )
        approved.append(
            ApprovedSource(
                id=record["id"],
                title=record["title"],
                path=resolved_path,
                format=record["format"],
                target_people=tuple(record["targetPeople"]),
                key_locators=tuple(record["keyLocators"]),
                record=record,
            )
        )
    return tuple(approved)


def iter_approved_paths(
    manifest_path: Path = DEFAULT_MANIFEST,
) -> Iterator[Path]:
    """Yield validated paths; kept small for use by future extraction scripts."""
    for source in load_approved_sources(manifest_path):
        yield source.path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="列出通过治理闸门的原始资料。")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        sources = load_approved_sources(args.manifest)
    except SourceCatalogError as exc:
        print(str(exc))
        return 1

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "id": source.id,
                        "title": source.title,
                        "path": str(source.path),
                        "format": source.format,
                        "targetPeople": list(source.target_people),
                        "keyLocators": list(source.key_locators),
                    }
                    for source in sources
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        if not sources:
            print("当前没有通过治理闸门的 approved 来源。")
        for source in sources:
            print(f"{source.id}\t{source.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
