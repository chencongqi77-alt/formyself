#!/usr/bin/env python3
"""Build a private, rule-based poet-route draft from extracted biography text.

This deliberately narrow first map pass is automatic and offline.  It uses
only exact canonical names from ``data/published/places.json`` by default,
requires an explicit biographical action in the same sentence, and emits an
auditable private draft.  It never changes shared facts, released data, or
frontend assets.

Examples
--------
    python scripts/build_biography_route_draft.py \
      --job var/jobs/pmj-.../job.json

The script completes the remaining job stages.  ``corpus`` and ``enrichment``
are explicitly recorded as no-op reports in this baseline; poetry mentions are
not used to invent travel events.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

from poet_map_job import (
    PROJECT_ROOT,
    complete_stages,
    file_sha256,
    job_root_for_manifest,
    load_job,
    make_artifact,
    read_json,
    utc_now,
    write_json_atomically,
)
from validate_poet_fact_package import validate_fact_package


DEFAULT_PLACE_CATALOG = PROJECT_ROOT / "data" / "published" / "places.json"
PIPELINE_VERSION = "biography-route-draft-v1"
POLICY_ID = "automatic-private-route-policy-v1"

# These predicates are intentionally precise enough to avoid treating titles,
# poetic description, and literary composition as biographical movement.
ACTION_RULES: tuple[tuple[str, re.Pattern[str], float], ...] = (
    ("born-at", re.compile(r"出生(?:于|在)|生于|生在|诞生(?:于|在)"), 0.95),
    ("died-at", re.compile(r"逝世(?:于|在)|病逝(?:于|在)|卒于|死于"), 0.95),
    ("exiled-to", re.compile(r"贬(?:至|谪)|贬谪(?:至|于|在)?|谪(?:居|至|于|在)|流放(?:至|于|在)"), 0.9),
    ("held-office-at", re.compile(r"出任|任职|担任|为官|授(?:任|官)|知(?:府|州|县)|守(?:府|州|县)"), 0.88),
    ("resided-at", re.compile(r"寓居|旅居|定居|迁居|居住|居于|居在|住于|住在|卜居"), 0.87),
    ("stayed-at", re.compile(r"留居|停留|驻留|驻于|驻在|寄居"), 0.8),
    ("traveled-to", re.compile(r"游历|游于|抵达|到达|前往|赴(?:任|京|[\u3400-\u9fff])|过访|拜访|行至|至(?:于|[\u3400-\u9fff])|入(?:京|[\u3400-\u9fff])"), 0.76),
)
LITERARY_CONTEXT = re.compile(r"作于|写于|题(?:[于写])?|诗|词|赋|书|赠|送|怀|望|梦|吟咏|写作")
ERA_PATTERN = re.compile(r"([\u3400-\u9fff]{1,4}(?:元年|[一二三四五六七八九十百千〇零]+年|年间))")
GREGORIAN_PATTERN = re.compile(r"公元\s*(-?\d{1,4})年")
SENTENCE_PATTERN = re.compile(r"[^。！？!?；;\n]+[。！？!?；;]?")


class RouteDraftError(ValueError):
    """Raised when a job cannot safely advance to a private map draft."""


def _stable_id(prefix: str, *parts: str | int | None) -> str:
    source = "|".join("" if part is None else str(part) for part in parts)
    return f"{prefix}-" + hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]


def _stage_is_pending(job: dict[str, Any], name: str) -> bool:
    return any(isinstance(stage, dict) and stage.get("name") == name and stage.get("status") == "pending" for stage in job.get("stages", []))


def _load_segments(root: Path, job: dict[str, Any]) -> list[dict[str, Any]]:
    artifact = next(
        (
            record
            for record in job.get("artifacts", [])
            if isinstance(record, dict) and record.get("id") == "extract-segments"
        ),
        None,
    )
    if not isinstance(artifact, dict) or artifact.get("relativePath") != "01-extract/segments.jsonl":
        raise RouteDraftError("The extract-segments artifact is required before a route draft can run.")
    path = root / "01-extract" / "segments.jsonl"
    if not path.is_file() or file_sha256(path) != artifact.get("sha256"):
        raise RouteDraftError("The extracted segment artifact is missing or no longer matches its registered SHA-256.")
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RouteDraftError(f"Extracted segment JSON is invalid at line {line_number}.") from exc
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not isinstance(record.get("text"), str):
            raise RouteDraftError(f"Extracted segment {line_number} lacks a stable id or text.")
        records.append(record)
    if not records:
        raise RouteDraftError("Extracted segment artifact contains no text segments.")
    return records


def _load_places(path: Path) -> tuple[dict[str, list[dict[str, Any]]], str]:
    payload = read_json(path, "Place catalogue")
    if not isinstance(payload, list):
        raise RouteDraftError("Place catalogue must be an array.")
    by_name: dict[str, list[dict[str, Any]]] = {}
    for record in payload:
        if not isinstance(record, dict):
            continue
        name = record.get("name")
        place_id = record.get("id")
        coordinates = record.get("sourceCoordinates")
        if not isinstance(name, str) or not name or not isinstance(place_id, str) or not isinstance(coordinates, dict):
            continue
        if not isinstance(coordinates.get("x"), (int, float)) or not isinstance(coordinates.get("y"), (int, float)):
            continue
        by_name.setdefault(name, []).append(record)
    if not by_name:
        raise RouteDraftError("Place catalogue contains no map-ready canonical places.")
    return by_name, file_sha256(path)


def _sentence_records(segment: dict[str, Any]) -> Iterable[dict[str, Any]]:
    text = segment["text"]
    segment_start = segment.get("charStart")
    if not isinstance(segment_start, int):
        segment_start = 0
    for match in SENTENCE_PATTERN.finditer(text):
        value = match.group().strip()
        if not value:
            continue
        left_trim = len(match.group()) - len(match.group().lstrip())
        start = match.start() + left_trim
        end = start + len(value)
        yield {
            "segmentId": segment["id"],
            "text": value,
            "segmentCharStart": segment_start + start,
            "segmentCharEnd": segment_start + end,
            "page": segment.get("page"),
            "ordinal": segment.get("ordinal"),
        }


def _action_for(sentence: str, place_offset: int) -> tuple[str, float] | None:
    candidates: list[tuple[int, str, float]] = []
    for predicate, pattern, score in ACTION_RULES:
        for match in pattern.finditer(sentence):
            # A nearby action is materially safer than an unrelated verb at
            # the other end of a long sentence.
            distance = min(abs(place_offset - match.start()), abs(place_offset - match.end()))
            candidates.append((distance, predicate, score))
    if not candidates:
        return None
    distance, predicate, score = min(candidates, key=lambda value: (value[0], -value[2]))
    if distance <= 12:
        score += 0.04
    elif distance > 60:
        score -= 0.16
    if LITERARY_CONTEXT.search(sentence) and predicate in {"traveled-to", "stayed-at"}:
        score -= 0.1
    if score < 0.68:
        return None
    return predicate, round(min(score, 0.99), 2)


def _time_qualifier(sentence: str, sequence: int) -> dict[str, Any]:
    gregorian = GREGORIAN_PATTERN.search(sentence)
    if gregorian:
        year = int(gregorian.group(1))
        label = gregorian.group(0)
        return {
            "precision": "year",
            "label": label,
            "originalText": label,
            "startYear": year,
            "endYear": year,
        }
    era = ERA_PATTERN.search(sentence)
    if era:
        label = era.group(1)
        return {"precision": "era-only", "label": label, "originalText": label}
    return {
        "precision": "sequence-only",
        "label": f"文中第 {sequence} 个路线候选",
        "sequence": sequence,
    }


def _match_place_mentions(
    sentences: Iterable[dict[str, Any]], by_name: dict[str, list[dict[str, Any]]]
) -> Iterable[tuple[dict[str, Any], str, int, dict[str, Any] | None, str | None]]:
    names = sorted(by_name, key=lambda value: (-len(value), value))
    pattern = re.compile("|".join(re.escape(name) for name in names))
    for sentence in sentences:
        seen: set[str] = set()
        for match in pattern.finditer(sentence["text"]):
            raw_name = match.group()
            if raw_name in seen:
                continue
            seen.add(raw_name)
            candidates = by_name[raw_name]
            if len(candidates) != 1:
                yield sentence, raw_name, match.start(), None, "ambiguous-canonical-place-name"
            else:
                yield sentence, raw_name, match.start(), candidates[0], None


def _place_projection(place: dict[str, Any]) -> dict[str, Any]:
    coordinates = place["sourceCoordinates"]
    return {
        "placeId": place["id"],
        "label": place["name"],
        "coordinates": {"longitude": coordinates["x"], "latitude": coordinates["y"]},
    }


def _existing_output_paths(root: Path) -> list[Path]:
    relative_paths = (
        "02-resolve/place-resolutions.json",
        "03-claims/fact-package.json",
        "03-claims/route-candidates.json",
        "04-corpus/corpus-skip-report.json",
        "05-enrichment/enrichment-skip-report.json",
        "06-events/map-events.json",
        "07-review/auto-policy-report.json",
        "08-map/map-draft.json",
    )
    return [root / relative for relative in relative_paths if (root / relative).exists()]


def build_route_draft(
    job_path: Path,
    *,
    place_catalog: Path = DEFAULT_PLACE_CATALOG,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Advance a successfully extracted job to an automatic private map draft."""
    job = load_job(job_path)
    root = job_root_for_manifest(job_path, job)
    remaining = ("resolve", "claims", "corpus", "enrichment", "events", "review", "map")
    blocked = [name for name in remaining if not _stage_is_pending(job, name)]
    if blocked:
        raise RouteDraftError("Remaining map stages must be pending; refusing to overwrite: " + ", ".join(blocked))
    if job.get("input", {}).get("dataProcessingConsent") is not True:
        raise RouteDraftError("The job lacks data-processing consent.")
    existing = _existing_output_paths(root)
    if existing:
        raise RouteDraftError(
            "Job already contains immutable route output; refusing to overwrite: "
            + ", ".join(str(path.relative_to(root)) for path in existing)
        )
    segments = _load_segments(root, job)
    by_name, catalog_sha256 = _load_places(place_catalog)

    all_sentences = [sentence for segment in segments for sentence in _sentence_records(segment)]
    resolutions: list[dict[str, Any]] = []
    omitted: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    assertions: list[dict[str, Any]] = []
    seen_candidate_keys: set[tuple[str, str, str]] = set()

    for sentence, raw_name, offset, place, resolution_error in _match_place_mentions(all_sentences, by_name):
        resolution_id = _stable_id("resolution", job["jobId"], sentence["segmentId"], raw_name, sentence["segmentCharStart"])
        evidence_locator = {
            "kind": "text-span",
            "segmentId": sentence["segmentId"],
            "charStart": sentence["segmentCharStart"],
            "charEnd": sentence["segmentCharEnd"],
        }
        if isinstance(sentence.get("page"), int):
            evidence_locator["page"] = sentence["page"]
        if resolution_error:
            resolutions.append(
                {
                    "id": resolution_id,
                    "rawName": raw_name,
                    "mentionSegmentIds": [sentence["segmentId"]],
                    "status": "ambiguous",
                    "matchMethod": "canonical-name-ambiguous",
                    "candidates": [{"placeId": item["id"], "label": item["name"]} for item in by_name[raw_name]],
                    "mapEligible": False,
                }
            )
            omitted.append(
                {
                    "rawName": raw_name,
                    "segmentId": sentence["segmentId"],
                    "locator": evidence_locator,
                    "reason": resolution_error,
                }
            )
            continue

        assert place is not None  # narrowed by the branch above
        projection = _place_projection(place)
        resolutions.append(
            {
                "id": resolution_id,
                "rawName": raw_name,
                "mentionSegmentIds": [sentence["segmentId"]],
                "status": "resolved",
                "matchMethod": "published-canonical-name",
                "chosen": projection,
                "candidates": [],
                "mapEligible": False,
            }
        )
        action = _action_for(sentence["text"], offset)
        if action is None:
            reason = "literary-or-contextual-mention" if LITERARY_CONTEXT.search(sentence["text"]) else "no-explicit-biographical-action"
            omitted.append(
                {
                    "rawName": raw_name,
                    "placeId": place["id"],
                    "segmentId": sentence["segmentId"],
                    "locator": evidence_locator,
                    "reason": reason,
                }
            )
            continue
        predicate, score = action
        candidate_key = (sentence["segmentId"], place["id"], predicate)
        if candidate_key in seen_candidate_keys:
            continue
        seen_candidate_keys.add(candidate_key)
        resolutions[-1]["mapEligible"] = True
        sequence = len(candidates) + 1
        evidence_id = _stable_id("evidence", job["jobId"], sentence["segmentId"], place["id"], predicate)
        assertion_id = _stable_id("assertion", job["jobId"], sentence["segmentId"], place["id"], predicate)
        evidence.append(
            {
                "id": evidence_id,
                "reference": {
                    "registry": "job-upload",
                    "referenceId": job["input"]["sourceId"],
                    "snapshotSha256": job["input"]["blobSha256"],
                },
                "locator": evidence_locator,
                "support": "supports",
                "visibility": "private",
                "excerptSha256": hashlib.sha256(sentence["text"].encode("utf-8")).hexdigest(),
                "createdByJobId": job["jobId"],
            }
        )
        assertion = {
            "id": assertion_id,
            "subject": {"type": "person", "id": job["poet"]["id"], "label": job["poet"]["name"]},
            "predicate": predicate,
            "object": {"type": "place", "id": place["id"], "label": place["name"]},
            "qualifiers": {"time": _time_qualifier(sentence["text"], sequence)},
            "claimClass": "biographical-route",
            "evidenceIds": [evidence_id],
            "confidence": {"level": "probable", "score": score, "basis": "rule-and-source"},
            "decision": {"state": "accepted", "policyId": POLICY_ID},
            "provenance": {"jobId": job["jobId"], "pipelineVersion": PIPELINE_VERSION, "createdAt": utc_now()},
        }
        assertions.append(assertion)
        candidates.append(
            {
                "id": _stable_id("route-candidate", assertion_id),
                "assertionId": assertion_id,
                "evidenceId": evidence_id,
                "rawName": raw_name,
                "place": projection,
                "predicate": predicate,
                "time": assertion["qualifiers"]["time"],
                "confidence": assertion["confidence"],
                "autoDecision": "included-private-preview",
            }
        )

    created_at = utc_now()
    fact_package = {
        "recordType": "poet-fact-package",
        "schemaVersion": "1.0.0",
        "packageId": _stable_id("fact-package", job["jobId"], job["input"]["blobSha256"]),
        "jobId": job["jobId"],
        "createdAt": created_at,
        "poet": {"id": job["poet"]["id"], "name": job["poet"]["name"]},
        "evidence": evidence,
        "assertions": assertions,
        "reviewStatus": "accepted" if assertions else "candidate",
    }
    validation = validate_fact_package(fact_package)
    if not validation.valid:
        detail = "; ".join(f"{issue.code}: {issue.message}" for issue in validation.errors)
        raise RouteDraftError("Automatic fact package failed validation: " + detail)

    resolve_output = {
        "recordType": "place-resolution-set",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "placeCatalog": {"path": "data/published/places.json", "sha256": catalog_sha256},
        "matchPolicy": "exact-published-canonical-name-only",
        "resolutions": resolutions,
    }
    route_output = {
        "recordType": "route-candidate-set",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "policyId": POLICY_ID,
        "candidates": candidates,
        "omitted": omitted,
    }
    corpus_output = {
        "recordType": "corpus-stage-report",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "status": "skipped",
        "reason": "The baseline route draft has no governed full-corpus index; poetry references never create travel events.",
    }
    enrichment_output = {
        "recordType": "enrichment-stage-report",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "status": "skipped",
        "reason": "The baseline route draft is offline and does not call external models or search services.",
    }
    event_output = {
        "recordType": "private-map-event-set",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "events": [
            {
                "id": candidate["assertionId"],
                "sequence": index,
                "place": candidate["place"],
                "predicate": candidate["predicate"],
                "time": candidate["time"],
                "evidenceId": candidate["evidenceId"],
                "confidence": candidate["confidence"],
            }
            for index, candidate in enumerate(candidates, start=1)
        ],
    }
    policy_output = {
        "recordType": "automatic-private-route-policy-report",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "policyId": POLICY_ID,
        "decision": "approved-private-preview",
        "includedRouteCount": len(candidates),
        "omittedCount": len(omitted),
        "rules": [
            "Exact canonical place match required.",
            "Explicit biographical action required in the same sentence.",
            "Literary mentions alone do not create route events.",
            "No external model, OCR, or web result is used by this pass.",
        ],
    }
    map_output = {
        "recordType": "private-poet-map-draft",
        "schemaVersion": "1.0.0",
        "jobId": job["jobId"],
        "poet": {"id": job["poet"]["id"], "name": job["poet"]["name"]},
        "status": "empty-draft" if not candidates else "automatic-private-preview",
        "routePoints": event_output["events"],
        "summary": {
            "includedRouteCount": len(candidates),
            "omittedMentionCount": len(omitted),
            "placeResolutionCount": len(resolutions),
        },
        "limitations": [
            "Only exact canonical names from the current small published place catalogue are resolved.",
            "This private draft is not a public historical release and does not modify shared data.",
        ],
    }

    if dry_run:
        return {
            "jobId": job["jobId"],
            "dryRun": True,
            "status": map_output["status"],
            "includedRouteCount": len(candidates),
            "omittedMentionCount": len(omitted),
            "factPackageValidation": validation.payload(),
        }

    output_specs: tuple[tuple[str, dict[str, Any]], ...] = (
        ("02-resolve/place-resolutions.json", resolve_output),
        ("03-claims/fact-package.json", fact_package),
        ("03-claims/route-candidates.json", route_output),
        ("04-corpus/corpus-skip-report.json", corpus_output),
        ("05-enrichment/enrichment-skip-report.json", enrichment_output),
        ("06-events/map-events.json", event_output),
        ("07-review/auto-policy-report.json", policy_output),
        ("08-map/map-draft.json", map_output),
    )
    for relative_path, payload in output_specs:
        write_json_atomically(root / relative_path, payload)

    artifacts = [
        make_artifact(
            root,
            stage="resolve",
            artifact_id="resolve-places",
            record_type="place-resolution-set",
            relative_path="02-resolve/place-resolutions.json",
            parent_artifact_ids=("extract-segments",),
        ),
        make_artifact(
            root,
            stage="claims",
            artifact_id="claims-fact-package",
            record_type="poet-fact-package",
            relative_path="03-claims/fact-package.json",
            parent_artifact_ids=("resolve-places", "extract-segments"),
        ),
        make_artifact(
            root,
            stage="claims",
            artifact_id="claims-route-candidates",
            record_type="route-candidate-set",
            relative_path="03-claims/route-candidates.json",
            parent_artifact_ids=("claims-fact-package",),
        ),
        make_artifact(
            root,
            stage="corpus",
            artifact_id="corpus-skip-report",
            record_type="corpus-stage-report",
            relative_path="04-corpus/corpus-skip-report.json",
            parent_artifact_ids=("claims-route-candidates",),
        ),
        make_artifact(
            root,
            stage="enrichment",
            artifact_id="enrichment-skip-report",
            record_type="enrichment-stage-report",
            relative_path="05-enrichment/enrichment-skip-report.json",
            parent_artifact_ids=("claims-route-candidates",),
        ),
        make_artifact(
            root,
            stage="events",
            artifact_id="events-private-map",
            record_type="private-map-event-set",
            relative_path="06-events/map-events.json",
            parent_artifact_ids=("claims-fact-package", "claims-route-candidates"),
        ),
        make_artifact(
            root,
            stage="review",
            artifact_id="review-auto-policy",
            record_type="automatic-private-route-policy-report",
            relative_path="07-review/auto-policy-report.json",
            parent_artifact_ids=("events-private-map",),
        ),
        make_artifact(
            root,
            stage="map",
            artifact_id="map-private-draft",
            record_type="private-poet-map-draft",
            relative_path="08-map/map-draft.json",
            parent_artifact_ids=("events-private-map", "review-auto-policy"),
        ),
    ]
    complete_stages(
        job_path,
        stage_names=remaining,
        artifacts=artifacts,
        actor="build-biography-route-draft:v1",
        reason="Offline rules generated a private route draft and automatic policy report.",
        final_status="approved-private-preview",
    )
    return {
        "jobId": job["jobId"],
        "dryRun": False,
        "status": map_output["status"],
        "includedRouteCount": len(candidates),
        "omittedMentionCount": len(omitted),
        "mapPath": str(root / "08-map" / "map-draft.json"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True, help="Path to var/jobs/<job-id>/job.json.")
    parser.add_argument("--place-catalog", type=Path, default=DEFAULT_PLACE_CATALOG)
    parser.add_argument("--dry-run", action="store_true", help="Build and validate in memory without writing artifacts.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        outcome = build_route_draft(args.job, place_catalog=args.place_catalog, dry_run=args.dry_run)
    except RouteDraftError as exc:
        print(f"Route draft error: {exc}")
        return 1
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
