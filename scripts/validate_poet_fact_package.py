#!/usr/bin/env python3
"""Validate a provenance-first poet fact package before map projection.

The validator intentionally operates on the new internal contract, not the
legacy `data/published` five-table contract. It is dependency-free so a job can
fail safely before any release adapter or frontend write is considered.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


RECORD_TYPE = "poet-fact-package"
SCHEMA_VERSION = "1.0.0"
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
JOB_ID_RE = re.compile(r"^pmj-[a-z0-9]+(?:-[a-z0-9]+){1,8}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)

ROUTE_PREDICATES = {
    "born-at",
    "died-at",
    "resided-at",
    "visited",
    "traveled-to",
    "held-office-at",
    "exiled-to",
    "studied-at",
    "stayed-at",
}
LITERARY_PREDICATES = {
    "work-composed-at",
    "work-inscribed-at",
    "work-describes-place",
    "work-mentioned-place",
}
DECISION_STATES = {
    "extracted",
    "grounded",
    "candidate",
    "needs-evidence",
    "needs-review",
    "accepted",
    "rejected",
    "released",
    "superseded",
    "withdrawn",
}
LOCATOR_KINDS = {
    "line-range",
    "page-range",
    "json-pointer",
    "record-id",
    "chapter-section",
    "named-anchor",
    "text-span",
}
ENTITY_TYPES = {"person", "place", "work", "text"}


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


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Fact package does not exist: {path}") from exc
    except UnicodeDecodeError as exc:
        raise ValueError(f"Fact package is not UTF-8: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Fact package is invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc


class FactPackageValidator:
    def __init__(self, payload: Any):
        self.payload = payload
        self.errors: list[Issue] = []
        self.warnings: list[Issue] = []
        self.evidence_ids: set[str] = set()
        self.assertion_ids: set[str] = set()
        self.poet_id: str | None = None

    def error(self, code: str, message: str, location: str | None = None) -> None:
        self.errors.append(Issue("error", code, message, location))

    def warning(self, code: str, message: str, location: str | None = None) -> None:
        self.warnings.append(Issue("warning", code, message, location))

    def validate_id(self, value: Any, location: str, label: str = "id") -> str | None:
        if not isinstance(value, str) or not 3 <= len(value) <= 160 or not ID_RE.fullmatch(value):
            self.error("id-format", f"{label} must be a lowercase kebab-case identifier.", location)
            return None
        return value

    def validate_fields(
        self,
        value: dict[str, Any],
        *,
        required: set[str],
        allowed: set[str],
        location: str,
        code_prefix: str,
        label: str,
    ) -> None:
        for field in sorted(required - set(value)):
            self.error(f"{code_prefix}-missing-field", f"{label} is missing required field {field!r}.", f"{location}.{field}")
        for field in sorted(set(value) - allowed):
            self.error(
                f"{code_prefix}-unknown-field",
                f"{label} must not include {field!r}; keep private prompts and raw text in job-local artifacts.",
                f"{location}.{field}",
            )

    def validate_timestamp(self, value: Any, location: str, code: str, label: str) -> None:
        if not isinstance(value, str) or not TIMESTAMP_RE.fullmatch(value):
            self.error(code, f"{label} must be an ISO-8601 timestamp with a timezone.", location)
            return
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            self.error(code, f"{label} must be an ISO-8601 timestamp with a timezone.", location)
            return
        if parsed.tzinfo is None:
            self.error(code, f"{label} must be an ISO-8601 timestamp with a timezone.", location)

    def validate_id_list(self, value: Any, location: str, code_prefix: str, label: str) -> None:
        if not isinstance(value, list):
            self.error(f"{code_prefix}-type", f"{label} must be an array.", location)
            return
        seen: set[str] = set()
        for index, item in enumerate(value):
            item_location = f"{location}[{index}]"
            item_id = self.validate_id(item, item_location, label)
            if item_id is not None:
                if item_id in seen:
                    self.error(f"{code_prefix}-duplicate", f"{label} values must be unique.", item_location)
                seen.add(item_id)

    def validate(self) -> Validation:
        if not isinstance(self.payload, dict):
            self.error("package-type", "Fact package must be a JSON object.")
            return Validation(False, tuple(self.errors), tuple(self.warnings))

        required = {
            "recordType",
            "schemaVersion",
            "packageId",
            "jobId",
            "createdAt",
            "poet",
            "evidence",
            "assertions",
            "reviewStatus",
        }
        allowed = required | {"editorial", "supersedes"}
        for field in sorted(required - set(self.payload)):
            self.error("package-missing-field", f"Missing required top-level field: {field}", field)
        for field in sorted(set(self.payload) - allowed):
            self.error("package-unknown-field", f"Unknown top-level field: {field}", field)

        if self.payload.get("recordType") != RECORD_TYPE:
            self.error("package-record-type", f"recordType must be {RECORD_TYPE!r}", "recordType")
        if self.payload.get("schemaVersion") != SCHEMA_VERSION:
            self.error("package-schema-version", f"schemaVersion must be {SCHEMA_VERSION!r}", "schemaVersion")
        self.validate_id(self.payload.get("packageId"), "packageId", "packageId")
        job_id = self.payload.get("jobId")
        if not isinstance(job_id, str) or not JOB_ID_RE.fullmatch(job_id):
            self.error("package-job-id", "jobId must be a valid poet-map job id.", "jobId")
        self.validate_timestamp(self.payload.get("createdAt"), "createdAt", "package-created-at", "createdAt")

        poet = self.payload.get("poet")
        if not isinstance(poet, dict):
            self.error("poet-type", "poet must be an object.", "poet")
        else:
            self.validate_fields(
                poet,
                required={"id", "name"},
                allowed={"id", "name", "externalIds"},
                location="poet",
                code_prefix="poet",
                label="Poet",
            )
            self.poet_id = self.validate_id(poet.get("id"), "poet.id", "poet.id")
            if not isinstance(poet.get("name"), str) or not poet["name"].strip():
                self.error("poet-name", "poet.name must be non-empty.", "poet.name")
            external_ids = poet.get("externalIds")
            if external_ids is not None:
                if not isinstance(external_ids, list):
                    self.error("poet-external-ids", "poet.externalIds must be an array when present.", "poet.externalIds")
                else:
                    for index, external_id in enumerate(external_ids):
                        external_location = f"poet.externalIds[{index}]"
                        if not isinstance(external_id, dict):
                            self.error("poet-external-id-type", "Each poet external id must be an object.", external_location)
                            continue
                        self.validate_fields(
                            external_id,
                            required={"scheme", "value"},
                            allowed={"scheme", "value"},
                            location=external_location,
                            code_prefix="poet-external-id",
                            label="Poet external id",
                        )
                        for field in ("scheme", "value"):
                            if not isinstance(external_id.get(field), str) or not external_id[field].strip():
                                self.error(
                                    "poet-external-id-value",
                                    f"Poet external id {field} must be non-empty.",
                                    f"{external_location}.{field}",
                                )

        self.validate_evidence(self.payload.get("evidence"))
        self.validate_assertions(self.payload.get("assertions"))
        self.validate_editorial(self.payload.get("editorial", []))
        if "supersedes" in self.payload:
            self.validate_id_list(self.payload["supersedes"], "supersedes", "package-supersedes", "supersedes")
        self.validate_package_state()
        return Validation(not self.errors, tuple(self.errors), tuple(self.warnings))

    def validate_evidence(self, evidence: Any) -> None:
        if not isinstance(evidence, list):
            self.error("evidence-type", "evidence must be an array.", "evidence")
            return
        for index, record in enumerate(evidence):
            location = f"evidence[{index}]"
            if not isinstance(record, dict):
                self.error("evidence-record-type", "Evidence must be an object.", location)
                continue
            allowed = {
                "id",
                "reference",
                "locator",
                "support",
                "visibility",
                "excerptSha256",
                "createdByJobId",
            }
            self.validate_fields(
                record,
                required={"id", "reference", "locator", "support", "visibility", "createdByJobId"},
                allowed=allowed,
                location=location,
                code_prefix="evidence",
                label="Evidence",
            )
            evidence_id = self.validate_id(record.get("id"), f"{location}.id", "evidence id")
            if evidence_id is not None:
                if evidence_id in self.evidence_ids:
                    self.error("evidence-duplicate", "Evidence ids must be unique.", f"{location}.id")
                self.evidence_ids.add(evidence_id)
            reference = record.get("reference")
            if not isinstance(reference, dict):
                self.error("evidence-reference", "Evidence requires a reference object.", f"{location}.reference")
            else:
                self.validate_fields(
                    reference,
                    required={"registry", "referenceId", "snapshotSha256"},
                    allowed={"registry", "referenceId", "snapshotSha256"},
                    location=f"{location}.reference",
                    code_prefix="evidence-reference",
                    label="Evidence reference",
                )
                if reference.get("registry") not in {
                    "source-catalog",
                    "raw-layer",
                    "job-upload",
                    "external-retrieval",
                }:
                    self.error("evidence-registry", "Evidence reference registry is not recognized.", f"{location}.reference.registry")
                self.validate_id(reference.get("referenceId"), f"{location}.reference.referenceId", "reference id")
                if not isinstance(reference.get("snapshotSha256"), str) or not SHA256_RE.fullmatch(
                    reference["snapshotSha256"]
                ):
                    self.error("evidence-snapshot", "Evidence must cite a source/dataset snapshot SHA-256.", f"{location}.reference.snapshotSha256")
            locator = record.get("locator")
            if not isinstance(locator, dict) or not isinstance(locator.get("kind"), str) or not locator["kind"].strip():
                self.error("evidence-locator", "Evidence requires a structured locator with kind.", f"{location}.locator")
            elif locator["kind"] not in LOCATOR_KINDS:
                self.error("evidence-locator-kind", "Evidence locator kind is not recognized.", f"{location}.locator.kind")
            if record.get("support") not in {"supports", "contradicts", "context"}:
                self.error("evidence-support", "Evidence support must be supports, contradicts, or context.", f"{location}.support")
            if record.get("visibility") not in {"private", "public"}:
                self.error("evidence-visibility", "Evidence visibility must be private or public.", f"{location}.visibility")
            if "excerptSha256" in record and (
                not isinstance(record["excerptSha256"], str) or not SHA256_RE.fullmatch(record["excerptSha256"])
            ):
                self.error("evidence-excerpt-digest", "excerptSha256 must be a SHA-256 digest.", f"{location}.excerptSha256")
            creator = record.get("createdByJobId")
            if not isinstance(creator, str) or not JOB_ID_RE.fullmatch(creator):
                self.error("evidence-job", "Evidence must record a valid creating job id.", f"{location}.createdByJobId")
            elif isinstance(self.payload.get("jobId"), str) and creator != self.payload["jobId"]:
                self.warning("evidence-cross-job", "Evidence was produced by another job; retain its immutable artifact reference.", f"{location}.createdByJobId")

    def validate_assertions(self, assertions: Any) -> None:
        if not isinstance(assertions, list):
            self.error("assertions-type", "assertions must be an array.", "assertions")
            return
        for index, record in enumerate(assertions):
            location = f"assertions[{index}]"
            if not isinstance(record, dict):
                self.error("assertion-record-type", "Assertion must be an object.", location)
                continue
            self.validate_fields(
                record,
                required={
                    "id",
                    "subject",
                    "predicate",
                    "object",
                    "claimClass",
                    "evidenceIds",
                    "confidence",
                    "decision",
                    "provenance",
                },
                allowed={
                    "id",
                    "subject",
                    "predicate",
                    "object",
                    "qualifiers",
                    "claimClass",
                    "evidenceIds",
                    "confidence",
                    "decision",
                    "provenance",
                    "supersedes",
                },
                location=location,
                code_prefix="assertion",
                label="Assertion",
            )
            assertion_id = self.validate_id(record.get("id"), f"{location}.id", "assertion id")
            if assertion_id is not None:
                if assertion_id in self.assertion_ids:
                    self.error("assertion-duplicate", "Assertion ids must be unique.", f"{location}.id")
                self.assertion_ids.add(assertion_id)
            predicate = record.get("predicate")
            if predicate not in ROUTE_PREDICATES | LITERARY_PREDICATES:
                self.error("assertion-predicate", "Predicate is not in the controlled vocabulary.", f"{location}.predicate")
            self.validate_entity_ref(record.get("subject"), f"{location}.subject")
            self.validate_entity_ref(record.get("object"), f"{location}.object")
            claim_class = record.get("claimClass")
            if claim_class not in {"biographical-route", "literary-place", "contextual"}:
                self.error("assertion-claim-class", "claimClass is not recognized.", f"{location}.claimClass")
            self.validate_route_semantics(record, location, predicate, claim_class)

            evidence_ids = record.get("evidenceIds")
            if not isinstance(evidence_ids, list) or not evidence_ids:
                self.error("assertion-evidence", "Every assertion needs at least one evidence id.", f"{location}.evidenceIds")
            else:
                seen_evidence_ids: set[str] = set()
                for evidence_index, evidence_id in enumerate(evidence_ids):
                    evidence_location = f"{location}.evidenceIds[{evidence_index}]"
                    parsed_evidence_id = self.validate_id(evidence_id, evidence_location, "evidence id")
                    if parsed_evidence_id is not None:
                        if parsed_evidence_id in seen_evidence_ids:
                            self.error("assertion-evidence-duplicate", "Assertion evidence ids must be unique.", evidence_location)
                        seen_evidence_ids.add(parsed_evidence_id)
                    if not isinstance(evidence_id, str) or evidence_id not in self.evidence_ids:
                        self.error("assertion-evidence-missing", "Assertion references missing evidence.", evidence_location)

            confidence = record.get("confidence")
            if not isinstance(confidence, dict):
                self.error("assertion-confidence", "Assertion requires confidence object.", f"{location}.confidence")
            else:
                self.validate_fields(
                    confidence,
                    required={"level", "score", "basis"},
                    allowed={"level", "score", "basis"},
                    location=f"{location}.confidence",
                    code_prefix="assertion-confidence",
                    label="Assertion confidence",
                )
                if confidence.get("level") not in {"low", "possible", "probable", "verified"}:
                    self.error("assertion-confidence-level", "Confidence level is not recognized.", f"{location}.confidence.level")
                score = confidence.get("score")
                if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= float(score) <= 1:
                    self.error("assertion-confidence-score", "Confidence score must be between 0 and 1.", f"{location}.confidence.score")
                if confidence.get("basis") not in {"source-only", "rule-and-source", "model-assisted", "human-reviewed"}:
                    self.error("assertion-confidence-basis", "Confidence basis is not recognized.", f"{location}.confidence.basis")

            decision = record.get("decision")
            if not isinstance(decision, dict):
                self.error("assertion-decision", "Assertion requires a recognized decision state.", f"{location}.decision")
            else:
                self.validate_fields(
                    decision,
                    required={"state", "policyId"},
                    allowed={"state", "policyId"},
                    location=f"{location}.decision",
                    code_prefix="assertion-decision",
                    label="Assertion decision",
                )
                if decision.get("state") not in DECISION_STATES:
                    self.error("assertion-decision", "Assertion requires a recognized decision state.", f"{location}.decision.state")
                self.validate_id(decision.get("policyId"), f"{location}.decision.policyId", "policy id")

            provenance = record.get("provenance")
            if not isinstance(provenance, dict):
                self.error("assertion-provenance", "Assertion requires provenance object.", f"{location}.provenance")
            else:
                self.validate_fields(
                    provenance,
                    required={"jobId", "pipelineVersion", "createdAt"},
                    allowed={"jobId", "pipelineVersion", "createdAt"},
                    location=f"{location}.provenance",
                    code_prefix="assertion-provenance",
                    label="Assertion provenance",
                )
                if provenance.get("jobId") != self.payload.get("jobId"):
                    self.error("assertion-job", "Assertion provenance.jobId must match package jobId.", f"{location}.provenance.jobId")
                elif not isinstance(provenance.get("jobId"), str) or not JOB_ID_RE.fullmatch(provenance["jobId"]):
                    self.error("assertion-job", "Assertion provenance.jobId must be a valid poet-map job id.", f"{location}.provenance.jobId")
                if not isinstance(provenance.get("pipelineVersion"), str) or not provenance["pipelineVersion"].strip():
                    self.error("assertion-pipeline", "Assertion provenance needs pipelineVersion.", f"{location}.provenance.pipelineVersion")
                self.validate_timestamp(
                    provenance.get("createdAt"),
                    f"{location}.provenance.createdAt",
                    "assertion-provenance-created-at",
                    "Assertion provenance.createdAt",
                )

            qualifiers = record.get("qualifiers")
            if qualifiers is not None and not isinstance(qualifiers, dict):
                self.error("assertion-qualifiers", "qualifiers must be an object when present.", f"{location}.qualifiers")
            elif isinstance(qualifiers, dict):
                self.validate_fields(
                    qualifiers,
                    required=set(),
                    allowed={"time", "role", "relationType"},
                    location=f"{location}.qualifiers",
                    code_prefix="assertion-qualifiers",
                    label="Assertion qualifiers",
                )
                if "time" in qualifiers:
                    self.validate_time(qualifiers["time"], f"{location}.qualifiers.time")
                for field, max_length in (("role", 300), ("relationType", 100)):
                    if field in qualifiers and (
                        not isinstance(qualifiers[field], str) or len(qualifiers[field]) > max_length
                    ):
                        self.error(
                            "assertion-qualifier-value",
                            f"Assertion qualifier {field} must be a string of at most {max_length} characters.",
                            f"{location}.qualifiers.{field}",
                        )
            if "supersedes" in record:
                self.validate_id_list(record["supersedes"], f"{location}.supersedes", "assertion-supersedes", "supersedes")

    def validate_entity_ref(self, value: Any, location: str) -> None:
        if not isinstance(value, dict):
            self.error("entity-ref-type", "Entity reference must be an object.", location)
            return
        self.validate_fields(
            value,
            required={"type", "id"},
            allowed={"type", "id", "label"},
            location=location,
            code_prefix="entity-ref",
            label="Entity reference",
        )
        if value.get("type") not in ENTITY_TYPES:
            self.error("entity-ref-kind", "Entity reference type is not recognized.", f"{location}.type")
        self.validate_id(value.get("id"), f"{location}.id", "entity reference id")
        if "label" in value and (not isinstance(value["label"], str) or len(value["label"]) > 300):
            self.error("entity-ref-label", "Entity reference label must be a string of at most 300 characters.", f"{location}.label")

    def validate_route_semantics(
        self, record: dict[str, Any], location: str, predicate: Any, claim_class: Any
    ) -> None:
        subject = record.get("subject") if isinstance(record.get("subject"), dict) else {}
        object_ = record.get("object") if isinstance(record.get("object"), dict) else {}
        if predicate in ROUTE_PREDICATES:
            if claim_class != "biographical-route":
                self.error("route-claim-class", "Biographical predicates must use claimClass=biographical-route.", f"{location}.claimClass")
            if subject.get("type") != "person" or subject.get("id") != self.poet_id:
                self.error("route-subject", "A route assertion must be about this package's poet.", f"{location}.subject")
            if object_.get("type") != "place":
                self.error("route-object", "A route assertion must point to a place.", f"{location}.object")
        elif predicate in LITERARY_PREDICATES:
            if claim_class != "literary-place":
                self.error("literary-claim-class", "Literary predicates must use claimClass=literary-place.", f"{location}.claimClass")
            if subject.get("type") != "work" or object_.get("type") != "place":
                self.error("literary-entity-kinds", "Literary-place assertions must link a work to a place.", location)

    def validate_time(self, value: Any, location: str) -> None:
        if not isinstance(value, dict):
            self.error("time-type", "Time qualifier must be an object.", location)
            return
        self.validate_fields(
            value,
            required={"precision", "label"},
            allowed={"precision", "label", "originalText", "startYear", "endYear", "sequence"},
            location=location,
            code_prefix="time",
            label="Time qualifier",
        )
        precision = value.get("precision")
        if precision not in {"year", "range", "era-only", "era-and-month", "sequence-only", "unknown"}:
            self.error("time-precision", "Time precision is not recognized.", f"{location}.precision")
            return
        if not isinstance(value.get("label"), str) or not value["label"].strip() or len(value["label"]) > 200:
            self.error("time-label", "Time qualifier needs a non-empty display label.", f"{location}.label")
        if "originalText" in value and (
            not isinstance(value["originalText"], str) or len(value["originalText"]) > 300
        ):
            self.error("time-original-text", "Time originalText must be a string of at most 300 characters.", f"{location}.originalText")
        start, end = value.get("startYear"), value.get("endYear")
        for field, year in (("startYear", start), ("endYear", end)):
            if field in value and (not isinstance(year, int) or isinstance(year, bool) or not -10000 <= year <= 3000):
                self.error("time-year", f"Time {field} must be an integer between -10000 and 3000.", f"{location}.{field}")
        if precision in {"year", "range"}:
            if (
                not isinstance(start, int)
                or isinstance(start, bool)
                or not isinstance(end, int)
                or isinstance(end, bool)
            ):
                self.error("time-year-required", "year/range precision requires startYear and endYear.", location)
            elif start > end or (precision == "year" and start != end):
                self.error("time-year-range", "Time year/range values are inconsistent.", location)
        sequence = value.get("sequence")
        sequence_is_valid = isinstance(sequence, int) and not isinstance(sequence, bool) and sequence >= 1
        if precision == "sequence-only" and not sequence_is_valid:
            self.error("time-sequence", "sequence-only precision requires a positive sequence.", f"{location}.sequence")
        elif "sequence" in value and not sequence_is_valid:
            self.error("time-sequence", "sequence must be a positive integer.", f"{location}.sequence")

    def validate_editorial(self, editorial: Any) -> None:
        if not isinstance(editorial, list):
            self.error("editorial-type", "editorial must be an array when present.", "editorial")
            return
        for index, record in enumerate(editorial):
            location = f"editorial[{index}]"
            if not isinstance(record, dict):
                self.error("editorial-record-type", "Editorial record must be an object.", location)
                continue
            self.validate_fields(
                record,
                required={"id", "kind", "basisAssertionIds", "reviewStatus"},
                allowed={"id", "kind", "basisAssertionIds", "reviewStatus"},
                location=location,
                code_prefix="editorial",
                label="Editorial record",
            )
            self.validate_id(record.get("id"), f"{location}.id", "editorial id")
            if record.get("kind") not in {"summary", "intro", "plain-explanation", "display-title"}:
                self.error("editorial-kind", "Editorial kind is not recognized.", f"{location}.kind")
            if record.get("reviewStatus") not in {"candidate", "needs-review", "accepted", "published"}:
                self.error("editorial-review-status", "Editorial reviewStatus is not recognized.", f"{location}.reviewStatus")
            basis = record.get("basisAssertionIds")
            if not isinstance(basis, list) or not basis:
                self.error("editorial-basis", "Editorial content must name its basis assertions.", f"{location}.basisAssertionIds")
            else:
                seen_basis: set[str] = set()
                for basis_index, assertion_id in enumerate(basis):
                    basis_location = f"{location}.basisAssertionIds[{basis_index}]"
                    parsed_assertion_id = self.validate_id(assertion_id, basis_location, "assertion id")
                    if parsed_assertion_id is not None:
                        if parsed_assertion_id in seen_basis:
                            self.error("editorial-basis-duplicate", "Editorial basis assertions must be unique.", basis_location)
                        seen_basis.add(parsed_assertion_id)
                    if not isinstance(assertion_id, str) or assertion_id not in self.assertion_ids:
                        self.error("editorial-basis-missing", "Editorial content references missing assertion.", basis_location)

    def validate_package_state(self) -> None:
        status = self.payload.get("reviewStatus")
        if status not in {"candidate", "needs-review", "accepted", "rejected", "published"}:
            self.error("package-review-status", "Package reviewStatus is not recognized.", "reviewStatus")
            return
        if status == "published":
            evidence = self.payload.get("evidence") if isinstance(self.payload.get("evidence"), list) else []
            private_evidence = [record for record in evidence if isinstance(record, dict) and record.get("visibility") != "public"]
            if private_evidence:
                self.error("published-private-evidence", "A published package cannot depend on private evidence.", "evidence")
            assertions = self.payload.get("assertions") if isinstance(self.payload.get("assertions"), list) else []
            for index, assertion in enumerate(assertions):
                if isinstance(assertion, dict) and assertion.get("decision", {}).get("state") != "released":
                    self.error("published-unreleased-assertion", "Published package assertions must be released.", f"assertions[{index}].decision.state")


def validate_fact_package(payload: Any) -> Validation:
    return FactPackageValidator(payload).validate()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable report.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validation = validate_fact_package(read_json(args.package))
    except ValueError as exc:
        print(f"Poet fact package error: {exc}", file=sys.stderr)
        return 1
    payload = {"package": str(args.package), **validation.payload()}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in payload["issues"]:
            location = f" [{issue['location']}]" if issue.get("location") else ""
            print(f"{issue['severity'].upper()} {issue['code']}{location}: {issue['message']}")
        print(f"Poet fact package validation: {payload['errorCount']} error(s), {payload['warningCount']} warning(s).")
    return 0 if validation.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
