#!/usr/bin/env python3
"""Create and validate isolated, reproducible poet-map job manifests.

This is the safe entry point for the future "upload a biography, build a poet
map" agent. It deliberately records only identifiers, hashes, reference
snapshots and consent flags. It never copies the upload, calls an API, writes
global data, or writes frontend assets.

Examples
--------
Create a private job after an upload service has already quarantined the file
and calculated its SHA-256::

    python scripts/poet_map_job.py init \
      --poet-id li-bai --poet-name 李白 \
      --source-id upload-li-bai-biography-20260803 \
      --input-sha256 <64-lowercase-hex-digest> \
      --content-type application/pdf \
      --data-processing-consent

Inspect the resulting job before any later pipeline stage::

    python scripts/poet_map_job.py validate --job var/jobs/<job-id>/job.json --verify-current
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JOB_ROOT = PROJECT_ROOT / "var" / "jobs"
DEFAULT_RAW_MANIFEST = PROJECT_ROOT / "data" / "raw-layer-manifest.json"
DEFAULT_SOURCE_MANIFEST = PROJECT_ROOT / "source-materials" / "source-manifest.json"

RECORD_TYPE = "poet-map-job"
SCHEMA_VERSION = "1.0.0"
STAGE_NAMES = (
    "intake",
    "extract",
    "resolve",
    "claims",
    "corpus",
    "enrichment",
    "events",
    "review",
    "map",
)
STAGE_DIRECTORIES = {
    "intake": "00-intake",
    "extract": "01-extract",
    "resolve": "02-resolve",
    "claims": "03-claims",
    "corpus": "04-corpus",
    "enrichment": "05-enrichment",
    "events": "06-events",
    "review": "07-review",
    "map": "08-map",
}
REQUIRED_REFERENCE_IDS = ("cbdb-20260718", "chinese-poetry", "source-materials")
JOB_ID_RE = re.compile(r"^pmj-[a-z0-9]+(?:-[a-z0-9]+){1,8}$")
ENTITY_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
JOB_STATUSES = frozenset(
    {
        "intake-pending",
        "running",
        "awaiting-review",
        "approved-private-preview",
        "approved-for-curation",
        "released",
        "rejected",
        "failed",
        "cancelled",
    }
)
STAGE_STATUSES = frozenset({"pending", "running", "succeeded", "failed", "skipped"})
FINAL_REVIEW_STATUSES = frozenset({"approved-private-preview", "approved-for-curation", "released"})
STAGE_FIELDS = frozenset({"name", "status", "fingerprint", "startedAt", "completedAt"})
ARTIFACT_FIELDS = frozenset({"id", "stage", "recordType", "relativePath", "sha256", "parentArtifactIds"})
TRANSITION_FIELDS = frozenset({"at", "from", "to", "actor", "reason"})
POET_FIELDS = frozenset({"id", "name", "existingPersonId", "aliases"})
INPUT_FIELDS = frozenset(
    {
        "sourceId",
        "blobSha256",
        "contentType",
        "accessLevel",
        "registrationStatus",
        "sourceVersion",
        "dataProcessingConsent",
        "externalTransferConsent",
        "retentionExpiresAt",
    }
)
SOURCE_VERSION_FIELDS = frozenset({"type", "value"})
POLICY_FIELDS = frozenset(
    {"policyVersion", "allowExternalProviders", "maxApiRequests", "maxTokens", "maxCostCny", "publicationMode"}
)
REFERENCE_SNAPSHOT_FIELDS = frozenset({"registry", "referenceId", "manifestPath", "sha256"})
INPUT_REGISTRATION_STATUSES = frozenset(
    {
        "unregistered-upload",
        "pending-rights-review",
        "pending-quality-review",
        "approved-private",
        "approved-public",
        "blocked",
    }
)
PUBLICATION_MODES = frozenset({"private-preview-only", "human-review", "policy-gated-auto"})
CONTRACT_PATH_RE = re.compile(r"^[A-Za-z0-9._/-]+$")


class JobError(ValueError):
    """Raised for invalid command input or an unsafe job operation."""


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    field: str | None = None


@dataclass(frozen=True)
class JobValidation:
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


def read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise JobError(f"{label} does not exist: {path}") from exc
    except UnicodeDecodeError as exc:
        raise JobError(f"{label} is not UTF-8: {path}") from exc
    except json.JSONDecodeError as exc:
        raise JobError(
            f"{label} is invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str, label: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise JobError(f"{label} must be an ISO-8601 timestamp: {value!r}") from exc
    if parsed.tzinfo is None:
        raise JobError(f"{label} must include a timezone: {value!r}")
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def require_id(value: str, label: str, *, job: bool = False) -> str:
    pattern = JOB_ID_RE if job else ENTITY_ID_RE
    if not pattern.fullmatch(value):
        kind = "job id" if job else "identifier"
        raise JobError(f"{label} must be a lowercase kebab-case {kind}: {value!r}")
    return value


def require_sha256(value: str, label: str) -> str:
    if not SHA256_RE.fullmatch(value):
        raise JobError(f"{label} must be a 64-character lowercase SHA-256 digest.")
    return value


def relative_path_is_safe(value: str) -> bool:
    candidate = Path(value.replace("\\", "/"))
    return bool(value) and not candidate.is_absolute() and ".." not in candidate.parts


def contract_relative_path_is_safe(value: str) -> bool:
    """Validate the forward-slash-only relative-path shape used by the JSON contract."""
    return relative_path_is_safe(value) and bool(CONTRACT_PATH_RE.fullmatch(value))


def source_registration(source: dict[str, Any] | None) -> tuple[str, dict[str, str] | None]:
    """Map the long-lived source catalogue state to the job's intake state."""
    if source is None:
        return "unregistered-upload", None

    status = source.get("ingestionStatus")
    rights = source.get("rights") if isinstance(source.get("rights"), dict) else {}
    uses = source.get("allowedUses") if isinstance(source.get("allowedUses"), list) else []
    if status == "approved":
        if rights.get("redistributionAllowed") is True and "public-redistribution" in uses:
            registration = "approved-public"
        else:
            registration = "approved-private"
    elif status == "pending-rights-review":
        registration = "pending-rights-review"
    elif status in {"pending-materialization", "pending-quality-review"}:
        registration = "pending-quality-review"
    else:
        registration = "blocked"

    version = source.get("version")
    source_version = None
    if isinstance(version, dict) and isinstance(version.get("type"), str) and isinstance(version.get("value"), str):
        source_version = {"type": version["type"], "value": version["value"]}
    return registration, source_version


