#!/usr/bin/env python3
"""Validate CBDB, chinese-poetry and source-materials as one raw layer."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:
    from .build_source_snapshots import build_inventory
    from .validate_source_materials import Validation
except ImportError:
    from build_source_snapshots import build_inventory
    from validate_source_materials import Validation


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = PROJECT_ROOT / "data" / "raw-layer-manifest.json"
IGNORED_SEARCH_PARTS = {
    ".pnpm-store",
    ".site-artifacts",
    ".wrangler",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    dataset: str | None = None


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验项目完整原始数据层。")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--require-simplified",
        action="store_true",
        help="逐个检查三套正式数据中的中文是否已稳定为简体。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    issues: list[Issue] = []
    manifest = load_json(args.manifest.resolve())
    expected_character_policy = {
        "canonicalScript": "Simplified Chinese",
        "encoding": "UTF-8",
        "converter": "OpenCC 1.4.1",
        "configuration": "t2s.json",
        "stability": "repeat-until-stable",
    }
    if manifest.get("characterPolicy") != expected_character_policy:
        issues.append(
            Issue("character-policy", "原始层清单未声明统一的稳定简体规范。")
        )
    records = {record["id"]: record for record in manifest.get("datasets", [])}

    cbdb = records.get("cbdb-20260718", {})
    cbdb_path = PROJECT_ROOT / cbdb.get("path", "")
    if not cbdb_path.is_file():
        issues.append(Issue("cbdb-missing", "CBDB 文件不存在", "cbdb-20260718"))
    else:
        actual_size = cbdb_path.stat().st_size
        actual_hash = hash_file(cbdb_path)
        if actual_size != cbdb.get("sizeBytes"):
            issues.append(Issue("cbdb-size", "CBDB 字节数不符", "cbdb-20260718"))
        if actual_hash != cbdb.get("sha256"):
            issues.append(Issue("cbdb-hash", "CBDB SHA-256 不符", "cbdb-20260718"))
        try:
            connection = sqlite3.connect(
                f"file:{cbdb_path.as_posix()}?mode=ro", uri=True
            )
            quick_check = connection.execute("PRAGMA quick_check").fetchone()[0]
            connection.close()
            if quick_check != "ok":
                issues.append(
                    Issue(
                        "cbdb-quick-check",
                        f"SQLite quick_check: {quick_check}",
                        "cbdb-20260718",
                    )
                )
        except sqlite3.Error as exc:
            issues.append(
                Issue("cbdb-open", f"无法只读打开 CBDB：{exc}", "cbdb-20260718")
            )

    poetry = records.get("chinese-poetry", {})
    poetry_root = PROJECT_ROOT / poetry.get("path", "")
    poetry_inventory_path = PROJECT_ROOT / poetry.get("inventoryPath", "")
    if not poetry_root.is_dir() or not poetry_inventory_path.is_file():
        issues.append(
            Issue(
                "poetry-missing",
                "chinese-poetry 目录或快照清单不存在",
                "chinese-poetry",
            )
        )
    else:
        expected_inventory = load_json(poetry_inventory_path)
        actual_inventory = build_inventory(
            "chinese-poetry", poetry_root, "chinese-poetry"
        )
        for field in ("fileCount", "totalBytes", "digest", "files"):
            if actual_inventory.get(field) != expected_inventory.get(field):
                issues.append(
                    Issue(
                        f"poetry-{field}",
                        f"chinese-poetry {field} 与快照不符",
                        "chinese-poetry",
                    )
                )
            if field != "files" and actual_inventory.get(field) != poetry.get(field):
                issues.append(
                    Issue(
                        f"poetry-manifest-{field}",
                        f"raw-layer manifest 中的 {field} 不符",
                        "chinese-poetry",
                    )
                )

    source_catalog = records.get("source-materials", {})
    source_manifest_path = PROJECT_ROOT / source_catalog.get("path", "")
    if not source_manifest_path.is_file():
        issues.append(
            Issue(
                "source-manifest-missing",
                "source-materials 清单不存在",
                "source-materials",
            )
        )
    else:
        if hash_file(source_manifest_path) != source_catalog.get("sha256"):
            issues.append(
                Issue(
                    "source-manifest-hash",
                    "source-materials 清单 SHA-256 不符",
                    "source-materials",
                )
            )
        validation = Validation(require_materialized_approved=True)
        source_manifest = validation.validate(source_manifest_path)
        for issue in validation.issues:
            if issue.severity == "error":
                issues.append(
                    Issue(
                        f"source-{issue.code}",
                        issue.message,
                        issue.source_id or "source-materials",
                    )
                )
        if isinstance(source_manifest, dict):
            approved_count = sum(
                record.get("ingestionStatus") == "approved"
                for record in source_manifest.get("sources", [])
            )
            if approved_count != source_catalog.get("approvedCount"):
                issues.append(
                    Issue(
                        "source-approved-count",
                        "approved 来源数量与原始层清单不符",
                        "source-materials",
                    )
                )
            if approved_count < 1:
                issues.append(
                    Issue(
                        "source-none-approved",
                        "没有可供下游使用的 approved 来源",
                        "source-materials",
                    )
                )

    forbidden: list[str] = []
    for path in PROJECT_ROOT.rglob("*"):
        try:
            relative = path.relative_to(PROJECT_ROOT)
        except ValueError:
            continue
        if any(part in IGNORED_SEARCH_PARTS for part in relative.parts):
            continue
        if path.name in {".git", ".gitignore", ".github"}:
            forbidden.append(relative.as_posix())
    if forbidden:
        issues.append(
            Issue(
                "vcs-metadata-present",
                "发现已禁用的版本控制元数据或自动化目录："
                + "; ".join(forbidden[:10]),
            )
        )

    if args.require_simplified:
        local_dependencies = PROJECT_ROOT / ".runtime-deps"
        if local_dependencies.is_dir():
            sys.path.insert(0, str(local_dependencies))
        try:
            import opencc
            from audit_simplified_chinese import (
                EPUB_TEXT_EXTENSIONS,
                SQLITE_EXTENSIONS,
                TEXT_EXTENSIONS,
                audit_epub,
                audit_sqlite,
                audit_text,
                iter_files,
            )
        except ImportError as exc:
            issues.append(
                Issue(
                    "simplified-audit-dependency",
                    f"无法加载简体审核依赖：{exc}",
                )
            )
        else:
            converter = opencc.OpenCC("t2s.json")
            roots = [
                PROJECT_ROOT / "cbdb",
                PROJECT_ROOT / "chinese-poetry",
                PROJECT_ROOT / "source-materials",
            ]
            for path in iter_files(roots):
                relative = path.relative_to(PROJECT_ROOT)
                for part in relative.parts:
                    if converter.convert(part) != part:
                        issues.append(
                            Issue(
                                "traditional-path",
                                f"路径仍可转换为简体：{relative.as_posix()}",
                            )
                        )
                        break
                suffix = path.suffix.lower()
                if suffix in SQLITE_EXTENSIONS:
                    result = audit_sqlite(path, converter, 1)
                elif suffix == ".epub":
                    result = audit_epub(path, converter, 1)
                elif suffix in TEXT_EXTENSIONS:
                    result = audit_text(path, converter, 1)
                else:
                    continue
                if int(result.get("residualValues", 0)):
                    issues.append(
                        Issue(
                            "traditional-content",
                            f"文件仍有可转换文本：{relative.as_posix()}",
                        )
                    )

    payload = {
        "valid": not issues,
        "datasetCount": len(records),
        "errorCount": len(issues),
        "issues": [asdict(issue) for issue in issues],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in issues:
            dataset = f" [{issue.dataset}]" if issue.dataset else ""
            print(f"ERROR {issue.code}{dataset}: {issue.message}")
        print(
            f"原始层校验完成：{len(records)} 个数据集，{len(issues)} 个错误。"
        )
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
