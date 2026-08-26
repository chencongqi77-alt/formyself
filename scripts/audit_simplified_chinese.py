#!/usr/bin/env python3
"""Audit text-bearing files for content still changed by OpenCC t2s."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DEPENDENCIES = PROJECT_ROOT / ".runtime-deps"
if LOCAL_DEPENDENCIES.is_dir():
    sys.path.insert(0, str(LOCAL_DEPENDENCIES))

import opencc  # type: ignore[import-not-found]  # noqa: E402


TEXT_EXTENSIONS = {
    ".cjs", ".conf", ".css", ".csv", ".html", ".htm", ".ini", ".js",
    ".json", ".jsonl", ".jsx", ".markdown", ".md", ".mjs", ".ndjson",
    ".org", ".py", ".rdf", ".rst", ".scss", ".sql", ".svg", ".tei",
    ".toml", ".ts", ".tsx", ".tsv", ".txt", ".xml", ".xhtml", ".yaml",
    ".yml",
}
EPUB_TEXT_EXTENSIONS = TEXT_EXTENSIONS | {".ncx", ".opf"}
SQLITE_EXTENSIONS = {".db", ".sqlite", ".sqlite3"}
TEXT_TYPE_MARKERS = ("CHAR", "CLOB", "JSON", "NCHAR", "TEXT", "VARCHAR")
IGNORED_DIRECTORIES = {
    ".git", ".hg", ".svn", ".runtime-deps", ".venv", "__pycache__",
    "node_modules", ".pnpm-store", "build", "dist", "venv",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="检查文件中仍会被 OpenCC t2s 转换的文本。"
    )
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--samples-per-location", type=int, default=3)
    return parser.parse_args()


def declared_as_text(declared_type: str | None) -> bool:
    upper = (declared_type or "").upper()
    return any(marker in upper for marker in TEXT_TYPE_MARKERS)


def iter_files(paths: Iterable[Path]) -> Iterable[Path]:
    seen: set[Path] = set()
    for supplied in paths:
        path = supplied.resolve()
        candidates = [path] if path.is_file() else path.rglob("*")
        for candidate in candidates:
            if not candidate.is_file():
                continue
            if any(part in IGNORED_DIRECTORIES for part in candidate.parts):
                continue
            if candidate in seen:
                continue
            seen.add(candidate)
            yield candidate


def difference_count(original: str, converted: str) -> int:
    return sum(left != right for left, right in zip(original, converted)) + abs(
        len(original) - len(converted)
    )


def audit_text(path: Path, converter: Any, sample_limit: int) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return {"kind": "text", "skipped": "not-utf8"}
    converted = converter.convert(text)
    if converted == text:
        return {"kind": "text", "residualValues": 0, "residualCharacters": 0}
    samples: list[dict[str, str]] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        converted_line = converter.convert(line)
        if converted_line != line:
            samples.append(
                {
                    "location": f"line:{line_number}",
                    "original": line[:240],
                    "simplified": converted_line[:240],
                }
            )
            if len(samples) >= sample_limit:
                break
    return {
        "kind": "text",
        "residualValues": 1,
        "residualCharacters": difference_count(text, converted),
        "samples": samples,
    }


def audit_epub(path: Path, converter: Any, sample_limit: int) -> dict[str, Any]:
    residual_values = 0
    residual_characters = 0
    samples: list[dict[str, str]] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if PurePath(info.filename).suffix.lower() not in EPUB_TEXT_EXTENSIONS:
                continue
            raw = archive.read(info)
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                continue
            converted = converter.convert(text)
            if converted == text:
                continue
            residual_values += 1
            residual_characters += difference_count(text, converted)
            if len(samples) < sample_limit:
                samples.append(
                    {
                        "location": info.filename,
                        "original": text[:240],
                        "simplified": converted[:240],
                    }
                )
    return {
        "kind": "epub",
        "residualValues": residual_values,
        "residualCharacters": residual_characters,
        "samples": samples,
    }


def audit_sqlite(path: Path, converter: Any, sample_limit: int) -> dict[str, Any]:
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    locations: list[dict[str, Any]] = []
    total_scanned = 0
    total_residual = 0
    try:
        tables = connection.execute(
            "SELECT name, sql FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for table_name, definition in tables:
            if not definition or definition.lstrip().upper().startswith(
                "CREATE VIRTUAL TABLE"
            ):
                continue
            quoted_table = '"' + str(table_name).replace('"', '""') + '"'
            columns = connection.execute(
                f"PRAGMA table_xinfo({quoted_table})"
            ).fetchall()
            for column in columns:
                if int(column[6] or 0) != 0 or not declared_as_text(column[2]):
                    continue
                column_name = str(column[1])
                quoted_column = '"' + column_name.replace('"', '""') + '"'
                cursor = connection.execute(
                    f"SELECT {quoted_column} FROM {quoted_table} "
                    f"WHERE typeof({quoted_column})='text'"
                )
                count = 0
                samples: list[dict[str, str]] = []
                for (value,) in cursor:
                    total_scanned += 1
                    simplified = converter.convert(value)
                    if simplified == value:
                        continue
                    count += 1
                    total_residual += 1
                    if len(samples) < sample_limit:
                        samples.append(
                            {
                                "original": value[:240],
                                "simplified": simplified[:240],
                            }
                        )
                if count:
                    locations.append(
                        {
                            "table": table_name,
                            "column": column_name,
                            "residualValues": count,
                            "samples": samples,
                        }
                    )
    finally:
        connection.close()
    return {
        "kind": "sqlite",
        "textValuesScanned": total_scanned,
        "residualValues": total_residual,
        "residualLocations": locations,
    }


class PurePath:
    """Small suffix helper that accepts archive member paths on every OS."""

    def __init__(self, value: str) -> None:
        self.suffix = Path(value.replace("\\", "/")).suffix


def main() -> int:
    args = parse_args()
    converter = opencc.OpenCC("t2s.json")
    files: list[dict[str, Any]] = []
    totals: Counter[str] = Counter()
    for path in iter_files(args.paths):
        residual_path_parts = [
            {
                "original": part,
                "simplified": converter.convert(part),
            }
            for part in path.parts
            if converter.convert(part) != part
        ]
        if residual_path_parts:
            totals["residualPaths"] += 1
            files.append(
                {
                    "path": str(path),
                    "kind": "path",
                    "residualValues": 0,
                    "samples": residual_path_parts[: args.samples_per_location],
                }
            )
            print(f"{path}: 路径仍可转换为简体", flush=True)
        suffix = path.suffix.lower()
        try:
            if suffix in SQLITE_EXTENSIONS:
                result = audit_sqlite(path, converter, args.samples_per_location)
            elif suffix == ".epub":
                result = audit_epub(path, converter, args.samples_per_location)
            elif suffix in TEXT_EXTENSIONS:
                result = audit_text(path, converter, args.samples_per_location)
            else:
                continue
        except (OSError, sqlite3.Error, zipfile.BadZipFile) as error:
            result = {"kind": "error", "error": str(error)}
            totals["errors"] += 1
        residual = int(result.get("residualValues", 0))
        totals["filesScanned"] += 1
        totals["residualValues"] += residual
        if residual or result.get("error"):
            files.append({"path": str(path), **result})
            print(f"{path}: {residual} 个可转换文本值", flush=True)

    report = {
        "policy": "OpenCC t2s.json",
        "summary": dict(totals),
        "files": files,
    }
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(output, encoding="utf-8")
    else:
        print(output)
    return 1 if (
        totals["residualValues"]
        or totals["residualPaths"]
        or totals["errors"]
    ) else 0


if __name__ == "__main__":
    raise SystemExit(main())