def source_record(source_id: str, manifest_path: Path) -> dict[str, Any] | None:
    payload = read_json(manifest_path, "Source manifest")
    records = payload.get("sources") if isinstance(payload, dict) else None
    if not isinstance(records, list):
        raise JobError(f"Source manifest has no sources array: {manifest_path}")
    matches = [record for record in records if isinstance(record, dict) and record.get("id") == source_id]
    if len(matches) > 1:
        raise JobError(f"Source manifest contains duplicate source id: {source_id}")
    return matches[0] if matches else None


def reference_snapshots(raw_manifest_path: Path, source_manifest_path: Path) -> list[dict[str, str]]:
    raw = read_json(raw_manifest_path, "Raw-layer manifest")
    datasets = raw.get("datasets") if isinstance(raw, dict) else None
    if not isinstance(datasets, list):
        raise JobError(f"Raw-layer manifest has no datasets array: {raw_manifest_path}")
    by_id = {
        record.get("id"): record
        for record in datasets
        if isinstance(record, dict) and isinstance(record.get("id"), str)
    }
    snapshots: list[dict[str, str]] = []
    for dataset_id in REQUIRED_REFERENCE_IDS:
        record = by_id.get(dataset_id)
        if not isinstance(record, dict):
            raise JobError(f"Raw-layer manifest is missing required reference dataset: {dataset_id}")
        if dataset_id == "source-materials":
            digest = file_sha256(source_manifest_path)
            registry = "source-catalog"
            manifest_path = "source-materials/source-manifest.json"
        else:
            digest = record.get("sha256") or record.get("digest")
            registry = "raw-layer"
            manifest_path = "data/raw-layer-manifest.json"
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            raise JobError(f"Reference dataset {dataset_id} has no usable SHA-256 digest.")
        snapshots.append(
            {
                "registry": registry,
                "referenceId": dataset_id,
                "manifestPath": manifest_path,
                "sha256": digest,
            }
        )
    return snapshots


def build_job_manifest(
    *,
    job_id: str,
    created_at: str,
    poet_id: str,
    poet_name: str,
    source_id: str,
    input_sha256: str,
    content_type: str,
    access_level: str,
    data_processing_consent: bool,
    external_transfer_consent: bool,
    allow_external_providers: bool,
    max_api_requests: int,
    max_tokens: int | None,
    max_cost_cny: float | None,
    publication_mode: str,
    source: dict[str, Any] | None,
    snapshots: Iterable[dict[str, str]],
    retention_expires_at: str | None = None,
    existing_person_id: str | None = None,
) -> dict[str, Any]:
    """Create a fresh manifest without touching the filesystem."""
    require_id(job_id, "jobId", job=True)
    require_id(poet_id, "poet id")
    require_id(source_id, "source id")
    require_sha256(input_sha256, "input SHA-256")
    if not poet_name.strip():
        raise JobError("poet name must not be empty.")
    if not content_type.strip():
        raise JobError("content type must not be empty.")
    if access_level not in {"quarantine", "private"}:
        raise JobError("access level must be quarantine or private.")
    if max_api_requests < 0:
        raise JobError("max API requests must not be negative.")
    if max_tokens is not None and max_tokens < 0:
        raise JobError("max tokens must not be negative.")
    if max_cost_cny is not None and max_cost_cny < 0:
        raise JobError("max cost must not be negative.")
    if publication_mode not in {"private-preview-only", "human-review", "policy-gated-auto"}:
        raise JobError("publication mode is not recognized.")
    if allow_external_providers and not external_transfer_consent:
        raise JobError("External providers require explicit external-transfer consent.")
    if external_transfer_consent and not data_processing_consent:
        raise JobError("External-transfer consent requires data-processing consent.")
    if existing_person_id is not None:
        require_id(existing_person_id, "existing person id")

    created_at = parse_timestamp(created_at, "createdAt")
    if retention_expires_at is not None:
        retention_expires_at = parse_timestamp(retention_expires_at, "retention expiry")

    registration_status, source_version = source_registration(source)
    input_record: dict[str, Any] = {
        "sourceId": source_id,
        "blobSha256": input_sha256,
        "contentType": content_type.strip(),
        "accessLevel": access_level,
        "registrationStatus": registration_status,
        "dataProcessingConsent": data_processing_consent,
        "externalTransferConsent": external_transfer_consent,
    }
    if source_version is not None:
        input_record["sourceVersion"] = source_version
    if retention_expires_at is not None:
        input_record["retentionExpiresAt"] = retention_expires_at

    poet: dict[str, Any] = {"id": poet_id, "name": poet_name.strip()}
    if existing_person_id is not None:
        poet["existingPersonId"] = existing_person_id

    policy: dict[str, Any] = {
        "policyVersion": "poet-map-private-preview-v1",
        "allowExternalProviders": allow_external_providers,
        "maxApiRequests": max_api_requests,
        "publicationMode": publication_mode,
    }
    if max_tokens is not None:
        policy["maxTokens"] = max_tokens
    if max_cost_cny is not None:
        policy["maxCostCny"] = max_cost_cny

    return {
        "recordType": RECORD_TYPE,
        "schemaVersion": SCHEMA_VERSION,
        "jobId": job_id,
        "status": "intake-pending",
        "createdAt": created_at,
        "poet": poet,
        "input": input_record,
        "referenceSnapshots": list(snapshots),
        "policy": policy,
        "stages": [{"name": name, "status": "pending"} for name in STAGE_NAMES],
        "artifacts": [],
        "transitions": [
            {
                "at": created_at,
                "from": None,
                "to": "intake-pending",
                "actor": "poet-map-job:init",
                "reason": "Job created; no source text or external service has been processed.",
            }
        ],
    }


