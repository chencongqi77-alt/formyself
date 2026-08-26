#!/usr/bin/env python3
"""Validate the governed raw-source catalog and local artifacts.

The validator intentionally uses only Python's standard library so it can run
before project dependencies are installed.  The JSON Schema remains the
portable contract; this script adds filesystem, checksum, and cross-record
checks that JSON Schema cannot express.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "source-materials"
DEFAULT_MANIFEST = SOURCE_ROOT / "source-manifest.json"
MANAGED_ZONES = {"open", "private", "quarantine"}
CONTROL_FILES = {
    "GOVERNANCE.md",
    "SOURCES.md",
    "source-manifest.json",
    "source-manifest.schema.json",
}

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

SOURCE_TYPES = {
    "primary-text",
    "anthology",
    "chronology",
    "biography",
    "scholarly-work",
    "reference-data",
    "other",
}
INGESTION_STATUSES = {
    "approved",
    "pending-materialization",
    "pending-rights-review",
    "pending-quality-review",
    "blocked",
    "deprecated",
}
ALLOWED_USES = {
    "source-review",
    "data-extraction",
    "short-quotation",
    "public-redistribution",
    "private-research",
}
BLOCK_REASONS = {
    "incomplete",
    "rights-unverified",
    "missing-target-coverage",
    "source-unavailable",
    "corrupt-artifact",
    "superseded",
    "other",
}
SOURCE_REQUIRED_KEYS = {
    "id",
    "title",
    "sourceType",
    "provider",
    "sourceUrl",
    "version",
    "localPath",
    "materializationStatus",
    "accessLevel",
    "format",
    "rights",
    "coverage",
    "quality",
    "ingestionStatus",
    "allowedUses",
    "blockReasons",
    "targetPeople",
    "keyLocators",
    "review",
}
SOURCE_OPTIONAL_KEYS = {"artifact", "snapshot", "supersededBy"}


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    source_id: str | None = None


class Validation:
    def __init__(self, require_materialized_approved: bool) -> None:
        self.require_materialized_approved = require_materialized_approved
        self.issues: list[Issue] = []
        self.registered_paths: list[tuple[Path, bool, str]] = []

    def error(self, code: str, message: str, source_id: str | None = None) -> None:
        self.issues.append(Issue("error", code, message, source_id))

    def warning(
        self, code: str, message: str, source_id: str | None = None
    ) -> None:
        self.issues.append(Issue("warning", code, message, source_id))

    def validate(self, manifest_path: Path) -> dict[str, Any] | None:
        try:
            with manifest_path.open("r", encoding="utf-8") as handle:
                manifest = json.load(handle)
        except FileNotFoundError:
            self.error("manifest-missing", f"清单不存在：{manifest_path}")
            return None
        except UnicodeDecodeError:
            self.error("manifest-encoding", "清单必须使用 UTF-8 编码")
            return None
        except json.JSONDecodeError as exc:
            self.error(
                "manifest-json",
                f"JSON 解析失败：第 {exc.lineno} 行第 {exc.colno} 列，{exc.msg}",
            )
            return None

        if not isinstance(manifest, dict):
            self.error("manifest-type", "清单顶层必须是 JSON object")
            return None

        expected_top = {
            "schemaVersion",
            "policyVersion",
            "characterPolicy",
            "generatedAt",
            "sources",
        }
        missing_top = expected_top - manifest.keys()
        extra_top = manifest.keys() - expected_top
        if missing_top:
            self.error("manifest-required", f"清单缺少字段：{sorted(missing_top)}")
        if extra_top:
            self.error("manifest-extra", f"清单含未定义字段：{sorted(extra_top)}")
        if manifest.get("schemaVersion") != "3.1.0":
            self.error("schema-version", "schemaVersion 必须为 3.1.0")
        if manifest.get("policyVersion") != "3.0.0":
            self.error("policy-version", "policyVersion 必须为 3.0.0")
        expected_character_policy = {
            "canonicalScript": "Simplified Chinese",
            "encoding": "UTF-8",
            "converter": "OpenCC 1.4.1",
            "configuration": "t2s.json",
            "stability": "repeat-until-stable",
        }
        if manifest.get("characterPolicy") != expected_character_policy:
            self.error(
                "character-policy",
                "characterPolicy 必须声明项目统一的稳定简体规范。",
            )
        self._validate_date(manifest.get("generatedAt"), "generatedAt")

        sources = manifest.get("sources")
        if not isinstance(sources, list):
            self.error("sources-type", "sources 必须是数组")
            return manifest

        seen_ids: set[str] = set()
        seen_paths: set[str] = set()
        records_by_id: dict[str, dict[str, Any]] = {}
        for index, source in enumerate(sources):
            if not isinstance(source, dict):
                self.error("source-type", f"sources[{index}] 必须是 object")
                continue
            source_id = source.get("id")
            display_id = source_id if isinstance(source_id, str) else f"index:{index}"
            self._validate_source(source, display_id)

            if isinstance(source_id, str):
                if source_id in seen_ids:
                    self.error("duplicate-id", f"重复 id：{source_id}", source_id)
                seen_ids.add(source_id)
                records_by_id[source_id] = source

            local_path = source.get("localPath")
            if isinstance(local_path, str):
                normalized = local_path.casefold()
                if normalized in seen_paths:
                    self.error(
                        "duplicate-path", f"重复 localPath：{local_path}", display_id
                    )
                seen_paths.add(normalized)

        for source_id, source in records_by_id.items():
            replacement = source.get("supersededBy")
            if replacement is not None and replacement not in records_by_id:
                self.error(
                    "missing-successor",
                    f"supersededBy 指向不存在的 id：{replacement}",
                    source_id,
                )
            if replacement == source_id:
                self.error("self-successor", "来源不能替代自身", source_id)

        self._validate_unregistered_files()
        return manifest

    def _validate_source(self, source: dict[str, Any], source_id: str) -> None:
        keys = set(source)
        missing = SOURCE_REQUIRED_KEYS - keys
        extra = keys - SOURCE_REQUIRED_KEYS - SOURCE_OPTIONAL_KEYS
        if missing:
            self.error("source-required", f"缺少字段：{sorted(missing)}", source_id)
        if extra:
            self.error("source-extra", f"含未定义字段：{sorted(extra)}", source_id)

        actual_id = source.get("id")
        if not isinstance(actual_id, str) or not ID_RE.fullmatch(actual_id):
            self.error("id-format", "id 必须是小写 ASCII kebab-case", source_id)

        if not self._nonempty_string(source.get("title")):
            self.error("title", "title 必须是非空字符串", source_id)
        if source.get("sourceType") not in SOURCE_TYPES:
            self.error("source-type-value", "sourceType 取值无效", source_id)

        provider = source.get("provider")
        if not isinstance(provider, dict):
            self.error("provider", "provider 必须是 object", source_id)
        else:
            if set(provider) != {"name", "url"}:
                self.error(
                    "provider-fields", "provider 只能包含 name 和 url", source_id
                )
            if not self._nonempty_string(provider.get("name")):
                self.error("provider-name", "provider.name 不能为空", source_id)
            self._validate_https(provider.get("url"), "provider.url", source_id)
        self._validate_https(source.get("sourceUrl"), "sourceUrl", source_id)

        version = source.get("version")
        if not isinstance(version, dict) or set(version) != {"type", "value"}:
            self.error("version", "version 必须且只能包含 type、value", source_id)
        else:
            version_type = version.get("type")
            version_value = version.get("value")
            if version_type not in {
                "content-snapshot",
                "export-timestamp",
                "release-date",
                "edition",
            }:
                self.error("version-type", "version.type 取值无效", source_id)
            if not self._nonempty_string(version_value):
                self.error("version-value", "version.value 不能为空", source_id)
            elif version_type == "content-snapshot" and not SHA256_RE.fullmatch(
                version_value
            ):
                self.error(
                    "content-snapshot",
                    "content-snapshot 必须是 64 位小写 SHA-256",
                    source_id,
                )

        local_path = source.get("localPath")
        local_target: Path | None = None
        path_is_file_record = False
        if not isinstance(local_path, str):
            self.error("local-path", "localPath 必须是字符串", source_id)
        else:
            local_target, path_is_file_record = self._validate_path(
                local_path, source_id
            )

        materialization = source.get("materializationStatus")
        if materialization not in {"local", "remote-only"}:
            self.error(
                "materialization-status", "materializationStatus 取值无效", source_id
            )
        access = source.get("accessLevel")
        if access not in MANAGED_ZONES:
            self.error("access-level", "accessLevel 取值无效", source_id)
        elif isinstance(local_path, str):
            first_part = PurePosixPath(local_path).parts[0] if local_path else ""
            if first_part != access:
                self.error(
                    "access-path-mismatch",
                    f"accessLevel={access} 与路径分区 {first_part!r} 不一致",
                    source_id,
                )

        if not self._nonempty_string(source.get("format")):
            self.error("format", "format 必须是非空字符串", source_id)

        rights = self._validate_rights(source.get("rights"), source_id)
        quality = self._validate_quality(source.get("quality"), source_id)
        self._validate_coverage(source.get("coverage"), source_id)
        self._validate_review(source.get("review"), source_id)

        ingestion = source.get("ingestionStatus")
        if ingestion not in INGESTION_STATUSES:
            self.error("ingestion-status", "ingestionStatus 取值无效", source_id)

        allowed_uses = self._string_set(
            source.get("allowedUses"), ALLOWED_USES, "allowedUses", source_id
        )
        block_reasons = self._string_set(
            source.get("blockReasons"), BLOCK_REASONS, "blockReasons", source_id
        )
        self._slug_list(source.get("targetPeople"), "targetPeople", source_id)
        self._string_list(source.get("keyLocators"), "keyLocators", source_id)

        if ingestion == "approved":
            if materialization != "local":
                self.error(
                    "approved-not-local", "approved 来源必须已在本地落盘", source_id
                )
            if rights.get("reviewStatus") != "verified":
                self.error(
                    "approved-rights", "approved 来源的权利必须 verified", source_id
                )
            if quality.get("reviewStatus") != "reviewed":
                self.error(
                    "approved-quality", "approved 来源的质量必须 reviewed", source_id
                )
            if "data-extraction" not in allowed_uses:
                self.error(
                    "approved-use",
                    "approved 来源必须明确允许 data-extraction",
                    source_id,
                )
            if block_reasons:
                self.error(
                    "approved-blocked", "approved 来源不得保留 blockReasons", source_id
                )
        elif ingestion == "pending-materialization" and materialization != "remote-only":
            self.error(
                "pending-materialization-state",
                "pending-materialization 必须对应 remote-only",
                source_id,
            )
        elif ingestion == "pending-rights-review" and rights.get(
            "reviewStatus"
        ) == "verified":
            self.error(
                "pending-rights-state",
                "权利已 verified 时不应保持 pending-rights-review",
                source_id,
            )
        elif ingestion == "pending-quality-review" and quality.get(
            "reviewStatus"
        ) == "reviewed":
            self.error(
                "pending-quality-state",
                "质量已 reviewed 时不应保持 pending-quality-review",
                source_id,
            )
        elif ingestion == "blocked" and not block_reasons:
            self.error(
                "blocked-without-reason", "blocked 来源必须给出 blockReasons", source_id
            )
        elif ingestion == "deprecated" and not source.get("supersededBy"):
            self.error(
                "deprecated-without-successor",
                "deprecated 来源必须填写 supersededBy",
                source_id,
            )

        if access == "open":
            if rights.get("reviewStatus") != "verified":
                self.error("open-rights", "open 分区的权利必须 verified", source_id)
            if rights.get("redistributionAllowed") is not True:
                self.error(
                    "open-redistribution",
                    "open 分区必须明确允许再分发",
                    source_id,
                )
        elif access in {"private", "quarantine"}:
            if rights.get("redistributionAllowed") is True:
                self.error(
                    "restricted-redistribution",
                    f"{access} 分区不得标记为可公开再分发",
                    source_id,
                )
            if ingestion == "approved" and access == "quarantine":
                self.error(
                    "quarantine-approved", "quarantine 来源不能 approved", source_id
                )

        artifact = source.get("artifact")
        if artifact is not None:
            self._validate_artifact(artifact, source_id)
        snapshot = source.get("snapshot")
        if snapshot is not None:
            self._validate_snapshot(snapshot, source_id)
        if path_is_file_record and artifact is None:
            self.error(
                "file-artifact",
                "单文件来源必须填写 artifact（原文件名、日期、大小、SHA-256）",
                source_id,
            )
        if path_is_file_record and snapshot is not None:
            self.error("file-snapshot", "单文件来源不得填写目录快照", source_id)
        if (
            not path_is_file_record
            and materialization == "local"
            and snapshot is None
        ):
            self.error(
                "directory-snapshot",
                "本地目录型来源必须填写逐文件内容快照",
                source_id,
            )
        if (
            not path_is_file_record
            and isinstance(version, dict)
            and version.get("type") != "content-snapshot"
        ):
            self.error(
                "directory-version",
                "目录型来源的 version.type 必须为 content-snapshot",
                source_id,
            )

        if local_target is not None:
            is_expected_file = path_is_file_record
            self.registered_paths.append((local_target, is_expected_file, source_id))
            exists = local_target.exists()
            if materialization == "local" and not exists:
                message = f"清单标记为 local，但文件不存在：{local_path}"
                if ingestion == "approved" and self.require_materialized_approved:
                    self.error("approved-file-missing", message, source_id)
                else:
                    self.warning("local-file-missing", message, source_id)
            elif materialization == "remote-only" and exists:
                self.warning(
                    "remote-file-present",
                    "路径已经存在，应复核后把 materializationStatus 改为 local",
                    source_id,
                )

            if exists:
                if is_expected_file and not local_target.is_file():
                    self.error(
                        "expected-file", f"预期为文件：{local_path}", source_id
                    )
                elif not is_expected_file and not local_target.is_dir():
                    self.error(
                        "expected-directory", f"预期为目录：{local_path}", source_id
                    )
                elif local_target.is_file() and isinstance(artifact, dict):
                    self._verify_artifact(local_target, artifact, source_id)
                elif local_target.is_dir() and isinstance(snapshot, dict):
                    self._verify_snapshot(
                        local_target,
                        snapshot,
                        version if isinstance(version, dict) else {},
                        local_path if isinstance(local_path, str) else "",
                        source_id,
                    )

    def _validate_path(
        self, local_path: str, source_id: str
    ) -> tuple[Path | None, bool]:
        if "\\" in local_path:
            self.error(
                "path-separator", "localPath 必须使用 /，不能使用反斜杠", source_id
            )
        pure = PurePosixPath(local_path)
        parts = pure.parts
        if pure.is_absolute() or ".." in parts or "." in parts:
            self.error("path-traversal", "localPath 必须是分区内相对路径", source_id)
            return None, bool(pure.suffix)
        if not parts or parts[0] not in MANAGED_ZONES or len(parts) < 2:
            self.error(
                "path-zone",
                "localPath 必须位于 open/、private/ 或 quarantine/ 下",
                source_id,
            )
            return None, bool(pure.suffix)

        for directory in parts[:-1]:
            if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", directory):
                self.error(
                    "directory-name",
                    f"目录名必须是小写 ASCII slug：{directory!r}",
                    source_id,
                )

        target = SOURCE_ROOT.joinpath(*parts).resolve()
        try:
            target.relative_to(SOURCE_ROOT.resolve())
        except ValueError:
            self.error("path-outside-root", "localPath 越出资料区", source_id)
            return None, bool(pure.suffix)

        is_file_record = bool(pure.suffix)
        if is_file_record:
            expected_prefix = f"{source_id}__"
            if not pure.name.startswith(expected_prefix):
                self.error(
                    "filename-convention",
                    f"文件名必须以 {expected_prefix!r} 开头",
                    source_id,
                )
        elif pure.name != source_id:
            self.error(
                "directory-id",
                "目录型来源的末级目录必须与 source id 相同",
                source_id,
            )
        return target, is_file_record

    def _validate_rights(
        self, rights: Any, source_id: str
    ) -> dict[str, Any]:
        required = {
            "reviewStatus",
            "license",
            "licenseUrl",
            "attribution",
            "redistributionAllowed",
        }
        if not isinstance(rights, dict):
            self.error("rights", "rights 必须是 object", source_id)
            return {}
        if set(rights) != required:
            self.error("rights-fields", f"rights 字段必须为 {sorted(required)}", source_id)
        if rights.get("reviewStatus") not in {"verified", "pending", "restricted"}:
            self.error("rights-status", "rights.reviewStatus 取值无效", source_id)
        if not self._nonempty_string(rights.get("license")):
            self.error("license", "rights.license 不能为空", source_id)
        license_url = rights.get("licenseUrl")
        if license_url is not None:
            self._validate_https(license_url, "rights.licenseUrl", source_id)
        attribution = rights.get("attribution")
        if attribution is not None and not isinstance(attribution, str):
            self.error(
                "attribution", "rights.attribution 必须是字符串或 null", source_id
            )
        if not isinstance(rights.get("redistributionAllowed"), bool):
            self.error(
                "redistribution",
                "rights.redistributionAllowed 必须是 boolean",
                source_id,
            )
        if rights.get("reviewStatus") == "verified" and license_url is None:
            self.error(
                "verified-license-url",
                "权利 verified 时必须提供 licenseUrl 或公版依据链接",
                source_id,
            )
        return rights

    def _validate_coverage(self, coverage: Any, source_id: str) -> None:
        if not isinstance(coverage, dict) or set(coverage) != {
            "description",
            "completeness",
        }:
            self.error(
                "coverage",
                "coverage 必须且只能包含 description、completeness",
                source_id,
            )
            return
        if not self._nonempty_string(coverage.get("description")):
            self.error("coverage-description", "coverage.description 不能为空", source_id)
        if coverage.get("completeness") not in {
            "complete",
            "partial",
            "single-volume",
            "unknown",
        }:
            self.error(
                "coverage-completeness", "coverage.completeness 取值无效", source_id
            )

    def _validate_quality(
        self, quality: Any, source_id: str
    ) -> dict[str, Any]:
        if not isinstance(quality, dict) or set(quality) != {
            "reviewStatus",
            "textQuality",
            "notes",
        }:
            self.error(
                "quality",
                "quality 必须且只能包含 reviewStatus、textQuality、notes",
                source_id,
            )
            return {}
        if quality.get("reviewStatus") not in {"pending", "reviewed"}:
            self.error("quality-status", "quality.reviewStatus 取值无效", source_id)
        if quality.get("textQuality") not in {
            "born-digital",
            "curated-transcription",
            "ocr-unreviewed",
            "ocr-reviewed",
            "mixed",
            "unknown",
        }:
            self.error("text-quality", "quality.textQuality 取值无效", source_id)
        if not isinstance(quality.get("notes"), str):
            self.error("quality-notes", "quality.notes 必须是字符串", source_id)
        return quality

    def _validate_artifact(self, artifact: Any, source_id: str) -> None:
        required = {"originalFilename", "retrievedAt", "sizeBytes", "sha256"}
        if not isinstance(artifact, dict):
            self.error("artifact", "artifact 必须是 object", source_id)
            return
        if set(artifact) != required:
            self.error(
                "artifact-fields", f"artifact 字段必须为 {sorted(required)}", source_id
            )
        if not self._nonempty_string(artifact.get("originalFilename")):
            self.error(
                "artifact-filename", "artifact.originalFilename 不能为空", source_id
            )
        self._validate_date(
            artifact.get("retrievedAt"), "artifact.retrievedAt", source_id
        )
        size = artifact.get("sizeBytes")
        if not isinstance(size, int) or isinstance(size, bool) or size < 1:
            self.error("artifact-size", "artifact.sizeBytes 必须是正整数", source_id)
        sha256 = artifact.get("sha256")
        if not isinstance(sha256, str) or not SHA256_RE.fullmatch(sha256):
            self.error(
                "artifact-sha256",
                "artifact.sha256 必须是 64 位小写十六进制",
                source_id,
            )

    def _verify_artifact(
        self, path: Path, artifact: dict[str, Any], source_id: str
    ) -> None:
        expected_size = artifact.get("sizeBytes")
        actual_size = path.stat().st_size
        if isinstance(expected_size, int) and actual_size != expected_size:
            self.error(
                "size-mismatch",
                f"文件大小不符：清单 {expected_size}，实际 {actual_size}",
                source_id,
            )

        expected_hash = artifact.get("sha256")
        if isinstance(expected_hash, str) and SHA256_RE.fullmatch(expected_hash):
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            actual_hash = digest.hexdigest()
            if actual_hash != expected_hash:
                self.error(
                    "sha256-mismatch",
                    f"SHA-256 不符：清单 {expected_hash}，实际 {actual_hash}",
                    source_id,
                )

    def _validate_snapshot(self, snapshot: Any, source_id: str) -> None:
        required = {
            "inventoryPath",
            "algorithm",
            "fileCount",
            "totalBytes",
            "digest",
        }
        if not isinstance(snapshot, dict):
            self.error("snapshot", "snapshot 必须是 object", source_id)
            return
        if set(snapshot) != required:
            self.error(
                "snapshot-fields",
                f"snapshot 字段必须为 {sorted(required)}",
                source_id,
            )
        inventory_path = snapshot.get("inventoryPath")
        if not isinstance(inventory_path, str):
            self.error("snapshot-inventory-path", "inventoryPath 必须是字符串", source_id)
        else:
            pure = PurePosixPath(inventory_path)
            if (
                pure.is_absolute()
                or ".." in pure.parts
                or len(pure.parts) != 2
                or pure.parts[0] != "inventories"
                or pure.name != f"{source_id}.snapshot.json"
            ):
                self.error(
                    "snapshot-inventory-path",
                    "inventoryPath 必须为 inventories/<source-id>.snapshot.json",
                    source_id,
                )
        if snapshot.get("algorithm") != "sha256":
            self.error("snapshot-algorithm", "snapshot.algorithm 必须为 sha256", source_id)
        file_count = snapshot.get("fileCount")
        if (
            not isinstance(file_count, int)
            or isinstance(file_count, bool)
            or file_count < 1
        ):
            self.error("snapshot-file-count", "snapshot.fileCount 必须是正整数", source_id)
        total_bytes = snapshot.get("totalBytes")
        if (
            not isinstance(total_bytes, int)
            or isinstance(total_bytes, bool)
            or total_bytes < 1
        ):
            self.error("snapshot-total-bytes", "snapshot.totalBytes 必须是正整数", source_id)
        digest = snapshot.get("digest")
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            self.error(
                "snapshot-digest",
                "snapshot.digest 必须是 64 位小写 SHA-256",
                source_id,
            )

    def _verify_snapshot(
        self,
        root: Path,
        snapshot: dict[str, Any],
        version: dict[str, Any],
        local_path: str,
        source_id: str,
    ) -> None:
        inventory_relative = snapshot.get("inventoryPath")
        if not isinstance(inventory_relative, str):
            return
        inventory_path = SOURCE_ROOT.joinpath(
            *PurePosixPath(inventory_relative).parts
        ).resolve()
        try:
            inventory_path.relative_to((SOURCE_ROOT / "inventories").resolve())
        except ValueError:
            self.error(
                "snapshot-inventory-outside",
                "快照清单必须位于 source-materials/inventories",
                source_id,
            )
            return
        try:
            with inventory_path.open("r", encoding="utf-8") as handle:
                inventory = json.load(handle)
        except FileNotFoundError:
            self.error(
                "snapshot-inventory-missing",
                f"快照清单不存在：{inventory_relative}",
                source_id,
            )
            return
        except (UnicodeDecodeError, json.JSONDecodeError, OSError) as exc:
            self.error(
                "snapshot-inventory-read",
                f"无法读取快照清单：{exc}",
                source_id,
            )
            return

        expected_top = {
            "schemaVersion",
            "sourceId",
            "generatedAt",
            "root",
            "algorithm",
            "digestSpecification",
            "fileCount",
            "totalBytes",
            "digest",
            "files",
        }
        if not isinstance(inventory, dict) or set(inventory) != expected_top:
            self.error(
                "snapshot-inventory-shape",
                "快照清单顶层字段不符合 1.0.0 规范",
                source_id,
            )
            return
        if inventory.get("schemaVersion") != "1.0.0":
            self.error(
                "snapshot-inventory-version",
                "快照清单 schemaVersion 必须为 1.0.0",
                source_id,
            )
        if inventory.get("sourceId") != source_id:
            self.error("snapshot-source-id", "快照 sourceId 不符", source_id)
        if inventory.get("root") != local_path:
            self.error("snapshot-root", "快照 root 与 localPath 不符", source_id)
        if inventory.get("algorithm") != "sha256":
            self.error("snapshot-algorithm", "快照算法必须为 sha256", source_id)

        files = inventory.get("files")
        if not isinstance(files, list):
            self.error("snapshot-files", "快照 files 必须是数组", source_id)
            return
        expected_files: dict[str, tuple[int, str]] = {}
        ordered_paths: list[str] = []
        for index, entry in enumerate(files):
            if not isinstance(entry, dict) or set(entry) != {
                "path",
                "sizeBytes",
                "sha256",
            }:
                self.error(
                    "snapshot-file-entry",
                    f"快照 files[{index}] 结构无效",
                    source_id,
                )
                continue
            relative_path = entry.get("path")
            size_bytes = entry.get("sizeBytes")
            sha256 = entry.get("sha256")
            if not isinstance(relative_path, str):
                self.error(
                    "snapshot-file-path",
                    f"快照 files[{index}].path 无效",
                    source_id,
                )
                continue
            pure = PurePosixPath(relative_path)
            if pure.is_absolute() or ".." in pure.parts or "." in pure.parts:
                self.error(
                    "snapshot-file-path",
                    f"快照文件路径越界：{relative_path}",
                    source_id,
                )
                continue
            if relative_path in expected_files:
                self.error(
                    "snapshot-file-duplicate",
                    f"快照文件重复：{relative_path}",
                    source_id,
                )
                continue
            if (
                not isinstance(size_bytes, int)
                or isinstance(size_bytes, bool)
                or size_bytes < 0
            ):
                self.error(
                    "snapshot-file-size",
                    f"快照文件大小无效：{relative_path}",
                    source_id,
                )
                continue
            if not isinstance(sha256, str) or not SHA256_RE.fullmatch(sha256):
                self.error(
                    "snapshot-file-hash",
                    f"快照文件 SHA-256 无效：{relative_path}",
                    source_id,
                )
                continue
            ordered_paths.append(relative_path)
            expected_files[relative_path] = (size_bytes, sha256)

        if ordered_paths != sorted(ordered_paths):
            self.error("snapshot-file-order", "快照文件必须按路径排序", source_id)

        actual_paths = sorted(
            (path for path in root.rglob("*") if path.is_file()),
            key=lambda path: path.relative_to(root).as_posix(),
        )
        actual_names = {path.relative_to(root).as_posix() for path in actual_paths}
        expected_names = set(expected_files)
        missing = sorted(expected_names - actual_names)
        extra = sorted(actual_names - expected_names)
        if missing:
            self.error(
                "snapshot-files-missing",
                f"快照登记文件缺失：{'; '.join(missing[:5])}",
                source_id,
            )
        if extra:
            self.error(
                "snapshot-files-extra",
                f"出现未登记文件：{'; '.join(extra[:5])}",
                source_id,
            )

        total_bytes = 0
        digest = hashlib.sha256()
        for path in actual_paths:
            relative_path = path.relative_to(root).as_posix()
            if relative_path not in expected_files:
                continue
            expected_size, expected_hash = expected_files[relative_path]
            actual_size = path.stat().st_size
            file_digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    file_digest.update(chunk)
            actual_hash = file_digest.hexdigest()
            if actual_size != expected_size:
                self.error(
                    "snapshot-size-mismatch",
                    f"{relative_path} 大小不符：清单 {expected_size}，实际 {actual_size}",
                    source_id,
                )
            if actual_hash != expected_hash:
                self.error(
                    "snapshot-hash-mismatch",
                    f"{relative_path} SHA-256 不符",
                    source_id,
                )
            total_bytes += actual_size
            digest.update(relative_path.encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(actual_size).encode("ascii"))
            digest.update(b"\0")
            digest.update(bytes.fromhex(actual_hash))
            digest.update(b"\n")

        actual_digest = digest.hexdigest()
        comparisons = {
            "fileCount": len(actual_paths),
            "totalBytes": total_bytes,
            "digest": actual_digest,
        }
        for field, actual_value in comparisons.items():
            if inventory.get(field) != actual_value:
                self.error(
                    f"snapshot-inventory-{field}",
                    f"快照清单 {field} 不符",
                    source_id,
                )
            if snapshot.get(field) != actual_value:
                self.error(
                    f"snapshot-manifest-{field}",
                    f"来源记录 snapshot.{field} 不符",
                    source_id,
                )
        if version.get("value") != actual_digest:
            self.error(
                "snapshot-version-digest",
                "version.value 与目录快照摘要不符",
                source_id,
            )

    def _validate_review(self, review: Any, source_id: str) -> None:
        required = {"reviewedBy", "reviewedAt", "notes"}
        if not isinstance(review, dict) or set(review) != required:
            self.error(
                "review", "review 必须且只能包含 reviewedBy、reviewedAt、notes", source_id
            )
            return
        reviewed_by = review.get("reviewedBy")
        if reviewed_by is not None and not self._nonempty_string(reviewed_by):
            self.error("reviewed-by", "review.reviewedBy 必须是非空字符串或 null", source_id)
        reviewed_at = review.get("reviewedAt")
        if reviewed_at is not None:
            self._validate_date(reviewed_at, "review.reviewedAt", source_id)
        if not isinstance(review.get("notes"), str):
            self.error("review-notes", "review.notes 必须是字符串", source_id)

    def _validate_unregistered_files(self) -> None:
        for child in SOURCE_ROOT.iterdir():
            if child.is_file() and child.name not in CONTROL_FILES:
                self.error(
                    "root-artifact",
                    f"原始资料不得放在根目录：{child.relative_to(PROJECT_ROOT)}",
                )

        for zone in sorted(MANAGED_ZONES):
            zone_path = SOURCE_ROOT / zone
            if not zone_path.exists():
                continue
            for file_path in zone_path.rglob("*"):
                if not file_path.is_file():
                    continue
                resolved = file_path.resolve()
                covered = False
                for registered, is_file, _source_id in self.registered_paths:
                    if is_file and resolved == registered:
                        covered = True
                        break
                    if not is_file:
                        try:
                            resolved.relative_to(registered)
                            covered = True
                            break
                        except ValueError:
                            pass
                if not covered:
                    self.error(
                        "unregistered-file",
                        f"发现未登记文件：{file_path.relative_to(SOURCE_ROOT).as_posix()}",
                    )

    def _string_set(
        self,
        value: Any,
        allowed: set[str],
        field: str,
        source_id: str,
    ) -> set[str]:
        if not isinstance(value, list):
            self.error(f"{field}-type", f"{field} 必须是数组", source_id)
            return set()
        if any(not isinstance(item, str) for item in value):
            self.error(f"{field}-item", f"{field} 只能包含字符串", source_id)
            return set()
        result = set(value)
        if len(result) != len(value):
            self.error(f"{field}-duplicate", f"{field} 不得重复", source_id)
        invalid = result - allowed
        if invalid:
            self.error(
                f"{field}-value", f"{field} 含无效值：{sorted(invalid)}", source_id
            )
        return result

    def _string_list(self, value: Any, field: str, source_id: str) -> None:
        if not isinstance(value, list):
            self.error(f"{field}-type", f"{field} 必须是数组", source_id)
            return
        if any(not self._nonempty_string(item) for item in value):
            self.error(f"{field}-item", f"{field} 只能包含非空字符串", source_id)
        if len(set(value)) != len(value):
            self.error(f"{field}-duplicate", f"{field} 不得重复", source_id)

    def _slug_list(self, value: Any, field: str, source_id: str) -> None:
        self._string_list(value, field, source_id)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str) and not ID_RE.fullmatch(item):
                    self.error(
                        f"{field}-slug",
                        f"{field} 必须使用小写 ASCII kebab-case：{item!r}",
                        source_id,
                    )

    def _validate_date(
        self, value: Any, field: str, source_id: str | None = None
    ) -> None:
        if not isinstance(value, str):
            self.error("date-type", f"{field} 必须是 YYYY-MM-DD", source_id)
            return
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            self.error("date-format", f"{field} 必须是有效的 YYYY-MM-DD", source_id)
            return
        if parsed.isoformat() != value:
            self.error("date-canonical", f"{field} 必须使用标准 YYYY-MM-DD", source_id)

    def _validate_https(
        self, value: Any, field: str, source_id: str | None = None
    ) -> None:
        if not isinstance(value, str):
            self.error("url-type", f"{field} 必须是 HTTPS URL", source_id)
            return
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            self.error("url-format", f"{field} 必须是 HTTPS URL", source_id)

    @staticmethod
    def _nonempty_string(value: Any) -> bool:
        return isinstance(value, str) and bool(value.strip())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="校验 source-materials 清单、状态、路径和文件摘要。"
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="清单路径（默认：source-materials/source-manifest.json）",
    )
    parser.add_argument(
        "--require-materialized-approved",
        action="store_true",
        help="将 approved 来源的本地实物缺失视为错误，适合抽取前或 CI。",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 输出结果。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    validation = Validation(args.require_materialized_approved)
    manifest = validation.validate(args.manifest.resolve())
    errors = [issue for issue in validation.issues if issue.severity == "error"]
    warnings = [issue for issue in validation.issues if issue.severity == "warning"]

    if args.json:
        payload = {
            "valid": not errors,
            "sourceCount": (
                len(manifest.get("sources", [])) if isinstance(manifest, dict) else 0
            ),
            "errorCount": len(errors),
            "warningCount": len(warnings),
            "issues": [asdict(issue) for issue in validation.issues],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in validation.issues:
            marker = "ERROR" if issue.severity == "error" else "WARN "
            source = f" [{issue.source_id}]" if issue.source_id else ""
            print(f"{marker} {issue.code}{source}: {issue.message}")
        source_count = (
            len(manifest.get("sources", [])) if isinstance(manifest, dict) else 0
        )
        print(
            f"校验完成：{source_count} 个来源，"
            f"{len(errors)} 个错误，{len(warnings)} 个警告。"
        )

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
