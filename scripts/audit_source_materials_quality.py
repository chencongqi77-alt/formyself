#!/usr/bin/env python3
"""Produce reproducible technical and target-coverage evidence for raw sources.

This audit does not decide historical truth.  It verifies that a source is
technically readable, structurally navigable, free of obvious decoding damage,
and contains the target material claimed by the catalog.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "source-materials"
DEFAULT_MANIFEST = SOURCE_ROOT / "source-manifest.json"
DEFAULT_REPORT = (
    PROJECT_ROOT
    / "data"
    / "quality-reports"
    / "source-materials-quality-review-2026-07-27.json"
)
TEXT_SUFFIXES = {
    ".csv",
    ".html",
    ".json",
    ".md",
    ".org",
    ".rst",
    ".tsv",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}
README_LINK_RE = re.compile(r"\[\[file:([^]:\]]+)")


TARGET_CHECKS: dict[str, list[dict[str, Any]]] = {
    "kanripo-kr2a0012": [
        {
            "path": "KR2a0012_001.txt",
            "allTerms": ["武帝(操)", "太祖武皇帝", "姓曹讳操字孟德"],
            "purpose": "曹操本传起始定位",
        }
    ],
    "kanripo-kr2a0032": [
        {
            "path": "KR2a0032_338.txt",
            "allTerms": ["苏轼", "苏轼字子瞻眉州眉山人"],
            "purpose": "苏轼本传",
        },
        {
            "path": "KR2a0032_401.txt",
            "allTerms": ["辛弃疾", "辛弃疾字幼安"],
            "purpose": "辛弃疾本传",
        },
    ],
    "kanripo-kr4d0076": [
        {
            "path": "KR4d0076_000.txt",
            "allTerms": ["东坡全集本传", "东坡先生墓志铭", "东坡先生年谱"],
            "purpose": "苏轼本传、墓志和年谱",
        }
    ],
    "kanripo-kr4c0012": [
        {
            "path": "KR4c0012_000.txt",
            "allTerms": ["李太白文集", "三十巻", "唐李白撰"],
            "purpose": "李白文集题名、卷数和作者",
        }
    ],
    "kanripo-kr4c0013": [
        {
            "path": "KR4c0013_000.txt",
            "allTerms": ["李太白集分类补注", "故翰林学士李公墓志", "李白字太白"],
            "purpose": "李白文集与传记旁证",
        }
    ],
    "kanripo-kr4c0018": [
        {
            "path": "KR4c0018_000.txt",
            "allTerms": ["分门集注杜工部诗", "杜甫字子美"],
            "purpose": "杜甫诗集与序传",
        }
    ],
    "kanripo-kr2g0007": [
        {
            "path": "KR2g0007_001.txt",
            "allTerms": ["杜工部年谱", "次第其出处"],
            "purpose": "杜甫年谱正文",
        }
    ],
    "kanripo-kr4j0040": [
        {
            "path": "KR4j0040_000.txt",
            "allTerms": ["稼轩词", "四巻", "宋辛弃疾撰"],
            "purpose": "辛弃疾词集题名、卷数和作者",
        }
    ],
    "kanripo-kr4j0027": [
        {
            "path": "KR4j0027_000.txt",
            "allTerms": ["潄玉词", "宋　李清照　撰"],
            "purpose": "李清照词集正文",
        }
    ],
    "wikisource-wenzhang-biantihuixuan-juan559-rev675251": [
        {
            "jsonRevision": 675251,
            "jsonSha1": "e7d6c1b9b3ee791877a407687ea0634b66d5ab6a",
            "allTerms": ["东坡先生年谱", "{{SK anchor|本传}}", "苏轼"],
            "purpose": "固定修订中的苏轼年谱与本传",
        }
    ],
}


def read_utf8(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="strict")


def audit_text_files(root: Path) -> dict[str, Any]:
    paths = sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES
        ),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    total_characters = 0
    empty_files: list[str] = []
    decoding_errors: list[str] = []
    replacement_character_files: list[str] = []
    nul_character_files: list[str] = []
    for path in paths:
        relative_path = path.relative_to(root).as_posix()
        try:
            content = read_utf8(path)
        except UnicodeDecodeError:
            decoding_errors.append(relative_path)
            continue
        total_characters += len(content)
        if not content.strip():
            empty_files.append(relative_path)
        if "\ufffd" in content:
            replacement_character_files.append(relative_path)
        if "\x00" in content:
            nul_character_files.append(relative_path)
    return {
        "textFileCount": len(paths),
        "totalCharacters": total_characters,
        "utf8DecodingErrors": decoding_errors,
        "emptyTextFiles": empty_files,
        "replacementCharacterFiles": replacement_character_files,
        "nulCharacterFiles": nul_character_files,
        "passed": not any(
            (
                decoding_errors,
                empty_files,
                replacement_character_files,
                nul_character_files,
            )
        ),
    }


def audit_readme(root: Path) -> dict[str, Any]:
    readme = root / "Readme.org"
    if not readme.is_file():
        return {
            "required": True,
            "present": False,
            "referenceCount": 0,
            "missingTargets": ["Readme.org"],
            "passed": False,
        }
    content = read_utf8(readme)
    targets = README_LINK_RE.findall(content)
    missing_targets = sorted(
        {target for target in targets if not (root / target).is_file()}
    )
    return {
        "required": True,
        "present": True,
        "referenceCount": len(targets),
        "missingTargets": missing_targets,
        "passed": bool(targets) and not missing_targets,
    }


def audit_target_checks(
    source_id: str, root: Path, source_is_file: bool
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for check in TARGET_CHECKS.get(source_id, []):
        if "jsonRevision" in check:
            with root.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            revision = payload["query"]["pages"][0]["revisions"][0]
            content = revision["slots"]["main"]["content"]
            missing_terms = [
                term for term in check["allTerms"] if term not in content
            ]
            passed = (
                revision.get("revid") == check["jsonRevision"]
                and revision.get("sha1") == check["jsonSha1"]
                and not missing_terms
            )
            results.append(
                {
                    "purpose": check["purpose"],
                    "path": root.name,
                    "expectedRevision": check["jsonRevision"],
                    "actualRevision": revision.get("revid"),
                    "expectedSha1": check["jsonSha1"],
                    "actualSha1": revision.get("sha1"),
                    "missingTerms": missing_terms,
                    "passed": passed,
                }
            )
            continue

        target_path = root / check["path"]
        content = read_utf8(target_path) if target_path.is_file() else ""
        missing_terms = [term for term in check["allTerms"] if term not in content]
        results.append(
            {
                "purpose": check["purpose"],
                "path": check["path"],
                "missingTerms": missing_terms,
                "passed": target_path.is_file() and not missing_terms,
            }
        )
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="审核待质量复核来源的编码、结构和目标内容覆盖。"
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with args.manifest.resolve().open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    results: list[dict[str, Any]] = []
    for record in manifest["sources"]:
        if (
            record.get("id") not in TARGET_CHECKS
            or record.get("ingestionStatus")
            not in {"pending-quality-review", "approved"}
        ):
            continue
        source_id = record["id"]
        pure_path = PurePosixPath(record["localPath"])
        source_path = SOURCE_ROOT.joinpath(*pure_path.parts).resolve()
        source_is_file = source_path.is_file()
        text_root = source_path.parent if source_is_file else source_path
        text_audit = audit_text_files(text_root)
        readme_audit = (
            {"required": False, "passed": True}
            if source_is_file
            else audit_readme(source_path)
        )
        target_checks = audit_target_checks(
            source_id, source_path, source_is_file
        )
        passed = (
            source_path.exists()
            and text_audit["passed"]
            and readme_audit["passed"]
            and bool(target_checks)
            and all(check["passed"] for check in target_checks)
        )
        results.append(
            {
                "sourceId": source_id,
                "localPath": record["localPath"],
                "materialized": source_path.exists(),
                "textAudit": text_audit,
                "readmeAudit": readme_audit,
                "targetChecks": target_checks,
                "rightsBasis": {
                    "reviewStatus": record["rights"]["reviewStatus"],
                    "license": record["rights"]["license"],
                    "licenseUrl": record["rights"]["licenseUrl"],
                    "attribution": record["rights"]["attribution"],
                },
                "passed": passed,
            }
        )

    payload = {
        "schemaVersion": "1.0.0",
        "generatedAt": date.today().isoformat(),
        "scope": "Technical readability, structural navigation, and claimed target coverage; not independent verification of historical truth.",
        "sourceCount": len(results),
        "passedCount": sum(result["passed"] for result in results),
        "failedCount": sum(not result["passed"] for result in results),
        "results": results,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["failedCount"] == 0 and payload["sourceCount"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