def validate_job_manifest(
    payload: Any,
    *,
    artifact_root: Path | None = None,
    verify_current: bool = False,
    raw_manifest_path: Path = DEFAULT_RAW_MANIFEST,
    source_manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
) -> JobValidation:
    """Validate the contract and optionally recheck job artifacts and reference snapshots."""
    errors: list[Issue] = []
    warnings: list[Issue] = []

    def error(code: str, message: str, field: str | None = None) -> None:
        errors.append(Issue("error", code, message, field))

    def warning(code: str, message: str, field: str | None = None) -> None:
        warnings.append(Issue("warning", code, message, field))

    if not isinstance(payload, dict):
        error("job-type", "Job manifest must be a JSON object.")
        return JobValidation(False, tuple(errors), tuple(warnings))

    expected_fields = {
        "recordType",
        "schemaVersion",
        "jobId",
        "status",
        "createdAt",
        "poet",
        "input",
        "referenceSnapshots",
        "policy",
        "stages",
        "artifacts",
        "transitions",
    }
    unknown = sorted(set(payload) - expected_fields)
    missing = sorted(expected_fields - set(payload))
    for field in unknown:
        error("job-unknown-field", f"Unknown top-level field: {field}", field)
    for field in missing:
        error("job-missing-field", f"Missing required top-level field: {field}", field)

    if payload.get("recordType") != RECORD_TYPE:
        error("job-record-type", f"recordType must be {RECORD_TYPE!r}", "recordType")
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        error("job-schema-version", f"schemaVersion must be {SCHEMA_VERSION!r}", "schemaVersion")
    job_id = payload.get("jobId")
    if not isinstance(job_id, str) or not JOB_ID_RE.fullmatch(job_id):
        error("job-id", "jobId must be a lowercase pmj- identifier.", "jobId")
    job_status = payload.get("status")
    if job_status not in JOB_STATUSES:
        error("job-status", "Job status is not recognized.", "status")
    elif job_status == "released":
        error(
            "job-release-unsupported",
            "A private poet-map job cannot claim release; use a separately validated release manifest.",
            "status",
        )

    created_at = payload.get("createdAt")
    if not isinstance(created_at, str):
        error("job-created-at", "createdAt must be an ISO-8601 timestamp.", "createdAt")
    else:
        try:
            parse_timestamp(created_at, "createdAt")
        except JobError as exc:
            error("job-created-at", str(exc), "createdAt")

    poet = payload.get("poet")
    if not isinstance(poet, dict):
        error("poet-type", "poet must be an object.", "poet")
    else:
        for unknown_field in sorted(set(poet) - POET_FIELDS):
            error("poet-unknown-field", f"Unknown poet field: {unknown_field}", f"poet.{unknown_field}")
        for field in ("id", "name"):
            if field not in poet:
                error("poet-missing-field", f"poet.{field} is required.", f"poet.{field}")
        if not isinstance(poet.get("id"), str) or not ENTITY_ID_RE.fullmatch(poet["id"]):
            error("poet-id", "poet.id must be a lowercase kebab-case identifier.", "poet.id")
        if not isinstance(poet.get("name"), str) or not poet["name"].strip() or len(poet["name"]) > 200:
            error("poet-name", "poet.name must be a non-empty string up to 200 characters.", "poet.name")
        if "existingPersonId" in poet:
            existing_person_id = poet["existingPersonId"]
            if not isinstance(existing_person_id, str) or not ENTITY_ID_RE.fullmatch(existing_person_id):
                error(
                    "poet-existing-person-id",
                    "poet.existingPersonId must be a lowercase kebab-case identifier.",
                    "poet.existingPersonId",
                )
        if "aliases" in poet:
            aliases = poet["aliases"]
            if not isinstance(aliases, list):
                error("poet-aliases", "poet.aliases must be an array when present.", "poet.aliases")
            else:
                valid_aliases: list[str] = []
                for index, alias in enumerate(aliases):
                    if not isinstance(alias, str) or not alias or len(alias) > 200:
                        error(
                            "poet-alias",
                            "Each poet alias must be a non-empty string up to 200 characters.",
                            f"poet.aliases[{index}]",
                        )
                    else:
                        valid_aliases.append(alias)
                if len(valid_aliases) != len(set(valid_aliases)):
                    error("poet-alias-duplicate", "poet.aliases must be unique.", "poet.aliases")

    input_record = payload.get("input")
    if not isinstance(input_record, dict):
        error("input-type", "input must be an object.", "input")
    else:
        for unknown_field in sorted(set(input_record) - INPUT_FIELDS):
            error("input-unknown-field", f"Unknown input field: {unknown_field}", f"input.{unknown_field}")
        for field in (
            "sourceId",
            "blobSha256",
            "contentType",
            "accessLevel",
            "registrationStatus",
            "dataProcessingConsent",
            "externalTransferConsent",
        ):
            if field not in input_record:
                error("input-missing-field", f"input.{field} is required.", f"input.{field}")
        if not isinstance(input_record.get("sourceId"), str) or not ENTITY_ID_RE.fullmatch(
            input_record["sourceId"]
        ):
            error("input-source-id", "input.sourceId must be a lowercase kebab-case identifier.", "input.sourceId")
        if not isinstance(input_record.get("blobSha256"), str) or not SHA256_RE.fullmatch(
            input_record["blobSha256"]
        ):
            error("input-sha256", "input.blobSha256 must be a SHA-256 digest.", "input.blobSha256")
        if (
            not isinstance(input_record.get("contentType"), str)
            or not input_record["contentType"].strip()
            or len(input_record["contentType"]) > 200
        ):
            error("input-content-type", "input.contentType must be a non-empty string up to 200 characters.", "input.contentType")
        if input_record.get("accessLevel") not in {"quarantine", "private"}:
            error("input-access", "input.accessLevel must be quarantine or private.", "input.accessLevel")
        registration = input_record.get("registrationStatus")
        if registration not in INPUT_REGISTRATION_STATUSES:
            error("input-registration", "input.registrationStatus is not recognized.", "input.registrationStatus")
        if registration == "unregistered-upload":
            warning(
                "input-unregistered",
                "The upload is not registered in the long-lived source catalogue; it cannot support a public release.",
                "input.registrationStatus",
            )
        for consent_field in ("dataProcessingConsent", "externalTransferConsent"):
            if not isinstance(input_record.get(consent_field), bool):
                error(
                    "input-consent-type",
                    f"input.{consent_field} must be a boolean.",
                    f"input.{consent_field}",
                )
        if input_record.get("externalTransferConsent") is True and input_record.get("dataProcessingConsent") is not True:
            error(
                "input-consent-order",
                "External-transfer consent requires data-processing consent.",
                "input.externalTransferConsent",
            )
        if "sourceVersion" in input_record:
            source_version = input_record["sourceVersion"]
            if not isinstance(source_version, dict):
                error("input-source-version", "input.sourceVersion must be an object when present.", "input.sourceVersion")
            else:
                for unknown_field in sorted(set(source_version) - SOURCE_VERSION_FIELDS):
                    error(
                        "input-source-version-unknown-field",
                        f"Unknown input.sourceVersion field: {unknown_field}",
                        f"input.sourceVersion.{unknown_field}",
                    )
                for field in ("type", "value"):
                    if field not in source_version:
                        error(
                            "input-source-version-missing-field",
                            f"input.sourceVersion.{field} is required.",
                            f"input.sourceVersion.{field}",
                        )
                    elif not isinstance(source_version[field], str) or not source_version[field].strip():
                        error(
                            "input-source-version-field",
                            f"input.sourceVersion.{field} must be a non-empty string.",
                            f"input.sourceVersion.{field}",
                        )
        if "retentionExpiresAt" in input_record:
            retention_expires_at = input_record["retentionExpiresAt"]
            if not isinstance(retention_expires_at, str):
                error(
                    "input-retention-expiry",
                    "input.retentionExpiresAt must be an ISO-8601 timestamp.",
                    "input.retentionExpiresAt",
                )
            else:
                try:
                    parse_timestamp(retention_expires_at, "input retention expiry")
                except JobError as exc:
                    error("input-retention-expiry", str(exc), "input.retentionExpiresAt")

    policy = payload.get("policy")
    if not isinstance(policy, dict):
        error("policy-type", "policy must be an object.", "policy")
    else:
        for unknown_field in sorted(set(policy) - POLICY_FIELDS):
            error("policy-unknown-field", f"Unknown policy field: {unknown_field}", f"policy.{unknown_field}")
        for field in ("policyVersion", "allowExternalProviders", "maxApiRequests", "publicationMode"):
            if field not in policy:
                error("policy-missing-field", f"policy.{field} is required.", f"policy.{field}")
        if not isinstance(policy.get("policyVersion"), str) or not policy["policyVersion"].strip():
            error("policy-version", "policy.policyVersion must be a non-empty string.", "policy.policyVersion")
        if not isinstance(policy.get("allowExternalProviders"), bool):
            error(
                "policy-external-provider-type",
                "policy.allowExternalProviders must be a boolean.",
                "policy.allowExternalProviders",
            )
        publication_mode = policy.get("publicationMode")
        if publication_mode not in PUBLICATION_MODES:
            error(
                "policy-publication-mode",
                "policy.publicationMode must be private-preview-only, human-review, or policy-gated-auto.",
                "policy.publicationMode",
            )
        elif publication_mode == "policy-gated-auto" and isinstance(input_record, dict) and input_record.get(
            "registrationStatus"
        ) != "approved-public":
            warning(
                "policy-auto-publication-blocked",
                "Automatic public release remains blocked until the input and evidence have public, governed sources.",
                "policy.publicationMode",
            )
        if policy.get("allowExternalProviders") is True and isinstance(input_record, dict) and input_record.get(
            "externalTransferConsent"
        ) is not True:
            error(
                "policy-external-consent",
                "External providers require explicit input.externalTransferConsent.",
                "policy.allowExternalProviders",
            )
        if (
            not isinstance(policy.get("maxApiRequests"), int)
            or isinstance(policy.get("maxApiRequests"), bool)
            or policy["maxApiRequests"] < 0
        ):
            error("policy-api-budget", "policy.maxApiRequests must be a non-negative integer.", "policy.maxApiRequests")
        if "maxTokens" in policy:
            max_tokens = policy["maxTokens"]
            if not isinstance(max_tokens, int) or isinstance(max_tokens, bool) or max_tokens < 0:
                error(
                    "policy-token-budget",
                    "policy.maxTokens must be a non-negative integer when present.",
                    "policy.maxTokens",
                )
        if "maxCostCny" in policy:
            max_cost_cny = policy["maxCostCny"]
            if (
                not isinstance(max_cost_cny, (int, float))
                or isinstance(max_cost_cny, bool)
                or max_cost_cny < 0
            ):
                error(
                    "policy-cost-budget",
                    "policy.maxCostCny must be a non-negative number when present.",
                    "policy.maxCostCny",
                )

    snapshots = payload.get("referenceSnapshots")
    snapshot_keys: set[tuple[str, str]] = set()
    if not isinstance(snapshots, list) or not snapshots:
        error("references-type", "referenceSnapshots must be a non-empty array.", "referenceSnapshots")
    else:
        for index, snapshot in enumerate(snapshots):
            field = f"referenceSnapshots[{index}]"
            if not isinstance(snapshot, dict):
                error("reference-type", "Reference snapshot must be an object.", field)
                continue
            for unknown_field in sorted(set(snapshot) - REFERENCE_SNAPSHOT_FIELDS):
                error(
                    "reference-unknown-field",
                    f"Unknown reference snapshot field: {unknown_field}",
                    f"{field}.{unknown_field}",
                )
            for required_field in ("registry", "referenceId", "manifestPath", "sha256"):
                if required_field not in snapshot:
                    error(
                        "reference-missing-field",
                        f"Reference snapshot field is required: {required_field}",
                        f"{field}.{required_field}",
                    )
            registry = snapshot.get("registry")
            reference_id = snapshot.get("referenceId")
            digest = snapshot.get("sha256")
            if registry not in {"raw-layer", "source-catalog"}:
                error("reference-registry", "Reference registry must be raw-layer or source-catalog.", f"{field}.registry")
            if not isinstance(reference_id, str) or not ENTITY_ID_RE.fullmatch(reference_id):
                error("reference-id", "Reference id must be a lowercase kebab-case identifier.", f"{field}.referenceId")
            if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
                error("reference-sha256", "Reference snapshot must have a SHA-256 digest.", f"{field}.sha256")
            manifest_path = snapshot.get("manifestPath")
            if not isinstance(manifest_path, str) or not contract_relative_path_is_safe(manifest_path):
                error(
                    "reference-path",
                    "Reference manifest path must be a safe forward-slash relative path.",
                    f"{field}.manifestPath",
                )
            if isinstance(registry, str) and isinstance(reference_id, str):
                key = (registry, reference_id)
                if key in snapshot_keys:
                    error("reference-duplicate", "Reference snapshots must be unique by registry/id.", field)
                snapshot_keys.add(key)
        found_ids = {reference_id for _, reference_id in snapshot_keys}
        missing_refs = sorted(set(REQUIRED_REFERENCE_IDS) - found_ids)
        if missing_refs:
            error(
                "reference-missing-required",
                "Job must snapshot CBDB, chinese-poetry, and source-materials: " + ", ".join(missing_refs),
                "referenceSnapshots",
            )

    stages = payload.get("stages")
    stage_statuses: dict[str, str] = {}
    if not isinstance(stages, list):
        error("stages-type", "stages must be an array.", "stages")
    else:
        names = [stage.get("name") for stage in stages if isinstance(stage, dict)]
        if tuple(names) != STAGE_NAMES:
            error("stages-order", "Stages must contain the standard ordered pipeline exactly once.", "stages")
        for index, stage in enumerate(stages):
            field = f"stages[{index}]"
            if not isinstance(stage, dict):
                error("stage-status", "Each stage must have a recognized status.", f"stages[{index}]")
                continue
            for unknown_field in sorted(set(stage) - STAGE_FIELDS):
                error(
                    "stage-unknown-field",
                    f"Unknown stage field: {unknown_field}",
                    f"{field}.{unknown_field}",
                )
            name = stage.get("name")
            status = stage.get("status")
            if name not in STAGE_NAMES:
                error("stage-name", "Each stage must have a known name.", f"{field}.name")
            if status not in STAGE_STATUSES:
                error("stage-status", "Each stage must have a recognized status.", f"{field}.status")
            if isinstance(name, str) and isinstance(status, str) and name in STAGE_NAMES and status in STAGE_STATUSES:
                stage_statuses[name] = status
            if status == "succeeded":
                fingerprint = stage.get("fingerprint")
                if not isinstance(fingerprint, str) or not SHA256_RE.fullmatch(fingerprint):
                    error(
                        "stage-fingerprint",
                        "A succeeded stage must retain a SHA-256 fingerprint.",
                        f"{field}.fingerprint",
                    )
                completed_at = stage.get("completedAt")
                if not isinstance(completed_at, str):
                    error(
                        "stage-completed-at",
                        "A succeeded stage must retain its completion time.",
                        f"{field}.completedAt",
                    )
                else:
                    try:
                        parse_timestamp(completed_at, "stage completion time")
                    except JobError as exc:
                        error("stage-completed-at", str(exc), f"{field}.completedAt")
            started_at = stage.get("startedAt")
            if started_at is not None:
                if not isinstance(started_at, str):
                    error("stage-started-at", "Stage start time must be an ISO-8601 timestamp.", f"{field}.startedAt")
                else:
                    try:
                        parse_timestamp(started_at, "stage start time")
                    except JobError as exc:
                        error("stage-started-at", str(exc), f"{field}.startedAt")

    artifacts = payload.get("artifacts")
    artifact_ids: set[str] = set()
    artifact_counts_by_stage: dict[str, int] = {}
    artifact_parents: list[tuple[str, list[str]]] = []
    if not isinstance(artifacts, list):
        error("artifacts-type", "artifacts must be an array.", "artifacts")
    else:
        for index, artifact in enumerate(artifacts):
            field = f"artifacts[{index}]"
            if not isinstance(artifact, dict):
                error("artifact-type", "Artifact must be an object.", field)
                continue
            for unknown_field in sorted(set(artifact) - ARTIFACT_FIELDS):
                error(
                    "artifact-unknown-field",
                    f"Unknown artifact field: {unknown_field}",
                    f"{field}.{unknown_field}",
                )
            artifact_id = artifact.get("id")
            if not isinstance(artifact_id, str) or not ENTITY_ID_RE.fullmatch(artifact_id):
                error("artifact-id", "Artifact id must be a lowercase kebab-case identifier.", f"{field}.id")
            elif artifact_id in artifact_ids:
                error("artifact-duplicate", "Artifact ids must be unique.", f"{field}.id")
            else:
                artifact_ids.add(artifact_id)
            artifact_stage = artifact.get("stage")
            if artifact_stage not in STAGE_NAMES:
                error("artifact-stage", "Artifact stage must be a known stage.", f"{field}.stage")
            elif isinstance(artifact_stage, str):
                artifact_counts_by_stage[artifact_stage] = artifact_counts_by_stage.get(artifact_stage, 0) + 1
            if not isinstance(artifact.get("recordType"), str) or not artifact["recordType"].strip():
                error("artifact-record-type", "Artifact recordType must be non-empty.", f"{field}.recordType")
            if not isinstance(artifact.get("relativePath"), str) or not relative_path_is_safe(
                artifact["relativePath"]
            ):
                error("artifact-path", "Artifact path must be a safe job-relative path.", f"{field}.relativePath")
            if not isinstance(artifact.get("sha256"), str) or not SHA256_RE.fullmatch(artifact["sha256"]):
                error("artifact-sha256", "Artifact sha256 must be a SHA-256 digest.", f"{field}.sha256")
            parents = artifact.get("parentArtifactIds", [])
            if not isinstance(parents, list):
                error("artifact-parents", "parentArtifactIds must be an array when present.", f"{field}.parentArtifactIds")
            else:
                valid_parents: list[str] = []
                for parent_index, parent_id in enumerate(parents):
                    if not isinstance(parent_id, str) or not ENTITY_ID_RE.fullmatch(parent_id):
                        error(
                            "artifact-parent-id",
                            "Each parent artifact id must be a lowercase kebab-case identifier.",
                            f"{field}.parentArtifactIds[{parent_index}]",
                        )
                    else:
                        valid_parents.append(parent_id)
                if len(valid_parents) != len(set(valid_parents)):
                    error("artifact-parent-duplicate", "parentArtifactIds must be unique.", f"{field}.parentArtifactIds")
                if isinstance(artifact_id, str) and ENTITY_ID_RE.fullmatch(artifact_id):
                    artifact_parents.append((artifact_id, valid_parents))

        for artifact_id, parent_ids in artifact_parents:
            for parent_id in parent_ids:
                if parent_id not in artifact_ids:
                    error(
                        "artifact-parent-missing",
                        f"Artifact {artifact_id} references an unknown parent artifact: {parent_id}.",
                        "artifacts",
                    )
                elif parent_id == artifact_id:
                    error(
                        "artifact-parent-self",
                        f"Artifact {artifact_id} cannot be its own parent.",
                        "artifacts",
                    )

    for stage_name, stage_status in stage_statuses.items():
        if stage_status == "succeeded" and artifact_counts_by_stage.get(stage_name, 0) == 0:
            error(
                "stage-missing-artifact",
                "A succeeded stage must have at least one registered artifact.",
                f"stages[{STAGE_NAMES.index(stage_name)}]",
            )
    for stage_name in artifact_counts_by_stage:
        if stage_statuses.get(stage_name) != "succeeded":
            error(
                "artifact-stage-not-succeeded",
                "Artifacts may be registered only for succeeded stages.",
                f"artifacts[{stage_name}]",
            )

    if job_status == "intake-pending" and any(status != "pending" for status in stage_statuses.values()):
        error(
            "job-status-stage-mismatch",
            "An intake-pending job cannot contain advanced stages.",
            "status",
        )
    if job_status in FINAL_REVIEW_STATUSES and any(
        stage_statuses.get(stage_name) != "succeeded" for stage_name in STAGE_NAMES
    ):
        error(
            "job-final-stages-incomplete",
            "An approved or released job requires every standard stage to succeed.",
            "status",
        )

    transitions = payload.get("transitions")
    if not isinstance(transitions, list) or not transitions:
        error("transitions-type", "transitions must be a non-empty array.", "transitions")
    else:
        previous_status: str | None = None
        final_transition_status: str | None = None
        for index, transition in enumerate(transitions):
            field = f"transitions[{index}]"
            if not isinstance(transition, dict):
                error("transition-type", "Transition must be an object.", field)
                continue
            for unknown_field in sorted(set(transition) - TRANSITION_FIELDS):
                error(
                    "transition-unknown-field",
                    f"Unknown transition field: {unknown_field}",
                    f"{field}.{unknown_field}",
                )
            from_status = transition.get("from")
            if from_status is not None and from_status not in JOB_STATUSES:
                error("transition-from", "Transition source status is not recognized.", f"{field}.from")
            elif from_status != previous_status:
                error(
                    "transition-chain",
                    "Each transition must start at the previous transition's destination.",
                    f"{field}.from",
                )
            to_status = transition.get("to")
            if to_status not in JOB_STATUSES:
                error("transition-to", "Transition destination status is not recognized.", f"{field}.to")
            elif isinstance(to_status, str):
                previous_status = to_status
                final_transition_status = to_status
            if not isinstance(transition.get("at"), str):
                error("transition-at", "Transition timestamp is required.", f"{field}.at")
            else:
                try:
                    parse_timestamp(transition["at"], "transition timestamp")
                except JobError as exc:
                    error("transition-at", str(exc), f"{field}.at")
            if not isinstance(transition.get("actor"), str) or not transition["actor"].strip():
                error("transition-actor", "Transition actor is required.", f"{field}.actor")
            reason = transition.get("reason")
            if reason is not None and (not isinstance(reason, str) or len(reason) > 1000):
                error("transition-reason", "Transition reason must be a string up to 1000 characters.", f"{field}.reason")
        if final_transition_status is not None and job_status in JOB_STATUSES and final_transition_status != job_status:
            error(
                "transition-final-status",
                "The final transition destination must equal the manifest status.",
                "transitions",
            )

    if artifact_root is not None and not errors:
        try:
            root = artifact_root.resolve()
        except OSError as exc:
            error("artifact-root", f"Cannot resolve job artifact root: {exc}", "artifacts")
        else:
            if not root.is_dir():
                error("artifact-root", "Job artifact root must be an existing directory.", "artifacts")
            elif isinstance(artifacts, list):
                for index, artifact in enumerate(artifacts):
                    # The structural pass above guarantees this shape before disk access.
                    if not isinstance(artifact, dict):
                        continue
                    relative_path = artifact.get("relativePath")
                    expected_sha256 = artifact.get("sha256")
                    if not isinstance(relative_path, str) or not isinstance(expected_sha256, str):
                        continue
                    field = f"artifacts[{index}]"
                    try:
                        target = (root / relative_path).resolve()
                    except OSError as exc:
                        error(
                            "artifact-path-resolve",
                            f"Cannot resolve registered artifact path: {exc}",
                            f"{field}.relativePath",
                        )
                        continue
                    try:
                        target.relative_to(root)
                    except ValueError:
                        error(
                            "artifact-path-outside-job",
                            "Registered artifact resolves outside the job directory.",
                            f"{field}.relativePath",
                        )
                        continue
                    if not target.is_file():
                        error(
                            "artifact-file-missing",
                            "Registered artifact file is missing or is not a regular file.",
                            f"{field}.relativePath",
                        )
                        continue
                    try:
                        actual_sha256 = file_sha256(target)
                    except OSError as exc:
                        error(
                            "artifact-file-read",
                            f"Cannot read registered artifact for hash verification: {exc}",
                            f"{field}.relativePath",
                        )
                        continue
                    if actual_sha256 != expected_sha256:
                        error(
                            "artifact-sha256-mismatch",
                            "Registered artifact no longer matches its recorded SHA-256 digest.",
                            f"{field}.sha256",
                        )

    if verify_current and not errors:
        try:
            current = reference_snapshots(raw_manifest_path, source_manifest_path)
        except JobError as exc:
            error("reference-current-read", str(exc), "referenceSnapshots")
        else:
            expected = {
                (snapshot["registry"], snapshot["referenceId"]): snapshot["sha256"] for snapshot in current
            }
            actual = {
                (snapshot.get("registry"), snapshot.get("referenceId")): snapshot.get("sha256")
                for snapshot in snapshots
                if isinstance(snapshot, dict)
            }
            for key, current_digest in expected.items():
                if actual.get(key) != current_digest:
                    warning(
                        "reference-snapshot-stale",
                        f"{key[1]} no longer matches the current governed snapshot; rerun affected stages.",
                        "referenceSnapshots",
                    )

    return JobValidation(not errors, tuple(errors), tuple(warnings))


