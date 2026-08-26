#!/usr/bin/env python3
"""Validate a job-local private projection for journey, poem-world and social candidates.

The validator checks a display contract only.  Passing validation never turns a
candidate, a story card, or a relationship edge into a released historical
fact, and it never writes public data.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from build_book_package_manifest import validate_book_package_manifest


RECORD_TYPE = "private-poet-volume-bundle"
SCHEMA_VERSION = "1.0.0"
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
JOB_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,12}$")
BUNDLE_ID_RE = re.compile(r"^ppvb-[a-z0-9]+(?:-[a-z0-9]+){1,12}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PRIVATE_REVIEW_STATES = frozenset(
    {"candidate-preview", "needs-review", "approved-private-preview", "rejected"}
)
VOLUME_STATES = frozenset({"ready", "empty", "not-run", "blocked"})
ROUTE_PREDICATES = frozenset(
    {
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
)
LITERARY_RELATION_TYPES = frozenset(
    {"work-composed-at", "work-inscribed-at", "work-describes-place", "work-mentioned-place"}
)
SOCIAL_BUCKETS = frozenset({"kin", "literary-exchange", "official", "teacher-student", "friendship", "other"})
LOCATOR_KINDS = frozenset({"text-span", "page-range", "chapter-section", "named-anchor"})
REVIEW_RANK = {"candidate-preview": 1, "needs-review": 2, "approved-private-preview": 3}


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


def _parse_timestamp(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


class BundleValidator:
    def __init__(self, payload: Any, source_manifest: Any) -> None:
        self.payload = payload
        self.source_manifest = source_manifest
        self.errors: list[Issue] = []
        self.warnings: list[Issue] = []
        self.job_id: str | None = None
        self.source_file_ids: set[str] = set()
        self.evidence: dict[str, dict[str, Any]] = {}
        self.people: dict[str, dict[str, Any]] = {}
        self.places: dict[str, dict[str, Any]] = {}
        self.works: dict[str, dict[str, Any]] = {}
        self.edges: dict[str, dict[str, Any]] = {}
        self.content_ids: set[str] = set()

    def error(self, code: str, message: str, location: str | None = None) -> None:
        self.errors.append(Issue("error", code, message, location))

    def fields(
        self,
        value: Any,
        *,
        required: set[str],
        allowed: set[str],
        location: str,
        prefix: str,
        label: str,
    ) -> dict[str, Any] | None:
        if not isinstance(value, dict):
            self.error(f"{prefix}-type", f"{label} must be an object.", location)
            return None
        for field in sorted(set(value) - allowed):
            self.error(f"{prefix}-unknown-field", f"Unknown {label} field: {field}", f"{location}.{field}")
        for field in sorted(required - set(value)):
            self.error(f"{prefix}-missing-field", f"{label}.{field} is required.", f"{location}.{field}")
        return value

    def identifier(self, value: Any, location: str, label: str) -> str | None:
        if not isinstance(value, str) or not ID_RE.fullmatch(value):
            self.error("identifier", f"{label} must be a lowercase kebab-case identifier.", location)
            return None
        return value

    def sha256(self, value: Any, location: str, label: str) -> str | None:
        if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
            self.error("sha256", f"{label} must be a lowercase SHA-256 digest.", location)
            return None
        return value

    def text(self, value: Any, location: str, label: str, max_length: int) -> str | None:
        if not isinstance(value, str) or not value.strip() or len(value) > max_length:
            self.error("text", f"{label} must be a non-empty string up to {max_length} characters.", location)
            return None
        return value

    def register_content_id(self, value: Any, location: str, label: str) -> str | None:
        identifier = self.identifier(value, location, label)
        if identifier is None:
            return None
        if identifier in self.content_ids:
            self.error("content-id-duplicate", "Bundle entity and item ids must be globally unique.", location)
        else:
            self.content_ids.add(identifier)
        return identifier

    def evidence_ids(
        self,
        value: Any,
        location: str,
        *,
        require_direct: bool = True,
        nonempty: bool = True,
    ) -> list[str]:
        if not isinstance(value, list) or (nonempty and not value):
            self.error("evidence-ids", "evidenceIds must be a non-empty array.", location)
            return []
        parsed: list[str] = []
        seen: set[str] = set()
        for index, evidence_id in enumerate(value):
            item_location = f"{location}[{index}]"
            parsed_id = self.identifier(evidence_id, item_location, "evidence id")
            if parsed_id is None:
                continue
            if parsed_id in seen:
                self.error("evidence-id-duplicate", "evidenceIds must be unique.", item_location)
            seen.add(parsed_id)
            if parsed_id not in self.evidence:
                self.error("evidence-id-missing", "evidenceIds references missing evidence.", item_location)
            parsed.append(parsed_id)
        if require_direct and parsed:
            if not any(self.evidence.get(evidence_id, {}).get("support") == "direct" for evidence_id in parsed):
                self.error("evidence-direct-required", "Visible candidates require at least one direct evidence item.", location)
        return parsed

    def validate_source_manifest(self) -> None:
        validation = validate_book_package_manifest(self.source_manifest)
        if not validation.valid:
            for issue in validation.errors:
                self.error("source-manifest-invalid", f"Source manifest: {issue.message}", f"sourceManifest.{issue.location or 'root'}")
            return
        members = self.source_manifest.get("members", [])
        self.source_file_ids = {
            member["id"] for member in members if isinstance(member, dict) and isinstance(member.get("id"), str)
        }

    def validate_top_level(self) -> bool:
        if not isinstance(self.payload, dict):
            self.error("bundle-type", "Private volume bundle must be a JSON object.")
            return False
        required = {
            "recordType", "schemaVersion", "bundleId", "jobId", "createdAt", "access", "reviewState", "source",
            "poet", "evidence", "entities", "volumes", "limitations",
        }
        for field in sorted(set(self.payload) - required):
            self.error("bundle-unknown-field", f"Unknown top-level field: {field}", field)
        for field in sorted(required - set(self.payload)):
            self.error("bundle-missing-field", f"Missing required top-level field: {field}", field)
        if self.payload.get("recordType") != RECORD_TYPE:
            self.error("bundle-record-type", f"recordType must be {RECORD_TYPE!r}.", "recordType")
        if self.payload.get("schemaVersion") != SCHEMA_VERSION:
            self.error("bundle-schema-version", f"schemaVersion must be {SCHEMA_VERSION!r}.", "schemaVersion")
        bundle_id = self.payload.get("bundleId")
        if not isinstance(bundle_id, str) or not BUNDLE_ID_RE.fullmatch(bundle_id):
            self.error("bundle-id", "bundleId must be a ppvb- identifier.", "bundleId")
        job_id = self.payload.get("jobId")
        if not isinstance(job_id, str) or not JOB_ID_RE.fullmatch(job_id):
            self.error("bundle-job-id", "jobId must be a lowercase kebab-case job identifier.", "jobId")
        else:
            self.job_id = job_id
        created_at = self.payload.get("createdAt")
        if not isinstance(created_at, str) or not _parse_timestamp(created_at):
            self.error("bundle-created-at", "createdAt must be a timezone-aware ISO-8601 timestamp.", "createdAt")
        return True

    def validate_access(self) -> None:
        access = self.fields(
            self.payload.get("access"), required={"visibility", "publicationState"}, allowed={"visibility", "publicationState"},
            location="access", prefix="access", label="access",
        )
        if access is None:
            return
        if access.get("visibility") != "private":
            self.error("access-visibility", "Private candidate bundles must use visibility=private.", "access.visibility")
        if access.get("publicationState") != "not-submitted":
            self.error("access-publication-state", "Private candidate bundles must use publicationState=not-submitted.", "access.publicationState")
        if self.payload.get("reviewState") not in PRIVATE_REVIEW_STATES:
            self.error("bundle-review-state", "reviewState is not a private candidate state.", "reviewState")

    def validate_source(self) -> None:
        source = self.fields(
            self.payload.get("source"), required={"bookId", "bookTitle", "packageId", "packageSha256", "packageOwnerJobId"},
            allowed={"bookId", "bookTitle", "packageId", "packageSha256", "packageOwnerJobId"}, location="source", prefix="source", label="source",
        )
        if source is None:
            return
        self.identifier(source.get("bookId"), "source.bookId", "source book id")
        self.text(source.get("bookTitle"), "source.bookTitle", "source book title", 300)
        package_id = source.get("packageId")
        if not isinstance(package_id, str) or not package_id.startswith("bpm-") or not ID_RE.fullmatch(package_id):
            self.error("source-package-id", "source.packageId must be a bpm- identifier.", "source.packageId")
        self.sha256(source.get("packageSha256"), "source.packageSha256", "source package SHA-256")
        owner_job_id = source.get("packageOwnerJobId")
        if not isinstance(owner_job_id, str) or not JOB_ID_RE.fullmatch(owner_job_id):
            self.error("source-package-owner-job", "source.packageOwnerJobId must be a lowercase kebab-case job identifier.", "source.packageOwnerJobId")
        if not isinstance(self.source_manifest, dict):
            return
        manifest_book = self.source_manifest.get("book")
        if isinstance(manifest_book, dict):
            if source.get("bookId") != manifest_book.get("id"):
                self.error("source-book-id-mismatch", "source.bookId must match the source manifest.", "source.bookId")
            if source.get("bookTitle") != manifest_book.get("title"):
                self.error("source-book-title-mismatch", "source.bookTitle must match the source manifest.", "source.bookTitle")
        if source.get("packageId") != self.source_manifest.get("packageId"):
            self.error("source-package-id-mismatch", "source.packageId must match the source manifest.", "source.packageId")
        if source.get("packageSha256") != self.source_manifest.get("packageSha256"):
            self.error("source-package-sha-mismatch", "source.packageSha256 must match the source manifest.", "source.packageSha256")
        if source.get("packageOwnerJobId") != self.source_manifest.get("jobId"):
            self.error("source-owner-job-mismatch", "source.packageOwnerJobId must match the source manifest jobId.", "source.packageOwnerJobId")

    def validate_poet(self) -> str | None:
        poet = self.fields(
            self.payload.get("poet"), required={"id", "name", "identityState"}, allowed={"id", "name", "identityState", "externalIds"},
            location="poet", prefix="poet", label="poet",
        )
        if poet is None:
            return None
        poet_id = self.identifier(poet.get("id"), "poet.id", "poet id")
        self.text(poet.get("name"), "poet.name", "poet name", 200)
        if poet.get("identityState") not in {"resolved", "candidate", "ambiguous"}:
            self.error("poet-identity-state", "poet.identityState is not recognized.", "poet.identityState")
        self.validate_external_ids(poet.get("externalIds"), "poet.externalIds")
        return poet_id

    def validate_external_ids(self, value: Any, location: str) -> None:
        if value is None:
            return
        if not isinstance(value, list):
            self.error("external-ids", "externalIds must be an array when present.", location)
            return
        seen: set[tuple[str, str]] = set()
        for index, record in enumerate(value):
            record_location = f"{location}[{index}]"
            checked = self.fields(
                record, required={"scheme", "value"}, allowed={"scheme", "value"}, location=record_location,
                prefix="external-id", label="External id",
            )
            if checked is None:
                continue
            scheme = self.text(checked.get("scheme"), f"{record_location}.scheme", "External id scheme", 50)
            external_value = self.text(checked.get("value"), f"{record_location}.value", "External id value", 200)
            if scheme is not None and external_value is not None:
                key = (scheme, external_value)
                if key in seen:
                    self.error("external-id-duplicate", "externalIds must be unique.", record_location)
                seen.add(key)

    def validate_locator(self, value: Any, location: str) -> None:
        locator = self.fields(
            value,
            required={"kind"},
            allowed={"kind", "startOffset", "endOffset", "startPage", "endPage", "label", "anchor"},
            location=location,
            prefix="locator",
            label="locator",
        )
        if locator is None:
            return
        kind = locator.get("kind")
        if kind not in LOCATOR_KINDS:
            self.error("locator-kind", "locator.kind is not recognized.", f"{location}.kind")
            return
        if kind == "text-span":
            self._validate_pair(locator, location, "startOffset", "endOffset", 0)
            self._forbid(locator, location, {"startPage", "endPage", "anchor"})
        elif kind == "page-range":
            self._validate_pair(locator, location, "startPage", "endPage", 1)
            self._forbid(locator, location, {"startOffset", "endOffset", "anchor"})
        elif kind == "chapter-section":
            self.text(locator.get("label"), f"{location}.label", "chapter-section label", 300)
            self._forbid(locator, location, {"startOffset", "endOffset", "startPage", "endPage", "anchor"})
        elif kind == "named-anchor":
            self.text(locator.get("anchor"), f"{location}.anchor", "named-anchor anchor", 300)
            self._forbid(locator, location, {"startOffset", "endOffset", "startPage", "endPage"})

    def _validate_pair(self, value: dict[str, Any], location: str, start_name: str, end_name: str, minimum: int) -> None:
        start, end = value.get(start_name), value.get(end_name)
        if not _is_integer(start) or start < minimum:
            self.error("locator-range-start", f"{start_name} must be an integer of at least {minimum}.", f"{location}.{start_name}")
        if not _is_integer(end) or end < minimum + 1:
            self.error("locator-range-end", f"{end_name} must be an integer above {minimum}.", f"{location}.{end_name}")
        if _is_integer(start) and _is_integer(end) and start >= end:
            self.error("locator-range-order", f"{start_name} must be smaller than {end_name}.", location)

    def _forbid(self, value: dict[str, Any], location: str, fields: set[str]) -> None:
        for field in sorted(fields & set(value)):
            self.error("locator-field-not-applicable", f"{field} is not applicable to this locator kind.", f"{location}.{field}")

    def validate_evidence(self) -> None:
        evidence = self.payload.get("evidence")
        if not isinstance(evidence, list):
            self.error("evidence-type", "evidence must be an array.", "evidence")
            return
        for index, record in enumerate(evidence):
            location = f"evidence[{index}]"
            checked = self.fields(
                record,
                required={"id", "sourceFileId", "locator", "support", "excerptSha256", "createdByJobId"},
                allowed={"id", "sourceFileId", "locator", "support", "excerptSha256", "createdByJobId"},
                location=location,
                prefix="evidence",
                label="Evidence",
            )
            if checked is None:
                continue
            evidence_id = self.identifier(checked.get("id"), f"{location}.id", "evidence id")
            if evidence_id is not None:
                if evidence_id in self.evidence:
                    self.error("evidence-id-duplicate", "Evidence ids must be unique.", f"{location}.id")
                else:
                    self.evidence[evidence_id] = checked
            source_file_id = self.identifier(checked.get("sourceFileId"), f"{location}.sourceFileId", "source file id")
            if source_file_id is not None and self.source_file_ids and source_file_id not in self.source_file_ids:
                self.error("evidence-source-file-missing", "Evidence references a file absent from the source manifest.", f"{location}.sourceFileId")
            self.validate_locator(checked.get("locator"), f"{location}.locator")
            if checked.get("support") not in {"direct", "context", "contradicts"}:
                self.error("evidence-support", "Evidence support is not recognized.", f"{location}.support")
            self.sha256(checked.get("excerptSha256"), f"{location}.excerptSha256", "Evidence excerpt SHA-256")
            if checked.get("createdByJobId") != self.job_id:
                self.error("evidence-job", "Evidence createdByJobId must match bundle jobId.", f"{location}.createdByJobId")

    def validate_entity_evidence(self, record: dict[str, Any], location: str) -> None:
        self.evidence_ids(record.get("evidenceIds"), f"{location}.evidenceIds")

    def validate_entities(self, poet_id: str | None) -> None:
        entities = self.fields(
            self.payload.get("entities"), required={"people", "places", "works"}, allowed={"people", "places", "works"},
            location="entities", prefix="entities", label="entities",
        )
        if entities is None:
            return
        people = entities.get("people")
        if not isinstance(people, list):
            self.error("people-type", "entities.people must be an array.", "entities.people")
        else:
            for index, record in enumerate(people):
                location = f"entities.people[{index}]"
                checked = self.fields(
                    record, required={"id", "name", "resolutionState", "evidenceIds"},
                    allowed={"id", "name", "resolutionState", "externalIds", "evidenceIds"}, location=location,
                    prefix="person", label="Person",
                )
                if checked is None:
                    continue
                person_id = self.register_content_id(checked.get("id"), f"{location}.id", "person id")
                if person_id == poet_id:
                    self.error("person-central-poet-duplicate", "The central poet must not be duplicated in entities.people.", f"{location}.id")
                elif person_id is not None:
                    self.people[person_id] = checked
                self.text(checked.get("name"), f"{location}.name", "Person name", 200)
                if checked.get("resolutionState") not in {"resolved", "candidate", "ambiguous"}:
                    self.error("person-resolution-state", "Person resolutionState is not recognized.", f"{location}.resolutionState")
                self.validate_external_ids(checked.get("externalIds"), f"{location}.externalIds")
                self.validate_entity_evidence(checked, location)

        places = entities.get("places")
        if not isinstance(places, list):
            self.error("places-type", "entities.places must be an array.", "entities.places")
        else:
            for index, record in enumerate(places):
                location = f"entities.places[{index}]"
                checked = self.fields(
                    record, required={"id", "label", "resolutionState", "mapKind", "evidenceIds"},
                    allowed={"id", "label", "resolutionState", "mapKind", "evidenceIds"}, location=location,
                    prefix="place", label="Place",
                )
                if checked is None:
                    continue
                place_id = self.register_content_id(checked.get("id"), f"{location}.id", "place id")
                if place_id is not None:
                    self.places[place_id] = checked
                self.text(checked.get("label"), f"{location}.label", "Place label", 200)
                state = checked.get("resolutionState")
                if state not in {"resolved", "candidate", "ambiguous", "unresolved"}:
                    self.error("place-resolution-state", "Place resolutionState is not recognized.", f"{location}.resolutionState")
                map_kind = checked.get("mapKind")
                if map_kind not in {"point", "region", "none"}:
                    self.error("place-map-kind", "Place mapKind is not recognized.", f"{location}.mapKind")
                elif state != "resolved" and map_kind != "none":
                    self.error("place-unresolved-map", "Unresolved places must use mapKind=none.", f"{location}.mapKind")
                self.validate_entity_evidence(checked, location)

        works = entities.get("works")
        if not isinstance(works, list):
            self.error("works-type", "entities.works must be an array.", "entities.works")
        else:
            for index, record in enumerate(works):
                location = f"entities.works[{index}]"
                checked = self.fields(
                    record, required={"id", "title", "discoveryState", "evidenceIds"},
                    allowed={"id", "title", "genre", "discoveryState", "evidenceIds"}, location=location,
                    prefix="work", label="Work",
                )
                if checked is None:
                    continue
                work_id = self.register_content_id(checked.get("id"), f"{location}.id", "work id")
                if work_id is not None:
                    self.works[work_id] = checked
                self.text(checked.get("title"), f"{location}.title", "Work title", 300)
                if "genre" in checked:
                    self.text(checked.get("genre"), f"{location}.genre", "Work genre", 100)
                if checked.get("discoveryState") not in {"matched", "extracted-title", "candidate"}:
                    self.error("work-discovery-state", "Work discoveryState is not recognized.", f"{location}.discoveryState")
                self.validate_entity_evidence(checked, location)

    def validate_limitations(self, value: Any, location: str) -> None:
        if not isinstance(value, list):
            self.error("limitations-type", "limitations must be an array.", location)
            return
        seen: set[str] = set()
        for index, item in enumerate(value):
            item_location = f"{location}[{index}]"
            parsed = self.text(item, item_location, "Limitation", 500)
            if parsed is not None:
                if parsed in seen:
                    self.error("limitations-duplicate", "limitations must be unique.", item_location)
                seen.add(parsed)

    def validate_volume_base(self, value: Any, location: str, *, item_field: str, extra_required: set[str], extra_allowed: set[str]) -> dict[str, Any] | None:
        required = {"state", "limitations", item_field} | extra_required
        allowed = required | {"reason"} | extra_allowed
        volume = self.fields(value, required=required, allowed=allowed, location=location, prefix="volume", label="Volume")
        if volume is None:
            return None
        state = volume.get("state")
        if state not in VOLUME_STATES:
            self.error("volume-state", "Volume state is not recognized.", f"{location}.state")
        if state in {"not-run", "blocked"}:
            self.text(volume.get("reason"), f"{location}.reason", "Volume reason", 500)
        elif "reason" in volume:
            self.text(volume.get("reason"), f"{location}.reason", "Volume reason", 500)
        self.validate_limitations(volume.get("limitations"), f"{location}.limitations")
        items = volume.get(item_field)
        if not isinstance(items, list):
            self.error("volume-items-type", f"{item_field} must be an array.", f"{location}.{item_field}")
        elif state == "ready" and not items:
            self.error("volume-ready-empty", "A ready volume must have at least one item.", f"{location}.{item_field}")
        elif state in {"empty", "not-run", "blocked"} and items:
            self.error("volume-nonready-items", "empty, not-run and blocked volumes must not contain items.", f"{location}.{item_field}")
        return volume

    def validate_time(self, value: Any, location: str) -> None:
        checked = self.fields(
            value, required={"precision", "label"}, allowed={"precision", "label", "startYear", "endYear"},
            location=location, prefix="time", label="Time",
        )
        if checked is None:
            return
        precision = checked.get("precision")
        if precision not in {"year", "range", "sequence-only", "unknown"}:
            self.error("time-precision", "Time precision is not recognized.", f"{location}.precision")
            return
        self.text(checked.get("label"), f"{location}.label", "Time label", 200)
        start, end = checked.get("startYear"), checked.get("endYear")
        if precision in {"year", "range"}:
            for field, value_ in (("startYear", start), ("endYear", end)):
                if not _is_integer(value_) or not -10000 <= value_ <= 3000:
                    self.error("time-year", f"{field} must be an integer between -10000 and 3000.", f"{location}.{field}")
            if _is_integer(start) and _is_integer(end):
                if start > end or (precision == "year" and start != end):
                    self.error("time-year-range", "Time year values are inconsistent.", location)
        elif "startYear" in checked or "endYear" in checked:
            self.error("time-year-not-applicable", "Only year/range precision may have startYear or endYear.", location)

    def validate_review_state(self, value: Any, location: str) -> None:
        if value not in PRIVATE_REVIEW_STATES:
            self.error("candidate-review-state", "reviewState must be a private candidate state.", location)

    def validate_journey(self) -> None:
        volume = self.validate_volume_base(
            self.payload.get("volumes", {}).get("journey") if isinstance(self.payload.get("volumes"), dict) else None,
            "volumes.journey", item_field="items", extra_required={"routeSemantics"}, extra_allowed=set(),
        )
        if volume is None:
            return
        if volume.get("routeSemantics") != "narrative-sequence-not-exact-route":
            self.error("journey-route-semantics", "Journey routeSemantics is not recognized.", "volumes.journey.routeSemantics")
        items = volume.get("items")
        if not isinstance(items, list):
            return
        for index, record in enumerate(items):
            location = f"volumes.journey.items[{index}]"
            checked = self.fields(
                record,
                required={"id", "placeId", "predicate", "sequence", "mapEligible", "evidenceIds", "reviewState"},
                allowed={"id", "placeId", "predicate", "sequence", "time", "mapEligible", "evidenceIds", "reviewState"},
                location=location, prefix="journey-item", label="Journey item",
            )
            if checked is None:
                continue
            self.register_content_id(checked.get("id"), f"{location}.id", "journey item id")
            place_id = self.identifier(checked.get("placeId"), f"{location}.placeId", "place id")
            if place_id is not None and place_id not in self.places:
                self.error("journey-place-missing", "Journey item references a missing place.", f"{location}.placeId")
            if checked.get("predicate") not in ROUTE_PREDICATES:
                self.error("journey-predicate", "Journey predicate is not in the controlled vocabulary.", f"{location}.predicate")
            if not _is_integer(checked.get("sequence")) or checked["sequence"] < 1:
                self.error("journey-sequence", "Journey sequence must be a positive integer.", f"{location}.sequence")
            if "time" in checked:
                self.validate_time(checked.get("time"), f"{location}.time")
            if not isinstance(checked.get("mapEligible"), bool):
                self.error("journey-map-eligible", "mapEligible must be boolean.", f"{location}.mapEligible")
            elif checked["mapEligible"] and place_id is not None:
                place = self.places.get(place_id, {})
                if place.get("resolutionState") != "resolved" or place.get("mapKind") == "none":
                    self.error("journey-map-place", "mapEligible journey items require a resolved mappable place.", f"{location}.mapEligible")
            self.evidence_ids(checked.get("evidenceIds"), f"{location}.evidenceIds")
            self.validate_review_state(checked.get("reviewState"), f"{location}.reviewState")

    def validate_poem_world(self) -> None:
        volume = self.validate_volume_base(
            self.payload.get("volumes", {}).get("poemWorld") if isinstance(self.payload.get("volumes"), dict) else None,
            "volumes.poemWorld", item_field="items", extra_required=set(), extra_allowed=set(),
        )
        if volume is None:
            return
        items = volume.get("items")
        if not isinstance(items, list):
            return
        for index, record in enumerate(items):
            location = f"volumes.poemWorld.items[{index}]"
            checked = self.fields(
                record, required={"id", "kind", "workId", "evidenceIds", "reviewState"},
                allowed={"id", "kind", "workId", "placeId", "relationType", "sceneLabel", "evidenceIds", "reviewState"},
                location=location, prefix="poem-item", label="Poem-world item",
            )
            if checked is None:
                continue
            self.register_content_id(checked.get("id"), f"{location}.id", "Poem-world item id")
            kind = checked.get("kind")
            if kind not in {"place-link", "scene-note"}:
                self.error("poem-kind", "Poem-world item kind is not recognized.", f"{location}.kind")
            work_id = self.identifier(checked.get("workId"), f"{location}.workId", "work id")
            if work_id is not None and work_id not in self.works:
                self.error("poem-work-missing", "Poem-world item references a missing work.", f"{location}.workId")
            if kind == "place-link":
                place_id = self.identifier(checked.get("placeId"), f"{location}.placeId", "place id")
                if place_id is not None and place_id not in self.places:
                    self.error("poem-place-missing", "Place-link references a missing place.", f"{location}.placeId")
                if checked.get("relationType") not in LITERARY_RELATION_TYPES:
                    self.error("poem-relation-type", "Place-link relationType is not in the controlled vocabulary.", f"{location}.relationType")
                if "sceneLabel" in checked:
                    self.error("poem-scene-label-not-applicable", "place-link must not include sceneLabel.", f"{location}.sceneLabel")
            elif kind == "scene-note":
                self.text(checked.get("sceneLabel"), f"{location}.sceneLabel", "Scene label", 200)
                for field in ("placeId", "relationType"):
                    if field in checked:
                        self.error("poem-place-field-not-applicable", f"scene-note must not include {field}.", f"{location}.{field}")
            self.evidence_ids(checked.get("evidenceIds"), f"{location}.evidenceIds")
            self.validate_review_state(checked.get("reviewState"), f"{location}.reviewState")

    def validate_social(self, poet_id: str | None) -> None:
        volume = self.validate_volume_base(
            self.payload.get("volumes", {}).get("social") if isinstance(self.payload.get("volumes"), dict) else None,
            "volumes.social", item_field="edges", extra_required={"storyCards"}, extra_allowed=set(),
        )
        if volume is None:
            return
        edges = volume.get("edges")
        if isinstance(edges, list):
            for index, record in enumerate(edges):
                location = f"volumes.social.edges[{index}]"
                checked = self.fields(
                    record,
                    required={"id", "sourcePersonId", "targetPersonId", "displayBuckets", "evidenceIds", "reviewState"},
                    allowed={"id", "sourcePersonId", "targetPersonId", "displayBuckets", "time", "evidenceIds", "reviewState"},
                    location=location, prefix="social-edge", label="Social edge",
                )
                if checked is None:
                    continue
                edge_id = self.register_content_id(checked.get("id"), f"{location}.id", "social edge id")
                if edge_id is not None:
                    self.edges[edge_id] = checked
                source_person_id = self.identifier(checked.get("sourcePersonId"), f"{location}.sourcePersonId", "source person id")
                target_person_id = self.identifier(checked.get("targetPersonId"), f"{location}.targetPersonId", "target person id")
                valid_people = set(self.people)
                if poet_id is not None:
                    valid_people.add(poet_id)
                for person_id, field in ((source_person_id, "sourcePersonId"), (target_person_id, "targetPersonId")):
                    if person_id is not None and person_id not in valid_people:
                        self.error("social-person-missing", "Social edge references a missing person.", f"{location}.{field}")
                if source_person_id is not None and source_person_id == target_person_id:
                    self.error("social-self-edge", "A social edge must connect two different people.", location)
                buckets = checked.get("displayBuckets")
                if not isinstance(buckets, list) or not buckets:
                    self.error("social-buckets", "displayBuckets must be a non-empty array.", f"{location}.displayBuckets")
                else:
                    parsed_buckets: list[str] = []
                    for bucket_index, bucket in enumerate(buckets):
                        if bucket not in SOCIAL_BUCKETS:
                            self.error("social-bucket", "displayBuckets contains an unknown bucket.", f"{location}.displayBuckets[{bucket_index}]")
                        else:
                            parsed_buckets.append(bucket)
                    if len(parsed_buckets) != len(set(parsed_buckets)):
                        self.error("social-bucket-duplicate", "displayBuckets must be unique.", f"{location}.displayBuckets")
                if "time" in checked:
                    self.validate_time(checked.get("time"), f"{location}.time")
                self.evidence_ids(checked.get("evidenceIds"), f"{location}.evidenceIds")
                self.validate_review_state(checked.get("reviewState"), f"{location}.reviewState")

        story_cards = volume.get("storyCards")
        if not isinstance(story_cards, list):
            self.error("social-story-cards", "storyCards must be an array.", "volumes.social.storyCards")
            return
        if volume.get("state") in {"empty", "not-run", "blocked"} and story_cards:
            self.error("social-nonready-stories", "Non-ready social volumes must not contain storyCards.", "volumes.social.storyCards")
        for index, record in enumerate(story_cards):
            location = f"volumes.social.storyCards[{index}]"
            checked = self.fields(
                record,
                required={"id", "edgeId", "kind", "title", "summary", "evidenceIds", "reviewState", "disclaimerCode"},
                allowed={"id", "edgeId", "kind", "title", "summary", "evidenceIds", "reviewState", "disclaimerCode"},
                location=location, prefix="story-card", label="Story card",
            )
            if checked is None:
                continue
            self.register_content_id(checked.get("id"), f"{location}.id", "story card id")
            edge_id = self.identifier(checked.get("edgeId"), f"{location}.edgeId", "edge id")
            edge = self.edges.get(edge_id) if edge_id is not None else None
            if edge is None:
                self.error("story-edge-missing", "Story card must reference an existing social edge.", f"{location}.edgeId")
            if checked.get("kind") != "source-bound-reading-note":
                self.error("story-kind", "Story cards must be source-bound reading notes.", f"{location}.kind")
            self.text(checked.get("title"), f"{location}.title", "Story title", 200)
            self.text(checked.get("summary"), f"{location}.summary", "Story summary", 800)
            evidence_ids = self.evidence_ids(checked.get("evidenceIds"), f"{location}.evidenceIds")
            if edge is not None:
                edge_evidence = edge.get("evidenceIds") if isinstance(edge.get("evidenceIds"), list) else []
                for evidence_id in evidence_ids:
                    if evidence_id not in edge_evidence:
                        self.error("story-evidence-outside-edge", "Story evidenceIds must be a subset of its edge evidenceIds.", f"{location}.evidenceIds")
                self._validate_story_review_state(checked.get("reviewState"), edge.get("reviewState"), f"{location}.reviewState")
            else:
                self.validate_review_state(checked.get("reviewState"), f"{location}.reviewState")
            if checked.get("disclaimerCode") != "not-independent-historical-fact":
                self.error("story-disclaimer", "Story cards must state that they are not independent historical facts.", f"{location}.disclaimerCode")

    def _validate_story_review_state(self, story_state: Any, edge_state: Any, location: str) -> None:
        self.validate_review_state(story_state, location)
        if story_state not in PRIVATE_REVIEW_STATES or edge_state not in PRIVATE_REVIEW_STATES:
            return
        if edge_state == "rejected" and story_state != "rejected":
            self.error("story-rejected-edge", "A story card on a rejected edge must also be rejected.", location)
        elif story_state != "rejected" and edge_state != "rejected":
            if REVIEW_RANK[story_state] > REVIEW_RANK[edge_state]:
                self.error("story-review-ahead-of-edge", "A story card cannot be reviewed ahead of its edge.", location)

    def validate_volumes(self, poet_id: str | None) -> None:
        volumes = self.fields(
            self.payload.get("volumes"), required={"journey", "poemWorld", "social"}, allowed={"journey", "poemWorld", "social"},
            location="volumes", prefix="volumes", label="volumes",
        )
        if volumes is None:
            return
        self.validate_journey()
        self.validate_poem_world()
        self.validate_social(poet_id)

    def validate(self) -> Validation:
        if not self.validate_top_level():
            return Validation(False, tuple(self.errors), tuple(self.warnings))
        self.validate_source_manifest()
        self.validate_access()
        self.validate_source()
        poet_id = self.validate_poet()
        self.validate_evidence()
        self.validate_entities(poet_id)
        self.validate_volumes(poet_id)
        self.validate_limitations(self.payload.get("limitations"), "limitations")
        return Validation(not self.errors, tuple(self.errors), tuple(self.warnings))


def validate_private_volume_bundle(payload: Any, source_manifest: Any) -> Validation:
    """Validate a private display bundle and its referenced book-package manifest."""
    return BundleValidator(payload, source_manifest).validate()


def read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"{label} does not exist: {path}") from exc
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label} is not UTF-8: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable report.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validation = validate_private_volume_bundle(
            read_json(args.bundle, "Private volume bundle"),
            read_json(args.source_manifest, "Source manifest"),
        )
    except ValueError as exc:
        print(f"Private volume bundle error: {exc}", file=sys.stderr)
        return 1
    payload = {"bundle": str(args.bundle), "sourceManifest": str(args.source_manifest), **validation.payload()}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in payload["issues"]:
            location = f" [{issue['location']}]" if issue.get("location") else ""
            print(f"{issue['severity'].upper()} {issue['code']}{location}: {issue['message']}")
        print(f"Private volume bundle validation: {payload['errorCount']} error(s), {payload['warningCount']} warning(s).")
    return 0 if validation.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
