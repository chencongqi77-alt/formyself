#!/usr/bin/env python3
"""Build and validate a private, ordered manifest for a directory-based book.

The script deliberately does not ingest a user upload, copy source text, create
a job, or advance an existing job stage.  It only creates a non-overwritable
intake artifact under an already-owned job directory.  The resulting manifest
is the future input to a package-aware extractor; it is not compatible with
the current single-blob biography extractor.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from poet_map_job import file_sha256, utc_now, write_json_atomically


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JOB_ROOT = PROJECT_ROOT / "var" / "jobs"
RECORD_TYPE = "book-package-manifest"
SCHEMA_VERSION = "1.0.0"
OUTPUT_NAME = "book-package-manifest.json"
OUTPUT_STAGE = "00-intake"
BOOK_PACKAGE_INPUT_KIND = "ordered-package-pending"
DIGEST_SPECIFICATION = "book-package-digest-v1: ordinal + NUL + path + NUL + size + NUL + file-sha256-bytes + LF"
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
JOB_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,12}$")
PACKAGE_ID_RE = re.compile(r"^bpm-[a-z0-9]+(?:-[a-z0-9]+){1,12}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
POSIX_PATH_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
EXTENSION_RE = re.compile(r"^\.[A-Za-z0-9]+$")
ORG_TITLE_RE = re.compile(r"^\s*#\+TITLE:\s*(?P<title>.+?)\s*$", re.IGNORECASE)
ORG_JUAN_RE = re.compile(r"^\s*#\+PROPERTY:\s*JUAN\s+(?P<title>.+?)\s*$", re.IGNORECASE)
MARKDOWN_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(?P<title>.+?)\s*#*\s*$")
MAX_SECTION_HINTS_PER_MEMBER = 1000
MAX_SECTION_HINT_LENGTH = 300


class BookPackageError(ValueError):
    """Raised when a book package cannot be safely built or written."""


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    location: str | None = None


@dataclass(frozen=True)
class Validation:
    valid: bool
    errors: tuple[Issue, ...]
    warnings: tuple[Issue, ...]

    def payload(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "errorCount": len(self.errors),
            "warningCount": len(self.warnings),
            "issues": [asdict(issue) for issue in (*self.errors, *self.warnings)],
        }


def _is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _require_id(value: str, label: str) -> str:
    if not ID_RE.fullmatch(value):
        raise BookPackageError(f"{label} must be a lowercase kebab-case identifier: {value!r}")
    return value


def _require_job_id(value: str, label: str = "jobId") -> str:
    if not JOB_ID_RE.fullmatch(value):
        raise BookPackageError(f"{label} must be a lowercase kebab-case job identifier: {value!r}")
    return value


def _require_sha256(value: str, label: str) -> str:
    if not SHA256_RE.fullmatch(value):
        raise BookPackageError(f"{label} must be a 64-character lowercase SHA-256 digest.")
    return value


def _parse_timestamp(value: str, label: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BookPackageError(f"{label} must be an ISO-8601 timestamp: {value!r}") from exc
    if parsed.tzinfo is None:
        raise BookPackageError(f"{label} must include a timezone: {value!r}")
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _path_is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _safe_posix_relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value or not POSIX_PATH_RE.fullmatch(value):
        return False
    candidate = PurePosixPath(value)
    return not candidate.is_absolute() and all(part not in {"", ".", ".."} for part in candidate.parts)


def _normalize_extensions(values: Iterable[str] | None) -> tuple[str, ...]:
    raw_values = tuple(values or (".txt",))
    normalized: list[str] = []
    for raw in raw_values:
        value = raw.strip().lower()
        if not EXTENSION_RE.fullmatch(value):
            raise BookPackageError(f"include extension must look like '.txt': {raw!r}")
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        raise BookPackageError("At least one include extension is required.")
    return tuple(normalized)


def _stable_stat_signature(path: Path) -> tuple[int, int, int]:
    stat = path.stat()
    return (stat.st_size, stat.st_mtime_ns, stat.st_ino)


def _check_member_is_stable(path: Path, before: tuple[int, int, int]) -> None:
    after = _stable_stat_signature(path)
    if after != before:
        raise BookPackageError(f"Source member changed while building the package: {path.name}")


def _explicit_section_hints(path: Path) -> list[dict[str, Any]]:
    """Read only explicit structural labels; non-UTF-8 files simply get no hints."""
    hints: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8", newline=None) as handle:
            for line_number, line in enumerate(handle, start=1):
                match = ORG_TITLE_RE.match(line)
                kind = "title"
                detector = "org-title-v1"
                if match is None:
                    match = ORG_JUAN_RE.match(line)
                    kind = "juan"
                    detector = "kanripo-org-juan-v1"
                if match is None:
                    match = MARKDOWN_HEADING_RE.match(line)
                    kind = "heading"
                    detector = "markdown-heading-v1"
                if match is None:
                    continue
                title = match.group("title").strip().strip("#").strip()
                if not title or len(title) > MAX_SECTION_HINT_LENGTH:
                    continue
                hints.append({"kind": kind, "title": title, "line": line_number, "detector": detector})
                if len(hints) >= MAX_SECTION_HINTS_PER_MEMBER:
                    break
    except UnicodeDecodeError:
        return []
    return hints


def package_sha256(members: Iterable[dict[str, Any]]) -> str:
    """Hash members in order, including their ordinal, rather than hashing JSON text."""
    digest = hashlib.sha256()
    for member in members:
        ordinal = member["ordinal"]
        relative_path = member["relativePath"]
        size = member["sizeBytes"]
        member_sha = member["sha256"]
        digest.update(str(ordinal).encode("ascii"))
        digest.update(b"\0")
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\0")
        digest.update(bytes.fromhex(member_sha))
        digest.update(b"\n")
    return digest.hexdigest()


def build_book_package_manifest(
    *,
    input_root: Path,
    job_id: str,
    book_id: str,
    book_title: str,
    source_id: str,
    include_extensions: Iterable[str] | None = None,
    created_at: str | None = None,
    source_version: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build an in-memory manifest from a stable directory without writing it."""
    _require_job_id(job_id)
    _require_id(book_id, "bookId")
    _require_id(source_id, "sourceId")
    if not isinstance(book_title, str) or not book_title.strip() or len(book_title.strip()) > 300:
        raise BookPackageError("bookTitle must be a non-empty string of at most 300 characters.")
    if source_version is not None:
        if set(source_version) != {"type", "value"}:
            raise BookPackageError("sourceVersion must contain exactly type and value.")
        for key in ("type", "value"):
            if not isinstance(source_version[key], str) or not source_version[key].strip():
                raise BookPackageError(f"sourceVersion.{key} must be a non-empty string.")
    extensions = _normalize_extensions(include_extensions)
    input_root = Path(input_root)
    if input_root.is_symlink():
        raise BookPackageError("inputRoot must not itself be a symbolic link.")
    try:
        resolved_root = input_root.resolve(strict=True)
    except FileNotFoundError as exc:
        raise BookPackageError(f"inputRoot does not exist: {input_root}") from exc
    if not resolved_root.is_dir():
        raise BookPackageError(f"inputRoot must be a directory: {input_root}")

    candidates: list[Path] = []
    excluded_file_count = 0
    for path in resolved_root.rglob("*"):
        if path.is_symlink():
            if path.suffix.lower() in extensions:
                raise BookPackageError(f"Symbolic-link source members are not allowed: {path.name}")
            continue
        if not path.is_file():
            continue
        try:
            resolved_member = path.resolve(strict=True)
        except FileNotFoundError as exc:
            raise BookPackageError(f"Source member disappeared while scanning: {path.name}") from exc
        if not _path_is_within(resolved_member, resolved_root):
            raise BookPackageError(f"Source member resolves outside inputRoot: {path.name}")
        if path.suffix.lower() in extensions:
            candidates.append(path)
        else:
            excluded_file_count += 1

    candidates.sort(key=lambda path: path.relative_to(resolved_root).as_posix())
    if not candidates:
        extension_list = ", ".join(extensions)
        raise BookPackageError(f"inputRoot has no source members with extensions: {extension_list}")

    members: list[dict[str, Any]] = []
    for ordinal, path in enumerate(candidates, start=1):
        relative_path = path.relative_to(resolved_root).as_posix()
        if not _safe_posix_relative_path(relative_path):
            raise BookPackageError(f"Source member has an unsafe relative path: {path.name}")
        before = _stable_stat_signature(path)
        if before[0] <= 0:
            raise BookPackageError(f"Empty source members are not allowed: {relative_path}")
        member_hash = file_sha256(path)
        _check_member_is_stable(path, before)
        section_hints = _explicit_section_hints(path)
        _check_member_is_stable(path, before)
        members.append(
            {
                "id": f"book-file-{ordinal:04d}",
                "ordinal": ordinal,
                "relativePath": relative_path,
                "sizeBytes": before[0],
                "sha256": member_hash,
                "mediaTypeHint": "text/plain",
                "sectionHints": section_hints,
            }
        )

    digest = package_sha256(members)
    timestamp = _parse_timestamp(created_at or utc_now(), "createdAt")
    source_ref: dict[str, Any] = {"sourceId": source_id}
    if source_version is not None:
        source_ref["sourceVersion"] = {"type": source_version["type"].strip(), "value": source_version["value"].strip()}
    manifest = {
        "recordType": RECORD_TYPE,
        "schemaVersion": SCHEMA_VERSION,
        "packageId": f"bpm-{book_id}-{digest[:12]}",
        "jobId": job_id,
        "createdAt": timestamp,
        "visibility": "private",
        "book": {"id": book_id, "title": book_title.strip()},
        "sourceRef": source_ref,
        "ordering": {"method": "relative-path-lexicographic-v1", "pathFormat": "posix"},
        "selection": {"includeExtensions": list(extensions), "excludedFileCount": excluded_file_count},
        "memberCount": len(members),
        "totalBytes": sum(member["sizeBytes"] for member in members),
        "packageSha256": digest,
        "digestSpecification": DIGEST_SPECIFICATION,
        "members": members,
    }
    validation = validate_book_package_manifest(manifest)
    if not validation.valid:
        raise BookPackageError(f"Internal manifest validation failed: {validation.payload()}")
    return manifest