def job_directory(job_root: Path, job_id: str) -> Path:
    root = job_root.resolve()
    target = (root / job_id).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise JobError("Job id resolves outside the configured job root.") from exc
    return target


def write_json_atomically(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def initialize_job(job_root: Path, job: dict[str, Any], *, dry_run: bool = False) -> Path:
    job_id = job.get("jobId")
    if not isinstance(job_id, str):
        raise JobError("A job manifest requires jobId before initialization.")
    target = job_directory(job_root, job_id)
    if target.exists():
        raise JobError(f"Job directory already exists; refusing to overwrite: {target}")
    if dry_run:
        return target
    target.mkdir(parents=True)
    try:
        for directory in (*STAGE_DIRECTORIES.values(), "audit"):
            (target / directory).mkdir()
        write_json_atomically(target / "job.json", job)
    except BaseException:
        # The job directory is newly created and contains no prior user state.
        for child in sorted(target.rglob("*"), reverse=True):
            if child.is_file():
                child.unlink(missing_ok=True)
            elif child.is_dir():
                child.rmdir()
        target.rmdir()
        raise
    return target


def load_job(job_path: Path) -> dict[str, Any]:
    """Read and verify a job manifest before a stage mutates it."""
    payload = read_json(job_path, "Job manifest")
    validation = validate_job_manifest(payload)
    if not validation.valid:
        raise JobError(
            "Cannot advance an invalid job manifest: "
            + "; ".join(f"{issue.code}: {issue.message}" for issue in validation.errors)
        )
    if not isinstance(payload, dict):  # Kept for static type narrowing.
        raise JobError("Job manifest must be an object.")
    root = job_root_for_manifest(job_path, payload)
    validation = validate_job_manifest(payload, artifact_root=root)
    if not validation.valid:
        raise JobError(
            "Cannot advance an invalid job manifest: "
            + "; ".join(f"{issue.code}: {issue.message}" for issue in validation.errors)
        )
    return payload


def job_root_for_manifest(job_path: Path, job: dict[str, Any]) -> Path:
    """Return the isolated job directory and reject a misleading manifest path."""
    job_path = job_path.resolve()
    job_id = job.get("jobId")
    if not isinstance(job_id, str) or job_path.name != "job.json" or job_path.parent.name != job_id:
        raise JobError("Job path must be var/jobs/<job-id>/job.json for the manifest's own jobId.")
    return job_path.parent


def make_artifact(
    job_root: Path,
    *,
    stage: str,
    artifact_id: str,
    record_type: str,
    relative_path: str,
    parent_artifact_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Create a checked artifact descriptor for an already-written job-local file."""
    if stage not in STAGE_NAMES:
        raise JobError(f"Unknown job stage: {stage}")
    require_id(artifact_id, "artifact id")
    if not record_type.strip():
        raise JobError("artifact record type must not be empty.")
    if not relative_path_is_safe(relative_path):
        raise JobError("artifact path must be a safe job-relative path.")
    root = job_root.resolve()
    target = (root / relative_path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise JobError("Artifact path resolves outside the job directory.") from exc
    if not target.is_file():
        raise JobError(f"Artifact file does not exist: {target}")
    parents = list(parent_artifact_ids)
    for parent in parents:
        require_id(parent, "parent artifact id")
    if len(parents) != len(set(parents)):
        raise JobError("parent artifact ids must be unique.")
    descriptor: dict[str, Any] = {
        "id": artifact_id,
        "stage": stage,
        "recordType": record_type,
        "relativePath": relative_path.replace("\\", "/"),
        "sha256": file_sha256(target),
    }
    if parents:
        descriptor["parentArtifactIds"] = parents
    return descriptor


def _stage_fingerprint(job: dict[str, Any], stage: str, artifacts: Iterable[dict[str, Any]]) -> str:
    source = {
        "stage": stage,
        "input": job.get("input", {}).get("blobSha256"),
        "references": job.get("referenceSnapshots"),
        "artifacts": [
            {"id": artifact.get("id"), "sha256": artifact.get("sha256")}
            for artifact in artifacts
            if artifact.get("stage") == stage
        ],
        "schemaVersion": job.get("schemaVersion"),
    }
    encoded = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def complete_stages(
    job_path: Path,
    *,
    stage_names: Iterable[str],
    artifacts: Iterable[dict[str, Any]],
    actor: str,
    reason: str,
    final_status: str = "running",
    completed_at: str | None = None,
) -> dict[str, Any]:
    """Atomically record successful, non-overwriting job stages.

    Stage files must already be present under the job directory. This function
    validates their descriptors and refuses to replace an existing successful
    stage, so retries must create a new job or an explicit future revision.
    """
    job = load_job(job_path)
    root = job_root_for_manifest(job_path, job)
    requested = tuple(stage_names)
    if not requested or any(stage not in STAGE_NAMES for stage in requested):
        raise JobError("At least one known stage must be completed.")
    if len(set(requested)) != len(requested):
        raise JobError("A stage may be completed only once per operation.")
    if final_status == "released":
        raise JobError(
            "A private poet-map job cannot be marked released; use an explicit validated release workflow."
        )
    if final_status not in {
        "running",
        "awaiting-review",
        "approved-private-preview",
        "approved-for-curation",
    }:
        raise JobError(f"Invalid final job status: {final_status}")
    if not actor.strip() or not reason.strip():
        raise JobError("Stage completion requires a non-empty actor and reason.")
    completed_at = parse_timestamp(completed_at or utc_now(), "stage completion time")

    records = list(artifacts)
    if not records:
        raise JobError("Each completed stage requires at least one verified artifact.")
    if any(not isinstance(record, dict) for record in records):
        raise JobError("Stage artifact must be an object.")
    artifact_ids = {record.get("id") for record in records}
    if len(artifact_ids) != len(records) or None in artifact_ids:
        raise JobError("Stage artifacts require unique ids.")
    existing_artifact_ids = {record.get("id") for record in job.get("artifacts", []) if isinstance(record, dict)}
    if existing_artifact_ids & artifact_ids:
        raise JobError("A stage artifact id already exists; refusing to overwrite job history.")
    for record in records:
        if record.get("stage") not in requested:
            raise JobError("Stage artifact must belong to a stage completed by this operation.")
        expected = make_artifact(
            root,
            stage=record["stage"],
            artifact_id=record["id"],
            record_type=record.get("recordType", ""),
            relative_path=record.get("relativePath", ""),
            parent_artifact_ids=record.get("parentArtifactIds", ()),
        )
        if expected != record:
            raise JobError(f"Artifact descriptor does not match the on-disk file: {record.get('id')}")

    stages_without_artifacts = [
        stage_name for stage_name in requested if not any(record.get("stage") == stage_name for record in records)
    ]
    if stages_without_artifacts:
        raise JobError(
            "Each completed stage requires at least one verified artifact: "
            + ", ".join(stages_without_artifacts)
        )

    next_job = json.loads(json.dumps(job))
    stage_by_name = {record.get("name"): record for record in next_job["stages"] if isinstance(record, dict)}
    for name in requested:
        stage = stage_by_name.get(name)
        if not isinstance(stage, dict) or stage.get("status") != "pending":
            raise JobError(f"Stage {name} is not pending; refusing to overwrite it.")
        index = STAGE_NAMES.index(name)
        blockers = [
            prior
            for prior in STAGE_NAMES[:index]
            if prior not in requested and stage_by_name.get(prior, {}).get("status") != "succeeded"
        ]
        if blockers:
            raise JobError(f"Stage {name} cannot complete before: {', '.join(blockers)}")

    if final_status in {"approved-private-preview", "approved-for-curation"}:
        incomplete = [
            stage_name
            for stage_name in STAGE_NAMES
            if stage_name not in requested and stage_by_name.get(stage_name, {}).get("status") != "succeeded"
        ]
        if incomplete:
            raise JobError(
                f"Job status {final_status} requires every standard stage to succeed; still incomplete: "
                + ", ".join(incomplete)
            )

    next_job["artifacts"].extend(records)
    for name in requested:
        stage = stage_by_name[name]
        stage["status"] = "succeeded"
        stage["fingerprint"] = _stage_fingerprint(next_job, name, records)
        stage["completedAt"] = completed_at
    previous_status = next_job["status"]
    next_job["status"] = final_status
    next_job["transitions"].append(
        {
            "at": completed_at,
            "from": previous_status,
            "to": final_status,
            "actor": actor,
            "reason": reason,
        }
    )
    validation = validate_job_manifest(next_job, artifact_root=root)
    if not validation.valid:
        raise JobError(
            "Refusing to write an invalid completed job: "
            + "; ".join(f"{issue.code}: {issue.message}" for issue in validation.errors)
        )
    write_json_atomically(job_path, next_job)
    return next_job


def generated_job_id(created_at: str) -> str:
    date = parse_timestamp(created_at, "createdAt").replace("-", "").replace(":", "").replace("T", "-")[:8]
    return f"pmj-{date}-{uuid.uuid4().hex}"


def init_command(args: argparse.Namespace) -> int:
    created_at = parse_timestamp(args.created_at or utc_now(), "createdAt")
    job_id = args.job_id or generated_job_id(created_at)
    source = source_record(args.source_id, args.source_manifest)
    snapshots = reference_snapshots(args.raw_manifest, args.source_manifest)
    job = build_job_manifest(
        job_id=job_id,
        created_at=created_at,
        poet_id=args.poet_id,
        poet_name=args.poet_name,
        source_id=args.source_id,
        input_sha256=args.input_sha256,
        content_type=args.content_type,
        access_level=args.access_level,
        data_processing_consent=args.data_processing_consent,
        external_transfer_consent=args.external_transfer_consent,
        allow_external_providers=args.allow_external_providers,
        max_api_requests=args.max_api_requests,
        max_tokens=args.max_tokens,
        max_cost_cny=args.max_cost_cny,
        publication_mode=args.publication_mode,
        source=source,
        snapshots=snapshots,
        retention_expires_at=args.retention_expires_at,
        existing_person_id=args.existing_person_id,
    )
    validation = validate_job_manifest(job)
    if not validation.valid:
        print(json.dumps(validation.payload(), ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    destination = initialize_job(args.job_root, job, dry_run=args.dry_run)
    print(
        json.dumps(
            {
                "jobId": job["jobId"],
                "jobPath": str(destination),
                "dryRun": args.dry_run,
                "registrationStatus": job["input"]["registrationStatus"],
                "validation": validation.payload(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def validate_command(args: argparse.Namespace) -> int:
    job = read_json(args.job, "Job manifest")
    artifact_root: Path | None = None
    if isinstance(job, dict):
        try:
            artifact_root = job_root_for_manifest(args.job, job)
        except JobError:
            # The structural validation below remains responsible for reporting
            # malformed payloads; a standalone copied manifest has no safe job root to inspect.
            pass
    validation = validate_job_manifest(
        job,
        artifact_root=artifact_root,
        verify_current=args.verify_current,
        raw_manifest_path=args.raw_manifest,
        source_manifest_path=args.source_manifest,
    )
    output = {"job": str(args.job), **validation.payload()}
    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        for issue in output["issues"]:
            location = f" [{issue['field']}]" if issue.get("field") else ""
            print(f"{issue['severity'].upper()} {issue['code']}{location}: {issue['message']}")
        print(
            f"Poet-map job validation: {output['errorCount']} error(s), "
            f"{output['warningCount']} warning(s)."
        )
    return 0 if validation.valid else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="Create an isolated job manifest and directory.")
    init.add_argument("--poet-id", required=True, help="Stable internal poet id, e.g. li-bai.")
    init.add_argument("--poet-name", required=True, help="Display name from the upload request.")
    init.add_argument("--existing-person-id", help="Optional known person id when identity is already resolved.")
    init.add_argument("--source-id", required=True, help="Upload receipt or governed source id; never a local path.")
    init.add_argument("--input-sha256", required=True, help="SHA-256 computed by the upload intake service.")
    init.add_argument("--content-type", required=True, help="Verified upload content type, e.g. application/pdf.")
    init.add_argument("--access-level", choices=("quarantine", "private"), default="quarantine")
    init.add_argument("--data-processing-consent", action="store_true")
    init.add_argument("--external-transfer-consent", action="store_true")
    init.add_argument("--allow-external-providers", action="store_true")
    init.add_argument("--max-api-requests", type=int, default=0)
    init.add_argument("--max-tokens", type=int)
    init.add_argument("--max-cost-cny", type=float)
    init.add_argument(
        "--publication-mode",
        choices=("private-preview-only", "human-review", "policy-gated-auto"),
        default="private-preview-only",
        help="Default is a private preview; automatic public release still requires later evidence gates.",
    )
    init.add_argument("--retention-expires-at", help="Optional ISO-8601 retention deadline.")
    init.add_argument("--job-id", help="Optional reproducible job id; otherwise a new pmj id is generated.")
    init.add_argument("--created-at", help="Optional fixed ISO-8601 creation time for deterministic fixtures.")
    init.add_argument("--job-root", type=Path, default=DEFAULT_JOB_ROOT)
    init.add_argument("--raw-manifest", type=Path, default=DEFAULT_RAW_MANIFEST)
    init.add_argument("--source-manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    init.add_argument("--dry-run", action="store_true", help="Validate and print the job without writing a directory.")
    init.set_defaults(handler=init_command)

    validate = subparsers.add_parser("validate", help="Validate a job manifest.")
    validate.add_argument("--job", type=Path, required=True)
    validate.add_argument("--raw-manifest", type=Path, default=DEFAULT_RAW_MANIFEST)
    validate.add_argument("--source-manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    validate.add_argument("--verify-current", action="store_true", help="Warn when reference snapshots have changed.")
    validate.add_argument("--json", action="store_true", help="Emit a machine-readable report.")
    validate.set_defaults(handler=validate_command)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        return args.handler(args)
    except JobError as exc:
        print(f"Poet-map job error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
