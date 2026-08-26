#!/usr/bin/env python3
"""Validate canonical, publicly publishable knowledge-graph JSON data.

The raw-source catalogue answers whether material may be extracted.  This
validator is the next gate: it verifies that a curated data package is safe to
publish to the website.  It deliberately has no third-party dependencies so
it can run in CI before the web application is built.

The canonical package lives in ``data/published`` and contains exactly five
JSON arrays: people, places, events, works, and sources.  Only a package that
passes this validator may be copied into ``web/public/data``.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import Any

try:
    from .source_catalog import SourceCatalogError, load_approved_sources
except ImportError:  # Direct execution: python scripts/validate_published_data.py
    from source_catalog import SourceCatalogError, load_approved_sources


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data" / "published"
DEFAULT_SOURCE_MANIFEST = PROJECT_ROOT / "source-materials" / "source-manifest.json"
DATASET_NAMES = ("people", "places", "events", "works", "sources")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

SOURCE_FIELDS = {
    "id",
    "title",
    "sourceType",
    "sourceUrl",
    "version",
    "license",
    "licenseUrl",
    "attribution",
    "reviewStatus",
}
PEOPLE_FIELDS = {
    "id",
    "name",
    "aliases",
    "dynasty",
    "birthYear",
    "deathYear",
    "intro",
    "sourceRefs",
    "reviewStatus",
}
PLACE_FIELDS = {
    "id",
    "name",
    "historicalNames",
    "modernName",
    "sourceCoordinates",
    "intro",
    "sourceRefs",
    "reviewStatus",
}
EVENT_FIELDS = {
    "id",
    "personId",
    "placeId",
    "lifeStage",
    "role",
    "title",
    "summary",
    "workIds",
    "sourceRefs",
    "reviewStatus",
}
EVENT_TEMPORAL_FIELDS = {
    "startYear",
    "endYear",
    "timePrecision",
    "timeLabel",
    "sequence",
}
EVENT_TIME_PRECISIONS = {
    "year",
    "range",
    "era-only",
    "era-and-month",
    "sequence-only",
}
EVENT_YEAR_TIME_PRECISIONS = {"year", "range"}
WORK_FIELDS = {
    "id",
    "personId",
    "placeIds",
    "eventIds",
    "title",
    "genre",
    "text",
    "plainExplanation",
    "sourceRefs",
    "reviewStatus",
}

LOCATOR_FIELDS: dict[str, set[str]] = {
    "line-range": {"kind", "path", "startLine", "endLine"},
    "page-range": {"kind", "pageStart", "pageEnd"},
    "json-pointer": {"kind", "path", "pointer"},
    "record-id": {"kind", "table", "recordId"},
    "chapter-section": {"kind", "chapter", "section"},
    "named-anchor": {"kind", "path", "anchor"},
}


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    dataset: str | None = None
    record_id: str | None = None
    field: str | None = None


class PublishedDataValidation:
    """Stateful validator so the synchronizer can reuse parsed data safely."""

    def __init__(
        self,
        data_dir: Path = DEFAULT_DATA_DIR,
        manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
        *,
        validate_source_catalog: bool = True,
    ) -> None:
        self.data_dir = data_dir.resolve()
        self.manifest_path = manifest_path.resolve()
        self.validate_source_catalog = validate_source_catalog
        self.issues: list[Issue] = []
        self.datasets: dict[str, list[dict[str, Any]]] = {}
        self.manifest_sources: dict[str, dict[str, Any]] = {}
        self.source_ids: set[str] = set()
        self.source_root = PROJECT_ROOT / "source-materials"

    @property
    def errors(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.severity == "warning"]

    @property
    def valid(self) -> bool:
        return not self.errors

    def error(
        self,
        code: str,
        message: str,
        *,
        dataset: str | None = None,
        record_id: str | None = None,
        field: str | None = None,
    ) -> None:
        self.issues.append(Issue("error", code, message, dataset, record_id, field))

    def run(self) -> "PublishedDataValidation":
        self._load_manifest_sources()
        self._load_datasets()

        self._validate_sources()
        self._validate_people()
        self._validate_places()
        self._validate_events()
        self._validate_works()
        self._validate_relationships()
        return self

    def payload(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "dataDir": str(self.data_dir),
            "manifestPath": str(self.manifest_path),
            "entityCounts": {
                name: len(self.datasets.get(name, [])) for name in DATASET_NAMES
            },
            "errorCount": len(self.errors),
            "warningCount": len(self.warnings),
            "issues": [asdict(issue) for issue in self.issues],
        }

    def _load_manifest_sources(self) -> None:
        try:
            payload = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            self.error("source-manifest-missing", f"Missing source manifest: {self.manifest_path}")
            return
        except UnicodeDecodeError:
            self.error("source-manifest-encoding", "The source manifest must be UTF-8.")
            return
        except json.JSONDecodeError as exc:
            self.error(
                "source-manifest-json",
                f"Invalid source manifest JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}",
            )
            return

        sources = payload.get("sources") if isinstance(payload, dict) else None
        if not isinstance(sources, list):
            self.error("source-manifest-shape", "The source manifest must contain a sources array.")
            return

        for source in sources:
            if not isinstance(source, dict) or not isinstance(source.get("id"), str):
                self.error("source-manifest-record", "A source-manifest record has no string id.")
                continue
            source_id = source["id"]
            if source_id in self.manifest_sources:
                self.error("source-manifest-duplicate-id", f"Duplicate source-manifest id: {source_id}")
                continue
            self.manifest_sources[source_id] = source

        if not self.validate_source_catalog:
            return

        try:
            # This is the authoritative raw-layer gate: it checks the manifest,
            # rights/quality state, materialization, and content snapshots.
            load_approved_sources(self.manifest_path)
        except SourceCatalogError as exc:
            self.error("source-catalog-invalid", str(exc), dataset="sources")

    def _load_datasets(self) -> None:
        for name in DATASET_NAMES:
            path = self.data_dir / f"{name}.json"
            records: list[dict[str, Any]] = []
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                self.error("dataset-missing", f"Missing canonical dataset: {path}", dataset=name)
            except UnicodeDecodeError:
                self.error("dataset-encoding", "Dataset must be UTF-8.", dataset=name)
            except json.JSONDecodeError as exc:
                self.error(
                    "dataset-json",
                    f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}",
                    dataset=name,
                )
            else:
                if not isinstance(payload, list):
                    self.error("dataset-type", "The dataset root must be a JSON array.", dataset=name)
                else:
                    for index, record in enumerate(payload):
                        if not isinstance(record, dict):
                            self.error(
                                "record-type",
                                f"Record {index} must be a JSON object.",
                                dataset=name,
                            )
                            continue
                        records.append(record)
            self.datasets[name] = records

    def _validate_sources(self) -> None:
        records = self.datasets["sources"]
        self._validate_unique_ids(records, "sources")
        self.source_ids = {
            record["id"]
            for record in records
            if isinstance(record.get("id"), str)
        }

        for record in records:
            source_id = self._record_id(record)
            self._validate_exact_fields(record, SOURCE_FIELDS, "sources", source_id)
            self._validate_id(record.get("id"), "sources", source_id, "id")
            self._validate_nonempty_string(record.get("title"), "sources", source_id, "title")
            self._validate_nonempty_string(record.get("sourceType"), "sources", source_id, "sourceType")
            self._validate_https(record.get("sourceUrl"), "sources", source_id, "sourceUrl")
            self._validate_version(record.get("version"), "sources", source_id, "version")
            self._validate_nonempty_string(record.get("license"), "sources", source_id, "license")
            self._validate_https(record.get("licenseUrl"), "sources", source_id, "licenseUrl")
            self._validate_nonempty_string(record.get("attribution"), "sources", source_id, "attribution")
            self._validate_published(record.get("reviewStatus"), "sources", source_id)

            expected = self.manifest_sources.get(source_id or "")
            if expected is None:
                self.error(
                    "source-not-in-manifest",
                    "Published source id is not registered in source-manifest.json.",
                    dataset="sources",
                    record_id=source_id,
                    field="id",
                )
                continue
            if expected.get("ingestionStatus") != "approved":
                self.error(
                    "source-not-approved",
                    "Published source must have ingestionStatus=approved in source-manifest.json.",
                    dataset="sources",
                    record_id=source_id,
                    field="id",
                )
            if not self._source_is_publicly_publishable(expected):
                self.error(
                    "source-not-publicly-publishable",
                    "Published source must allow data extraction and public redistribution.",
                    dataset="sources",
                    record_id=source_id,
                    field="id",
                )

            expected_values = {
                "title": expected.get("title"),
                "sourceType": expected.get("sourceType"),
                "sourceUrl": expected.get("sourceUrl"),
                "version": expected.get("version"),
                "license": expected.get("rights", {}).get("license"),
                "licenseUrl": expected.get("rights", {}).get("licenseUrl"),
                "attribution": expected.get("rights", {}).get("attribution"),
            }
            for field, expected_value in expected_values.items():
                if record.get(field) != expected_value:
                    self.error(
                        "source-metadata-mismatch",
                        f"Published {field} must exactly match source-manifest.json.",
                        dataset="sources",
                        record_id=source_id,
                        field=field,
                    )

    def _validate_people(self) -> None:
        records = self.datasets["people"]
        self._validate_unique_ids(records, "people")
        for record in records:
            record_id = self._record_id(record)
            self._validate_exact_fields(record, PEOPLE_FIELDS, "people", record_id)
            self._validate_id(record.get("id"), "people", record_id, "id")
            for field in ("name", "dynasty", "intro"):
                self._validate_nonempty_string(record.get(field), "people", record_id, field)
            self._validate_string_list(record.get("aliases"), "people", record_id, "aliases")
            birth = self._validate_year(record.get("birthYear"), "people", record_id, "birthYear")
            death = self._validate_year(record.get("deathYear"), "people", record_id, "deathYear")
            if birth is not None and death is not None and birth > death:
                self.error(
                    "person-year-range",
                    "birthYear must not be later than deathYear.",
                    dataset="people",
                    record_id=record_id,
                )
            self._validate_source_refs(record.get("sourceRefs"), "people", record_id)
            self._validate_published(record.get("reviewStatus"), "people", record_id)

    def _validate_places(self) -> None:
        records = self.datasets["places"]
        self._validate_unique_ids(records, "places")
        for record in records:
            record_id = self._record_id(record)
            self._validate_exact_fields(record, PLACE_FIELDS, "places", record_id)
            self._validate_id(record.get("id"), "places", record_id, "id")
            for field in ("name", "modernName", "intro"):
                self._validate_nonempty_string(record.get(field), "places", record_id, field)
            self._validate_string_list(
                record.get("historicalNames"), "places", record_id, "historicalNames", minimum=1
            )
            source_ref_keys = self._validate_source_refs(record.get("sourceRefs"), "places", record_id)
            coordinate_ref_key = self._validate_coordinates(
                record.get("sourceCoordinates"), record_id
            )
            if coordinate_ref_key is not None and coordinate_ref_key not in source_ref_keys:
                self.error(
                    "coordinate-source-not-cited",
                    "sourceCoordinates.sourceRef must also occur in the place sourceRefs array.",
                    dataset="places",
                    record_id=record_id,
                    field="sourceCoordinates.sourceRef",
                )
            self._validate_published(record.get("reviewStatus"), "places", record_id)

    def _validate_events(self) -> None:
        records = self.datasets["events"]
        self._validate_unique_ids(records, "events")
        for record in records:
            record_id = self._record_id(record)
            self._validate_exact_fields(
                record,
                EVENT_FIELDS,
                "events",
                record_id,
                optional=EVENT_TEMPORAL_FIELDS,
            )
            self._validate_id(record.get("id"), "events", record_id, "id")
            for field in ("personId", "placeId"):
                self._validate_id(record.get(field), "events", record_id, field)
            for field in ("lifeStage", "role", "title", "summary"):
                self._validate_nonempty_string(record.get(field), "events", record_id, field)
            self._validate_event_temporal_fields(record, record_id)
            self._validate_id_list(record.get("workIds"), "events", record_id, "workIds")
            self._validate_source_refs(record.get("sourceRefs"), "events", record_id)
            self._validate_published(record.get("reviewStatus"), "events", record_id)
        self._validate_event_route_sequences(records)

    def _validate_event_temporal_fields(
        self, record: dict[str, Any], record_id: str | None
    ) -> None:
        """Validate old year-only records and the explicit temporal contract.

        The old canonical shape required ``startYear`` / ``endYear`` and had no
        sequence metadata.  It remains valid.  A record that adopts the new
        contract must supply enough metadata for a map route to order and label
        it without inventing a Gregorian year.
        """
        has_precision = "timePrecision" in record
        has_label = "timeLabel" in record
        has_sequence = "sequence" in record
        has_start = "startYear" in record
        has_end = "endYear" in record

        if not has_precision:
            if has_label or has_sequence:
                self.error(
                    "event-temporal-contract",
                    "timeLabel and sequence require timePrecision.",
                    dataset="events",
                    record_id=record_id,
                )
            start = self._validate_year(record.get("startYear"), "events", record_id, "startYear")
            end = self._validate_year(record.get("endYear"), "events", record_id, "endYear")
            self._validate_event_year_range(start, end, record_id)
            return

        precision = record.get("timePrecision")
        precision_is_valid = isinstance(precision, str) and precision in EVENT_TIME_PRECISIONS
        if not precision_is_valid:
            self.error(
                "event-time-precision",
                "timePrecision must be one of: year, range, era-only, era-and-month, sequence-only.",
                dataset="events",
                record_id=record_id,
                field="timePrecision",
            )

        if not isinstance(record.get("timeLabel"), str) or not record["timeLabel"].strip():
            self.error(
                "event-time-label-required",
                "Events with timePrecision must have a non-empty timeLabel.",
                dataset="events",
                record_id=record_id,
                field="timeLabel",
            )
        self._validate_event_sequence(record.get("sequence"), record_id)

        if precision_is_valid and precision in EVENT_YEAR_TIME_PRECISIONS:
            if not has_start or not has_end:
                self.error(
                    "event-temporal-year-required",
                    "timePrecision=year or range requires both startYear and endYear.",
                    dataset="events",
                    record_id=record_id,
                )
                return
        elif has_start != has_end:
            self.error(
                "event-temporal-year-pair",
                "Optional startYear and endYear must be supplied together.",
                dataset="events",
                record_id=record_id,
            )
            return

        if has_start and has_end:
            start = self._validate_year(record.get("startYear"), "events", record_id, "startYear")
            end = self._validate_year(record.get("endYear"), "events", record_id, "endYear")
            self._validate_event_year_range(start, end, record_id)
            if precision == "year" and start is not None and end is not None and start != end:
                self.error(
                    "event-time-precision-year",
                    "timePrecision=year requires startYear and endYear to be equal.",
                    dataset="events",
                    record_id=record_id,
                    field="timePrecision",
                )

    def _validate_event_year_range(
        self, start: int | None, end: int | None, record_id: str | None
    ) -> None:
        if start is not None and end is not None and start > end:
            self.error(
                "event-year-range",
                "startYear must not be later than endYear.",
                dataset="events",
                record_id=record_id,
            )

    def _validate_event_sequence(self, value: Any, record_id: str | None) -> int | None:
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            self.error(
                "event-sequence-required",
                "Events with timePrecision must have a positive integer sequence.",
                dataset="events",
                record_id=record_id,
                field="sequence",
            )
            return None
        return value

    def _validate_event_route_sequences(self, records: list[dict[str, Any]]) -> None:
        """Ensure a route can be fully ordered if any event opts into sequence."""
        records_by_person: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            person_id = record.get("personId")
            if isinstance(person_id, str):
                records_by_person.setdefault(person_id, []).append(record)

        for person_id, person_records in records_by_person.items():
            if not any("sequence" in record for record in person_records):
                continue
            sequences: dict[int, str | None] = {}
            for record in person_records:
                record_id = self._record_id(record)
                sequence = record.get("sequence")
                if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 1:
                    self.error(
                        "event-route-sequence-required",
                        "All events for a person need a positive integer sequence when any event has sequence metadata.",
                        dataset="events",
                        record_id=record_id,
                        field="sequence",
                    )
                    continue
                if sequence in sequences:
                    previous_id = sequences[sequence]
                    self.error(
                        "event-route-sequence-duplicate",
                        f"sequence {sequence} is already used by event {previous_id} for person {person_id}.",
                        dataset="events",
                        record_id=record_id,
                        field="sequence",
                    )
                else:
                    sequences[sequence] = record_id

    def _validate_works(self) -> None:
        records = self.datasets["works"]
        self._validate_unique_ids(records, "works")
        for record in records:
            record_id = self._record_id(record)
            self._validate_exact_fields(
                record,
                WORK_FIELDS,
                "works",
                record_id,
                optional={"isFullText"},
            )
            self._validate_id(record.get("id"), "works", record_id, "id")
            self._validate_id(record.get("personId"), "works", record_id, "personId")
            for field in ("title", "genre", "plainExplanation"):
                self._validate_nonempty_string(record.get(field), "works", record_id, field)
            if "isFullText" in record and not isinstance(record["isFullText"], bool):
                self.error(
                    "work-isfulltext-type",
                    "isFullText must be a boolean when present.",
                    dataset="works",
                    record_id=record_id,
                    field="isFullText",
                )
            self._validate_id_list(record.get("placeIds"), "works", record_id, "placeIds")
            self._validate_id_list(record.get("eventIds"), "works", record_id, "eventIds")
            self._validate_string_list(record.get("text"), "works", record_id, "text", minimum=1)
            self._validate_source_refs(record.get("sourceRefs"), "works", record_id)
            self._validate_published(record.get("reviewStatus"), "works", record_id)

    def _validate_relationships(self) -> None:
        people = self._index_by_id(self.datasets["people"])
        places = self._index_by_id(self.datasets["places"])
        events = self._index_by_id(self.datasets["events"])
        works = self._index_by_id(self.datasets["works"])

        event_pairs: set[tuple[str, str]] = set()
        work_pairs: set[tuple[str, str]] = set()

        for event in self.datasets["events"]:
            event_id = self._record_id(event)
            person_id = event.get("personId")
            place_id = event.get("placeId")
            if isinstance(person_id, str) and person_id not in people:
                self._missing_foreign_key("events", event_id, "personId", person_id, "people")
            if isinstance(place_id, str) and place_id not in places:
                self._missing_foreign_key("events", event_id, "placeId", place_id, "places")
            for work_id in self._valid_id_values(event.get("workIds")):
                if work_id not in works:
                    self._missing_foreign_key("events", event_id, "workIds", work_id, "works")
                    continue
                event_pairs.add((event_id or "", work_id))
                work_person_id = works[work_id].get("personId")
                if isinstance(person_id, str) and work_person_id != person_id:
                    self.error(
                        "event-work-person-mismatch",
                        "An event and a linked work must belong to the same person.",
                        dataset="events",
                        record_id=event_id,
                        field="workIds",
                    )

        for work in self.datasets["works"]:
            work_id = self._record_id(work)
            person_id = work.get("personId")
            if isinstance(person_id, str) and person_id not in people:
                self._missing_foreign_key("works", work_id, "personId", person_id, "people")
            for place_id in self._valid_id_values(work.get("placeIds")):
                if place_id not in places:
                    self._missing_foreign_key("works", work_id, "placeIds", place_id, "places")
            for event_id in self._valid_id_values(work.get("eventIds")):
                if event_id not in events:
                    self._missing_foreign_key("works", work_id, "eventIds", event_id, "events")
                    continue
                work_pairs.add((event_id, work_id or ""))
                event_person_id = events[event_id].get("personId")
                if isinstance(person_id, str) and event_person_id != person_id:
                    self.error(
                        "event-work-person-mismatch",
                        "A work and a linked event must belong to the same person.",
                        dataset="works",
                        record_id=work_id,
                        field="eventIds",
                    )

        for event_id, work_id in sorted(event_pairs - work_pairs):
            self.error(
                "event-work-asymmetry",
                f"Event {event_id} lists work {work_id}, but the work does not list the event.",
                dataset="events",
                record_id=event_id,
                field="workIds",
            )
        for event_id, work_id in sorted(work_pairs - event_pairs):
            self.error(
                "event-work-asymmetry",
                f"Work {work_id} lists event {event_id}, but the event does not list the work.",
                dataset="works",
                record_id=work_id,
                field="eventIds",
            )

    def _validate_exact_fields(
        self,
        record: dict[str, Any],
        expected: set[str],
        dataset: str,
        record_id: str | None,
        *,
        optional: set[str] | None = None,
    ) -> None:
        allowed = expected | (optional or set())
        keys = set(record)
        missing = sorted(expected - keys)
        extra = sorted(keys - allowed)
        if missing:
            self.error(
                "record-required-fields",
                f"Missing required fields: {', '.join(missing)}.",
                dataset=dataset,
                record_id=record_id,
            )
        if extra:
            self.error(
                "record-extra-fields",
                f"Unsupported fields in canonical published data: {', '.join(extra)}.",
                dataset=dataset,
                record_id=record_id,
            )

    def _validate_unique_ids(self, records: list[dict[str, Any]], dataset: str) -> None:
        seen: set[str] = set()
        for index, record in enumerate(records):
            value = record.get("id")
            if not isinstance(value, str):
                continue
            if value in seen:
                self.error(
                    "duplicate-id",
                    f"Duplicate id: {value}.",
                    dataset=dataset,
                    record_id=value,
                    field="id",
                )
            seen.add(value)

    def _validate_id(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> None:
        if not isinstance(value, str) or not ID_RE.fullmatch(value):
            self.error(
                "id-format",
                "IDs must use lowercase ASCII kebab-case.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )

    def _validate_nonempty_string(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> None:
        if not isinstance(value, str) or not value.strip():
            self.error(
                "string-required",
                "Value must be a non-empty string.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )

    def _validate_https(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> None:
        if not isinstance(value, str) or not value.startswith("https://") or len(value) <= 8:
            self.error(
                "https-required",
                "Value must be a non-empty HTTPS URL.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )

    def _validate_version(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> None:
        if not isinstance(value, dict) or set(value) != {"type", "value"}:
            self.error(
                "version-shape",
                "version must contain exactly type and value.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return
        self._validate_nonempty_string(value.get("type"), dataset, record_id, f"{field}.type")
        self._validate_nonempty_string(value.get("value"), dataset, record_id, f"{field}.value")

    def _validate_year(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> int | None:
        if not isinstance(value, int) or isinstance(value, bool):
            self.error(
                "year-type",
                "Year must be an integer.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return None
        return value

    def _validate_string_list(
        self,
        value: Any,
        dataset: str,
        record_id: str | None,
        field: str,
        *,
        minimum: int = 0,
    ) -> list[str]:
        if not isinstance(value, list):
            self.error(
                "list-type",
                "Value must be an array.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return []
        strings: list[str] = []
        for index, item in enumerate(value):
            if not isinstance(item, str) or not item.strip():
                self.error(
                    "list-item-string",
                    "Array items must be non-empty strings.",
                    dataset=dataset,
                    record_id=record_id,
                    field=f"{field}[{index}]",
                )
            else:
                strings.append(item)
        if len(value) < minimum:
            self.error(
                "list-minimum",
                f"Array must contain at least {minimum} item(s).",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
        if len(strings) != len(set(strings)):
            self.error(
                "list-duplicate",
                "Array must not contain duplicate values.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
        return strings

    def _validate_id_list(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> list[str]:
        values = self._validate_string_list(value, dataset, record_id, field)
        for index, item in enumerate(values):
            self._validate_id(item, dataset, record_id, f"{field}[{index}]")
        return values

    def _validate_published(
        self, value: Any, dataset: str, record_id: str | None
    ) -> None:
        if value != "published":
            self.error(
                "not-published",
                "Only reviewStatus=published may enter canonical published data.",
                dataset=dataset,
                record_id=record_id,
                field="reviewStatus",
            )

    def _validate_source_refs(
        self, value: Any, dataset: str, record_id: str | None
    ) -> set[str]:
        if not isinstance(value, list):
            self.error(
                "source-refs-type",
                "sourceRefs must be an array.",
                dataset=dataset,
                record_id=record_id,
                field="sourceRefs",
            )
            return set()
        if not value:
            self.error(
                "source-refs-empty",
                "At least one precise source reference is required.",
                dataset=dataset,
                record_id=record_id,
                field="sourceRefs",
            )
            return set()
        keys: set[str] = set()
        for index, source_ref in enumerate(value):
            key = self._validate_source_ref(source_ref, dataset, record_id, f"sourceRefs[{index}]")
            if key is None:
                continue
            if key in keys:
                self.error(
                    "source-ref-duplicate",
                    "sourceRefs must not contain duplicate sourceId/locator pairs.",
                    dataset=dataset,
                    record_id=record_id,
                    field=f"sourceRefs[{index}]",
                )
            keys.add(key)
        return keys

    def _validate_source_ref(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> str | None:
        if not isinstance(value, dict):
            self.error(
                "source-ref-type",
                "A source reference must be an object.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return None
        self._validate_exact_fields(
            value,
            {"sourceId", "locator"},
            dataset,
            record_id,
            optional={"purpose"},
        )
        source_id = value.get("sourceId")
        self._validate_id(source_id, dataset, record_id, f"{field}.sourceId")
        if "purpose" in value:
            self._validate_nonempty_string(
                value.get("purpose"), dataset, record_id, f"{field}.purpose"
            )
        if isinstance(source_id, str):
            if source_id not in self.source_ids:
                self.error(
                    "source-ref-missing-source-card",
                    "sourceRef must point to a source card in sources.json.",
                    dataset=dataset,
                    record_id=record_id,
                    field=f"{field}.sourceId",
                )
            expected = self.manifest_sources.get(source_id)
            if expected is None:
                self.error(
                    "source-ref-not-in-manifest",
                    "sourceRef must point to source-manifest.json.",
                    dataset=dataset,
                    record_id=record_id,
                    field=f"{field}.sourceId",
                )
            elif expected.get("ingestionStatus") != "approved":
                self.error(
                    "source-ref-not-approved",
                    "sourceRef must point to an approved source-manifest record.",
                    dataset=dataset,
                    record_id=record_id,
                    field=f"{field}.sourceId",
                )
            elif not self._source_is_publicly_publishable(expected):
                self.error(
                    "source-ref-not-publicly-publishable",
                    "sourceRef source must allow data extraction and public redistribution.",
                    dataset=dataset,
                    record_id=record_id,
                    field=f"{field}.sourceId",
                )
        self._validate_locator(
            value.get("locator"),
            dataset,
            record_id,
            f"{field}.locator",
            source_id if isinstance(source_id, str) else None,
        )
        try:
            return json.dumps(
                {"sourceId": source_id, "locator": value.get("locator")},
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        except (TypeError, ValueError):  # JSON input normally makes this unreachable.
            return None

    def _validate_locator(
        self,
        value: Any,
        dataset: str,
        record_id: str | None,
        field: str,
        source_id: str | None,
    ) -> None:
        if not isinstance(value, dict):
            self.error(
                "locator-type",
                "locator must be a structured locator object, not free text.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return
        kind = value.get("kind")
        expected_fields = LOCATOR_FIELDS.get(kind) if isinstance(kind, str) else None
        if expected_fields is None:
            self.error(
                "locator-kind",
                f"Unsupported locator kind: {kind!r}.",
                dataset=dataset,
                record_id=record_id,
                field=f"{field}.kind",
            )
            return
        self._validate_exact_fields(value, expected_fields, dataset, record_id)

        if kind == "line-range":
            self._validate_relative_path(value.get("path"), dataset, record_id, f"{field}.path")
            start = self._validate_positive_integer(value.get("startLine"), dataset, record_id, f"{field}.startLine")
            end = self._validate_positive_integer(value.get("endLine"), dataset, record_id, f"{field}.endLine")
            if start is not None and end is not None and start > end:
                self.error("locator-range", "startLine must not exceed endLine.", dataset=dataset, record_id=record_id, field=field)
            elif end is not None:
                self._validate_material_line_range(
                    source_id, value.get("path"), end, dataset, record_id, field
                )
        elif kind == "page-range":
            start = self._validate_positive_integer(value.get("pageStart"), dataset, record_id, f"{field}.pageStart")
            end = self._validate_positive_integer(value.get("pageEnd"), dataset, record_id, f"{field}.pageEnd")
            if start is not None and end is not None and start > end:
                self.error("locator-range", "pageStart must not exceed pageEnd.", dataset=dataset, record_id=record_id, field=field)
        elif kind == "json-pointer":
            self._validate_relative_path(value.get("path"), dataset, record_id, f"{field}.path")
            pointer = value.get("pointer")
            if not isinstance(pointer, str) or not pointer.startswith("/"):
                self.error("locator-json-pointer", "pointer must be a non-root RFC 6901 JSON Pointer.", dataset=dataset, record_id=record_id, field=f"{field}.pointer")
            else:
                self._validate_material_json_pointer(
                    source_id, value.get("path"), pointer, dataset, record_id, field
                )
        elif kind == "record-id":
            self._validate_nonempty_string(value.get("table"), dataset, record_id, f"{field}.table")
            self._validate_nonempty_string(value.get("recordId"), dataset, record_id, f"{field}.recordId")
        elif kind == "chapter-section":
            self._validate_nonempty_string(value.get("chapter"), dataset, record_id, f"{field}.chapter")
            self._validate_nonempty_string(value.get("section"), dataset, record_id, f"{field}.section")
        elif kind == "named-anchor":
            self._validate_relative_path(value.get("path"), dataset, record_id, f"{field}.path")
            self._validate_nonempty_string(value.get("anchor"), dataset, record_id, f"{field}.anchor")

    def _validate_coordinates(self, value: Any, record_id: str | None) -> str | None:
        if not isinstance(value, dict):
            self.error("coordinates-type", "sourceCoordinates must be an object.", dataset="places", record_id=record_id, field="sourceCoordinates")
            return None
        self._validate_exact_fields(value, {"x", "y", "source", "sourceRef"}, "places", record_id)
        x = self._validate_coordinate(value.get("x"), "x", record_id)
        y = self._validate_coordinate(value.get("y"), "y", record_id)
        if x is not None and not -180 <= x <= 180:
            self.error("coordinate-longitude", "x longitude must be within [-180, 180].", dataset="places", record_id=record_id, field="sourceCoordinates.x")
        if y is not None and not -90 <= y <= 90:
            self.error("coordinate-latitude", "y latitude must be within [-90, 90].", dataset="places", record_id=record_id, field="sourceCoordinates.y")
        self._validate_nonempty_string(value.get("source"), "places", record_id, "sourceCoordinates.source")
        return self._validate_source_ref(value.get("sourceRef"), "places", record_id, "sourceCoordinates.sourceRef")

    def _validate_coordinate(self, value: Any, axis: str, record_id: str | None) -> float | None:
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            self.error("coordinate-type", f"{axis} must be a finite number.", dataset="places", record_id=record_id, field=f"sourceCoordinates.{axis}")
            return None
        return float(value)

    def _validate_relative_path(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> None:
        if not isinstance(value, str) or not value.strip() or "\\" in value:
            self.error("locator-path", "Locator path must be a non-empty slash-separated relative path.", dataset=dataset, record_id=record_id, field=field)
            return
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or "." in path.parts:
            self.error("locator-path", "Locator path must stay within the source root.", dataset=dataset, record_id=record_id, field=field)

    def _validate_positive_integer(
        self, value: Any, dataset: str, record_id: str | None, field: str
    ) -> int | None:
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            self.error("locator-integer", "Locator value must be a positive integer.", dataset=dataset, record_id=record_id, field=field)
            return None
        return value

    def _resolve_locator_file(
        self,
        source_id: str | None,
        relative_path: Any,
        dataset: str,
        record_id: str | None,
        field: str,
    ) -> Path | None:
        """Resolve a locator path only after the full source catalog is valid."""
        if not self.validate_source_catalog:
            return None
        if not isinstance(source_id, str) or not isinstance(relative_path, str):
            return None
        source = self.manifest_sources.get(source_id)
        local_path = source.get("localPath") if isinstance(source, dict) else None
        if not isinstance(local_path, str):
            return None

        source_path = self.source_root.joinpath(*PurePosixPath(local_path).parts).resolve()
        source_base = source_path if source_path.is_dir() else source_path.parent
        candidate = source_base.joinpath(*PurePosixPath(relative_path).parts).resolve()
        try:
            candidate.relative_to(source_base)
        except ValueError:
            self.error(
                "locator-file-outside-source",
                "Locator path resolves outside the governed source root.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return None

        if source_path.is_file() and candidate != source_path:
            self.error(
                "locator-file-mismatch",
                "Single-file source locators must name that governed file.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return None
        if not candidate.is_file():
            self.error(
                "locator-file-missing",
                "Locator path does not exist in the governed source.",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return None
        return candidate

    def _validate_material_line_range(
        self,
        source_id: str | None,
        relative_path: Any,
        end_line: int,
        dataset: str,
        record_id: str | None,
        field: str,
    ) -> None:
        path = self._resolve_locator_file(
            source_id, relative_path, dataset, record_id, f"{field}.path"
        )
        if path is None:
            return
        try:
            with path.open("r", encoding="utf-8") as handle:
                for line_number, _ in enumerate(handle, start=1):
                    if line_number >= end_line:
                        return
        except (OSError, UnicodeDecodeError) as exc:
            self.error(
                "locator-file-read",
                f"Could not read line-range locator target: {exc}",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return
        self.error(
            "locator-line-out-of-range",
            f"endLine {end_line} exceeds the target file length.",
            dataset=dataset,
            record_id=record_id,
            field=field,
        )

    def _validate_material_json_pointer(
        self,
        source_id: str | None,
        relative_path: Any,
        pointer: str,
        dataset: str,
        record_id: str | None,
        field: str,
    ) -> None:
        path = self._resolve_locator_file(
            source_id, relative_path, dataset, record_id, f"{field}.path"
        )
        if path is None:
            return
        try:
            current: Any = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.error(
                "locator-json-read",
                f"Could not parse JSON Pointer locator target: {exc}",
                dataset=dataset,
                record_id=record_id,
                field=field,
            )
            return
        for token in pointer[1:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            if isinstance(current, dict) and token in current:
                current = current[token]
            elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
                current = current[int(token)]
            else:
                self.error(
                    "locator-json-pointer-missing",
                    "JSON Pointer does not resolve in the governed source file.",
                    dataset=dataset,
                    record_id=record_id,
                    field=field,
                )
                return

    def _source_is_publicly_publishable(self, source: dict[str, Any]) -> bool:
        rights = source.get("rights")
        allowed_uses = source.get("allowedUses")
        return (
            source.get("ingestionStatus") == "approved"
            and isinstance(rights, dict)
            and rights.get("redistributionAllowed") is True
            and isinstance(allowed_uses, list)
            and "data-extraction" in allowed_uses
            and "public-redistribution" in allowed_uses
        )

    def _index_by_id(self, records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        return {
            record["id"]: record
            for record in records
            if isinstance(record.get("id"), str)
        }

    def _missing_foreign_key(
        self, dataset: str, record_id: str | None, field: str, target_id: str, target_dataset: str
    ) -> None:
        self.error(
            "foreign-key-missing",
            f"Referenced {target_dataset} id does not exist: {target_id}.",
            dataset=dataset,
            record_id=record_id,
            field=field,
        )

    @staticmethod
    def _record_id(record: dict[str, Any]) -> str | None:
        value = record.get("id")
        return value if isinstance(value, str) else None

    @staticmethod
    def _valid_id_values(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, str) and ID_RE.fullmatch(item)]


def validate_published_data(
    data_dir: Path = DEFAULT_DATA_DIR,
    manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
    *,
    validate_source_catalog: bool = True,
) -> PublishedDataValidation:
    """Return a completed validation object for reuse by tests and sync code."""
    return PublishedDataValidation(
        data_dir,
        manifest_path,
        validate_source_catalog=validate_source_catalog,
    ).run()


def validate_public_source_refs(
    references_by_record: dict[str, Any],
    *,
    data_dir: Path = DEFAULT_DATA_DIR,
    manifest_path: Path = DEFAULT_SOURCE_MANIFEST,
) -> PublishedDataValidation:
    """Validate policy-selected source references against canonical public data.

    This is intentionally narrower than a publisher: it first revalidates the
    complete canonical package and governed source catalogue, then applies the
    same public-source and exact-locator checks to each supplied record's
    ``sourceRefs``.  It is suitable for policy gates that must not trust a
    frontend copy merely because it happens to contain a matching source id.
    """

    validation = validate_published_data(data_dir, manifest_path)
    if not validation.valid:
        return validation
    if not isinstance(references_by_record, dict):
        validation.error(
            "policy-source-refs-type",
            "Policy source references must be keyed by record id.",
            dataset="policy-approval",
        )
        return validation
    for record_id, source_refs in references_by_record.items():
        if not isinstance(record_id, str) or not ID_RE.fullmatch(record_id):
            validation.error(
                "policy-record-id",
                "Policy source-reference record id must be a lowercase kebab-case identifier.",
                dataset="policy-approval",
                record_id=record_id if isinstance(record_id, str) else None,
            )
            continue
        validation._validate_source_refs(source_refs, "policy-approval", record_id)
    return validation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate canonical published knowledge-graph data before web sync."
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable report.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    validation = validate_published_data(args.data_dir, args.manifest)
    payload = validation.payload()
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in validation.issues:
            location = " / ".join(
                value
                for value in (issue.dataset, issue.record_id, issue.field)
                if value
            )
            prefix = f" [{location}]" if location else ""
            print(f"{issue.severity.upper()} {issue.code}{prefix}: {issue.message}")
        print(
            "Published-data validation: "
            f"{payload['errorCount']} error(s), {payload['warningCount']} warning(s)."
        )
    return 0 if validation.valid else 1


if __name__ == "__main__":
    sys.exit(main())