def _require_fields(
    value: Any,
    *,
    required: set[str],
    allowed: set[str],
    location: str,
    errors: list[Issue],
    prefix: str,
    label: str,
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        errors.append(Issue("error", f"{prefix}-type", f"{label} must be an object.", location))
        return None
    for field in sorted(set(value) - allowed):
        errors.append(Issue("error", f"{prefix}-unknown-field", f"Unknown {label} field: {field}", f"{location}.{field}"))
    for field in sorted(required - set(value)):
        errors.append(Issue("error", f"{prefix}-missing-field", f"{label}.{field} is required.", f"{location}.{field}"))
    return value


def _validation_timestamp(value: Any, location: str, errors: list[Issue]) -> None:
    if not isinstance(value, str):
        errors.append(Issue("error", "timestamp-type", "Timestamp must be an ISO-8601 string.", location))
        return
    try:
        _parse_timestamp(value, location)
    except BookPackageError as exc:
        errors.append(Issue("error", "timestamp-value", str(exc), location))


def validate_book_package_manifest(payload: Any) -> Validation:
    """Validate the manifest structure and recompute its member-set digest."""
    errors: list[Issue] = []
    warnings: list[Issue] = []
    if not isinstance(payload, dict):
        return Validation(False, (Issue("error", "manifest-type", "Manifest must be a JSON object."),), ())

    required = {
        "recordType", "schemaVersion", "packageId", "jobId", "createdAt", "visibility", "book", "sourceRef",
        "ordering", "selection", "memberCount", "totalBytes", "packageSha256", "digestSpecification", "members",
    }
    for field in sorted(set(payload) - required):
        errors.append(Issue("error", "manifest-unknown-field", f"Unknown top-level field: {field}", field))
    for field in sorted(required - set(payload)):
        errors.append(Issue("error", "manifest-missing-field", f"Missing required top-level field: {field}", field))
    if payload.get("recordType") != RECORD_TYPE:
        errors.append(Issue("error", "manifest-record-type", f"recordType must be {RECORD_TYPE!r}.", "recordType"))
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(Issue("error", "manifest-schema-version", f"schemaVersion must be {SCHEMA_VERSION!r}.", "schemaVersion"))
    if not isinstance(payload.get("packageId"), str) or not PACKAGE_ID_RE.fullmatch(payload["packageId"]):
        errors.append(Issue("error", "manifest-package-id", "packageId must be a bpm- identifier.", "packageId"))
    if not isinstance(payload.get("jobId"), str) or not JOB_ID_RE.fullmatch(payload["jobId"]):
        errors.append(Issue("error", "manifest-job-id", "jobId must be a lowercase kebab-case job identifier.", "jobId"))
    _validation_timestamp(payload.get("createdAt"), "createdAt", errors)
    if payload.get("visibility") != "private":
        errors.append(Issue("error", "manifest-visibility", "Book package manifests are private.", "visibility"))

    book = _require_fields(
        payload.get("book"), required={"id", "title"}, allowed={"id", "title"}, location="book", errors=errors,
        prefix="book", label="book",
    )
    if book is not None:
        if not isinstance(book.get("id"), str) or not ID_RE.fullmatch(book["id"]):
            errors.append(Issue("error", "book-id", "book.id must be a lowercase kebab-case identifier.", "book.id"))
        if not isinstance(book.get("title"), str) or not book["title"].strip() or len(book["title"]) > 300:
            errors.append(Issue("error", "book-title", "book.title must be a non-empty string up to 300 characters.", "book.title"))

    source_ref = _require_fields(
        payload.get("sourceRef"), required={"sourceId"}, allowed={"sourceId", "sourceVersion"}, location="sourceRef",
        errors=errors, prefix="source-ref", label="sourceRef",
    )
    if source_ref is not None:
        if not isinstance(source_ref.get("sourceId"), str) or not ID_RE.fullmatch(source_ref["sourceId"]):
            errors.append(Issue("error", "source-ref-id", "sourceRef.sourceId must be a lowercase kebab-case identifier.", "sourceRef.sourceId"))
        if "sourceVersion" in source_ref:
            version = _require_fields(
                source_ref["sourceVersion"], required={"type", "value"}, allowed={"type", "value"},
                location="sourceRef.sourceVersion", errors=errors, prefix="source-version", label="sourceVersion",
            )
            if version is not None:
                for field in ("type", "value"):
                    if not isinstance(version.get(field), str) or not version[field].strip() or len(version[field]) > 300:
                        errors.append(Issue("error", "source-version-value", f"sourceVersion.{field} must be a non-empty string up to 300 characters.", f"sourceRef.sourceVersion.{field}"))

    ordering = _require_fields(
        payload.get("ordering"), required={"method", "pathFormat"}, allowed={"method", "pathFormat"},
        location="ordering", errors=errors, prefix="ordering", label="ordering",
    )
    if ordering is not None:
        if ordering.get("method") != "relative-path-lexicographic-v1":
            errors.append(Issue("error", "ordering-method", "ordering.method is not recognized.", "ordering.method"))
        if ordering.get("pathFormat") != "posix":
            errors.append(Issue("error", "ordering-path-format", "ordering.pathFormat must be posix.", "ordering.pathFormat"))

    selection = _require_fields(
        payload.get("selection"), required={"includeExtensions", "excludedFileCount"}, allowed={"includeExtensions", "excludedFileCount"},
        location="selection", errors=errors, prefix="selection", label="selection",
    )
    if selection is not None:
        extensions = selection.get("includeExtensions")
        if not isinstance(extensions, list) or not extensions:
            errors.append(Issue("error", "selection-extensions", "selection.includeExtensions must be a non-empty array.", "selection.includeExtensions"))
        else:
            normalized_extensions: list[str] = []
            for index, extension in enumerate(extensions):
                if not isinstance(extension, str) or not EXTENSION_RE.fullmatch(extension):
                    errors.append(Issue("error", "selection-extension", "Each include extension must look like '.txt'.", f"selection.includeExtensions[{index}]"))
                else:
                    normalized_extensions.append(extension)
            if len(normalized_extensions) != len(set(normalized_extensions)):
                errors.append(Issue("error", "selection-extension-duplicate", "includeExtensions must be unique.", "selection.includeExtensions"))
        if not _is_integer(selection.get("excludedFileCount")) or selection["excludedFileCount"] < 0:
            errors.append(Issue("error", "selection-excluded-count", "excludedFileCount must be a non-negative integer.", "selection.excludedFileCount"))

    for field, code in (("memberCount", "manifest-member-count"), ("totalBytes", "manifest-total-bytes")):
        value = payload.get(field)
        if not _is_integer(value) or value < 1:
            errors.append(Issue("error", code, f"{field} must be a positive integer.", field))
    if not isinstance(payload.get("packageSha256"), str) or not SHA256_RE.fullmatch(payload["packageSha256"]):
        errors.append(Issue("error", "manifest-package-sha", "packageSha256 must be a lowercase SHA-256 digest.", "packageSha256"))
    if payload.get("digestSpecification") != DIGEST_SPECIFICATION:
        errors.append(Issue("error", "manifest-digest-specification", "digestSpecification is not recognized.", "digestSpecification"))

    members = payload.get("members")
    valid_digest_members: list[dict[str, Any]] = []
    if not isinstance(members, list) or not members:
        errors.append(Issue("error", "members-type", "members must be a non-empty array.", "members"))
    else:
        member_ids: set[str] = set()
        relative_paths: list[str] = []
        ordinals: list[int] = []
        total_size = 0
        for index, member in enumerate(members):
            location = f"members[{index}]"
            checked = _require_fields(
                member,
                required={"id", "ordinal", "relativePath", "sizeBytes", "sha256", "mediaTypeHint", "sectionHints"},
                allowed={"id", "ordinal", "relativePath", "sizeBytes", "sha256", "mediaTypeHint", "sectionHints"},
                location=location, errors=errors, prefix="member", label="Member",
            )
            if checked is None:
                continue
            member_id = checked.get("id")
            if not isinstance(member_id, str) or not ID_RE.fullmatch(member_id):
                errors.append(Issue("error", "member-id", "Member id must be a lowercase kebab-case identifier.", f"{location}.id"))
            elif member_id in member_ids:
                errors.append(Issue("error", "member-id-duplicate", "Member ids must be unique.", f"{location}.id"))
            else:
                member_ids.add(member_id)
            ordinal = checked.get("ordinal")
            if not _is_integer(ordinal) or ordinal < 1:
                errors.append(Issue("error", "member-ordinal", "Member ordinal must be a positive integer.", f"{location}.ordinal"))
            else:
                ordinals.append(ordinal)
            relative_path = checked.get("relativePath")
            if not _safe_posix_relative_path(relative_path):
                errors.append(Issue("error", "member-relative-path", "Member relativePath must be a safe POSIX relative path.", f"{location}.relativePath"))
            else:
                relative_paths.append(relative_path)
            size_bytes = checked.get("sizeBytes")
            if not _is_integer(size_bytes) or size_bytes < 1:
                errors.append(Issue("error", "member-size", "Member sizeBytes must be a positive integer.", f"{location}.sizeBytes"))
            else:
                total_size += size_bytes
            sha = checked.get("sha256")
            if not isinstance(sha, str) or not SHA256_RE.fullmatch(sha):
                errors.append(Issue("error", "member-sha", "Member sha256 must be a lowercase SHA-256 digest.", f"{location}.sha256"))
            if checked.get("mediaTypeHint") != "text/plain":
                errors.append(Issue("error", "member-media-type", "Member mediaTypeHint must be text/plain.", f"{location}.mediaTypeHint"))
            section_hints = checked.get("sectionHints")
            if not isinstance(section_hints, list):
                errors.append(Issue("error", "member-section-hints", "sectionHints must be an array.", f"{location}.sectionHints"))
            else:
                for hint_index, hint in enumerate(section_hints):
                    hint_location = f"{location}.sectionHints[{hint_index}]"
                    checked_hint = _require_fields(
                        hint, required={"kind", "title", "line", "detector"}, allowed={"kind", "title", "line", "detector"},
                        location=hint_location, errors=errors, prefix="section-hint", label="Section hint",
                    )
                    if checked_hint is None:
                        continue
                    if checked_hint.get("kind") not in {"title", "juan", "heading"}:
                        errors.append(Issue("error", "section-hint-kind", "Section hint kind is not recognized.", f"{hint_location}.kind"))
                    if not isinstance(checked_hint.get("title"), str) or not checked_hint["title"].strip() or len(checked_hint["title"]) > MAX_SECTION_HINT_LENGTH:
                        errors.append(Issue("error", "section-hint-title", "Section hint title must be a non-empty string up to 300 characters.", f"{hint_location}.title"))
                    if not _is_integer(checked_hint.get("line")) or checked_hint["line"] < 1:
                        errors.append(Issue("error", "section-hint-line", "Section hint line must be a positive integer.", f"{hint_location}.line"))
                    if checked_hint.get("detector") not in {"org-title-v1", "kanripo-org-juan-v1", "markdown-heading-v1"}:
                        errors.append(Issue("error", "section-hint-detector", "Section hint detector is not recognized.", f"{hint_location}.detector"))
            if (
                _is_integer(ordinal)
                and isinstance(relative_path, str)
                and _is_integer(size_bytes)
                and isinstance(sha, str)
                and SHA256_RE.fullmatch(sha)
            ):
                valid_digest_members.append(
                    {"ordinal": ordinal, "relativePath": relative_path, "sizeBytes": size_bytes, "sha256": sha}
                )
        if ordinals != list(range(1, len(members) + 1)):
            errors.append(Issue("error", "member-ordinal-order", "Member ordinals must be consecutive and start at 1.", "members"))
        if len(relative_paths) != len(set(relative_paths)):
            errors.append(Issue("error", "member-relative-path-duplicate", "Member relative paths must be unique.", "members"))
        if relative_paths != sorted(relative_paths):
            errors.append(Issue("error", "member-relative-path-order", "Members must be in POSIX lexicographic path order.", "members"))
        if _is_integer(payload.get("memberCount")) and payload["memberCount"] != len(members):
            errors.append(Issue("error", "member-count-mismatch", "memberCount does not equal the number of members.", "memberCount"))
        if _is_integer(payload.get("totalBytes")) and payload["totalBytes"] != total_size:
            errors.append(Issue("error", "total-bytes-mismatch", "totalBytes does not equal the member byte sum.", "totalBytes"))
        if len(valid_digest_members) == len(members):
            expected_digest = package_sha256(valid_digest_members)
            if payload.get("packageSha256") != expected_digest:
                errors.append(Issue("error", "package-digest-mismatch", "packageSha256 does not match ordered member metadata.", "packageSha256"))

    return Validation(not errors, tuple(errors), tuple(warnings))


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BookPackageError(f"{label} does not exist: {path}") from exc
    except UnicodeDecodeError as exc:
        raise BookPackageError(f"{label} is not UTF-8: {path}") from exc
    except json.JSONDecodeError as exc:
        raise BookPackageError(f"{label} is invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc


def job_anchor(job_path: Path, job_root: Path = DEFAULT_JOB_ROOT) -> tuple[str, Path]:
    """Check that a job manifest owns the fixed output location without assuming its schema."""
    job_root = Path(job_root)
    try:
        resolved_root = job_root.resolve(strict=True)
    except FileNotFoundError as exc:
        raise BookPackageError(f"jobRoot does not exist: {job_root}") from exc
    if not resolved_root.is_dir():
        raise BookPackageError(f"jobRoot must be a directory: {job_root}")
    try:
        resolved_job = Path(job_path).resolve(strict=True)
    except FileNotFoundError as exc:
        raise BookPackageError(f"Job manifest does not exist: {job_path}") from exc
    if resolved_job.name != "job.json" or not _path_is_within(resolved_job, resolved_root):
        raise BookPackageError("Job manifest must be a job.json located below the configured job root.")
    payload = _read_json(resolved_job, "Job manifest")
    if not isinstance(payload, dict) or not isinstance(payload.get("jobId"), str):
        raise BookPackageError("Job manifest must contain a string jobId.")
    input_record = payload.get("input")
    if not isinstance(input_record, dict) or input_record.get("kind") != BOOK_PACKAGE_INPUT_KIND:
        raise BookPackageError(
            "Job manifest must explicitly declare input.kind=ordered-package-pending; "
            "do not attach a directory package to the current single-blob job contract."
        )
    job_id = _require_job_id(payload["jobId"])
    expected_directory = (resolved_root / job_id).resolve()
    if resolved_job.parent != expected_directory:
        raise BookPackageError("jobId and job.json directory do not agree.")
    return job_id, expected_directory


def write_book_package_manifest(
    *,
    job_path: Path,
    input_root: Path,
    book_id: str,
    book_title: str,
    source_id: str,
    include_extensions: Iterable[str] | None = None,
    source_version: dict[str, str] | None = None,
    job_root: Path = DEFAULT_JOB_ROOT,
    dry_run: bool = False,
) -> tuple[Path, dict[str, Any]]:
    """Build a manifest and write it only to the job's fixed private intake path."""
    job_id, job_directory = job_anchor(job_path, job_root)
    target = (job_directory / OUTPUT_STAGE / OUTPUT_NAME).resolve()
    if not _path_is_within(target, job_directory):
        raise BookPackageError("Book package output resolves outside the owning job directory.")
    if target.exists():
        raise BookPackageError(f"Book package output already exists; refusing to overwrite: {target}")
    manifest = build_book_package_manifest(
        input_root=input_root,
        job_id=job_id,
        book_id=book_id,
        book_title=book_title,
        source_id=source_id,
        include_extensions=include_extensions,
        source_version=source_version,
    )
    if not dry_run:
        write_json_atomically(target, manifest)
    return target, manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True, help="Existing owning job.json below --job-root.")
    parser.add_argument("--job-root", type=Path, default=DEFAULT_JOB_ROOT)
    parser.add_argument("--input-root", type=Path, required=True, help="Read-only directory containing source members.")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--book-title", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--include-extension", action="append", dest="include_extensions")
    parser.add_argument("--source-version-type")
    parser.add_argument("--source-version-value")
    parser.add_argument("--dry-run", action="store_true", help="Build and validate without writing the job artifact.")
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable safe summary.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if bool(args.source_version_type) != bool(args.source_version_value):
        print("Book package error: source version type and value must be provided together.", file=sys.stderr)
        return 1
    source_version = None
    if args.source_version_type:
        source_version = {"type": args.source_version_type, "value": args.source_version_value}
    try:
        target, manifest = write_book_package_manifest(
            job_path=args.job,
            job_root=args.job_root,
            input_root=args.input_root,
            book_id=args.book_id,
            book_title=args.book_title,
            source_id=args.source_id,
            include_extensions=args.include_extensions,
            source_version=source_version,
            dry_run=args.dry_run,
        )
    except BookPackageError as exc:
        print(f"Book package error: {exc}", file=sys.stderr)
        return 1
    summary = {
        "dryRun": args.dry_run,
        "output": str(target),
        "packageId": manifest["packageId"],
        "memberCount": manifest["memberCount"],
        "totalBytes": manifest["totalBytes"],
        "packageSha256": manifest["packageSha256"],
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        action = "would write" if args.dry_run else "wrote"
        print(f"Book package manifest {action}: {target}")
        print(f"Members: {summary['memberCount']}; bytes: {summary['totalBytes']}; package SHA-256: {summary['packageSha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
