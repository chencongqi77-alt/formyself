#!/usr/bin/env python3
"""Run a private, evidence-first book analysis prototype.

The prototype keeps the existing job boundaries and adds a deliberately
conservative candidate pass:

    upload -> quarantine -> extract -> entities -> connections -> story cards
    -> validation -> private draft -> human review -> private release manifest

It is offline and rule based.  It does not call a model, search service or OCR
provider, and it never writes ``data/records``, ``data/derived``,
``data/published`` or ``web/public/data``.  Text and excerpts remain inside
the owning ``var/jobs/<job-id>`` directory.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

from extract_biography_text import DEFAULT_MAX_SEGMENT_CHARS, DEFAULT_QUARANTINE_ROOT, extract_job
from ingest_uploaded_source import DEFAULT_MAX_BYTES, IntakeError, ingest_file, inspect_upload
from poet_map_job import (
    DEFAULT_JOB_ROOT,
    DEFAULT_RAW_MANIFEST,
    DEFAULT_SOURCE_MANIFEST,
    build_job_manifest,
    complete_stages,
    file_sha256,
    generated_job_id,
    initialize_job,
    job_root_for_manifest,
    load_job,
    make_artifact,
    read_json,
    reference_snapshots,
    require_id,
    source_record,
    utc_now,
    validate_job_manifest,
    write_json_atomically,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLACE_CATALOG = PROJECT_ROOT / "data" / "published" / "places.json"
DEFAULT_PEOPLE_CATALOG = PROJECT_ROOT / "data" / "published" / "people.json"
DEFAULT_WORK_CATALOG = PROJECT_ROOT / "data" / "published" / "works.json"
PIPELINE_VERSION = "book-analysis-agent-prototype-v1"
SCHEMA_VERSION = "2.0.0-prototype"
PRIVATE_REVIEW_STATES = {"candidate-preview", "needs-review", "approved-private-preview", "rejected"}

SENTENCE_PATTERN = re.compile(r"[^。！？!?；;\n]+[。！？!?；;]?")
TITLE_PATTERN = re.compile(r"《([^》]{1,60})》")
YEAR_PATTERN = re.compile(r"公元\s*(-?\d{1,4})年")
ERA_PATTERN = re.compile(r"([\u3400-\u9fff]{1,8}(?:元年|[一二三四五六七八九十百千〇零]+年|年间))")
RELATIONSHIP_CUES = re.compile(r"(?:与|赠|寄|答|和|同游|交游|师从|门下|为友|荐|书信|往来|会于|同僚|唱和)")
LITERARY_CONTEXT = re.compile(r"(?:作于|写于|题[于写]?|诗|词|赋|书|赠|送|怀|望|梦|吟咏|写作)")
TEACHER_CUES = re.compile(r"(?:师从|门下|受业|弟子|师生|教授)")
LITERARY_CUES = re.compile(r"(?:诗|词|文|赋|赠|寄|答|和|唱和|书信)")
OFFICIAL_CUES = re.compile(r"(?:同僚|任职|为官|朝廷|政务|荐|幕府)")
FRIENDSHIP_CUES = re.compile(r"(?:交游|为友|同游|相识|友人|往来)")

ACTION_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("born-at", re.compile(r"(?:出生(?:于|在)|生于|生在|诞生(?:于|在))")),
    ("died-at", re.compile(r"(?:逝世(?:于|在)|病逝(?:于|在)|卒于|死于)")),
    ("exiled-to", re.compile(r"(?:贬(?:至|谪)|贬谪(?:至|于|在)?|谪(?:居|至|于|在)|流放(?:至|于|在))")),
    ("held-office-at", re.compile(r"(?:出任|任职|担任|为官|授(?:任|官)|知(?:府|州|县)|守(?:府|州|县))")),
    ("resided-at", re.compile(r"(?:寓居|旅居|定居|迁居|居住|居于|居在|住于|住在|卜居)")),
    ("stayed-at", re.compile(r"(?:留居|停留|驻留|驻于|驻在|寄居)")),
    ("traveled-to", re.compile(r"(?:游历|游于|抵达|到达|前往|赴(?:任|京|[\u3400-\u9fff])|过访|拜访|行至|至(?:于|[\u3400-\u9fff])|入(?:京|[\u3400-\u9fff]))")),
)


class BookAgentError(ValueError):
    """Raised when the private book-agent workflow cannot advance safely."""


def stable_id(prefix: str, *parts: object) -> str:
    seed = "|".join(str(part) for part in parts)
    return f"{prefix}-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]


def slug(value: str, fallback: str) -> str:
    ascii_value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return ascii_value or fallback


def read_json_file(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BookAgentError(f"{label} cannot be read as UTF-8 JSON: {path}") from exc


def names_for(record: dict[str, Any], canonical: str) -> list[str]:
    values = [record.get(canonical)]
    aliases = record.get("aliases") if isinstance(record.get("aliases"), list) else []
    historical = record.get("historicalNames") if isinstance(record.get("historicalNames"), list) else []
    return [value for value in [*values, *aliases, *historical] if isinstance(value, str) and value.strip()]


def first_mention(text: str, names: Iterable[str]) -> tuple[int, int, str] | None:
    found: tuple[int, int, str] | None = None
    for name in sorted({value for value in names if value}, key=len, reverse=True):
        offset = text.find(name)
        if offset < 0:
            continue
        candidate = (offset, offset + len(name), name)
        if found is None or candidate[0] < found[0] or (candidate[0] == found[0] and len(candidate[2]) > len(found[2])):
            found = candidate
    return found


def spans_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    spans: list[dict[str, Any]] = []
    for segment in segments:
        text = segment.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        base_offset = segment.get("charStart") if isinstance(segment.get("charStart"), int) else 0
        matches = list(SENTENCE_PATTERN.finditer(text))
        if not matches:
            matches = [re.match(r"[\s\S]+", text)]  # type: ignore[list-item]
        for match in matches:
            if match is None:
                continue
            raw = match.group().strip()
            if not raw:
                continue
            left_trim = len(match.group()) - len(match.group().lstrip())
            start = match.start() + left_trim
            end = start + len(raw)
            spans.append(
                {
                    "segment": segment,
                    "text": raw,
                    "startOffset": base_offset + start,
                    "endOffset": base_offset + end,
                    "ordinal": len(spans) + 1,
                }
            )
    return spans


def evidence_record(
    *,
    evidence_id: str,
    span: dict[str, Any],
    source_file_id: str,
    job_id: str,
    support: str = "direct",
) -> dict[str, Any]:
    segment = span["segment"]
    locator: dict[str, Any] = {
        "kind": "text-span",
        "segmentId": segment.get("id"),
        "startOffset": span["startOffset"],
        "endOffset": span["endOffset"],
        "label": f"第 {span['ordinal']} 个文本片段",
    }
    if isinstance(segment.get("page"), int):
        locator["page"] = segment["page"]
    return {
        "id": evidence_id,
        "sourceFileId": source_file_id,
        "locator": locator,
        "support": support,
        "excerptSha256": hashlib.sha256(span["text"].encode("utf-8")).hexdigest(),
        "createdByJobId": job_id,
    }


def time_qualifier(text: str, sequence: int) -> dict[str, Any]:
    year = YEAR_PATTERN.search(text)
    if year:
        value = int(year.group(1))
        return {"precision": "year", "label": year.group(0), "startYear": value, "endYear": value}
    era = ERA_PATTERN.search(text)
    if era:
        return {"precision": "unknown", "label": era.group(1)}
    return {"precision": "sequence-only", "label": f"文中第 {sequence} 个候选"}


def relationship_types(text: str) -> list[str]:
    values: list[str] = []
    if TEACHER_CUES.search(text):
        values.append("teacher-student")
    if LITERARY_CUES.search(text):
        values.append("literary-exchange")
    if OFFICIAL_CUES.search(text):
        values.append("official")
    if FRIENDSHIP_CUES.search(text):
        values.append("friendship")
    return values or ["other"]


def story_summary(kind: str, title: str) -> str:
    if kind == "journey":
        return f"{title}来自书内生平动作与地点的同句候选；它是自动整理的行迹线索，仍需人工回读原文。"
    if kind == "place":
        return f"{title}来自书内作品与地点的并置或地点关系线索；作品空间不自动等同于人物到访。"
    return f"{title}来自书内人物同句往来线索；这是待审核的关系阅读卡，不独立构成历史事实。"


def draft_validation(draft: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []

    def error(code: str, message: str, path: str) -> None:
        issues.append({"severity": "error", "code": code, "message": message, "path": path})

    def warning(code: str, message: str, path: str) -> None:
        issues.append({"severity": "warning", "code": code, "message": message, "path": path})

    if draft.get("recordType") != "private-poet-volume-bundle":
        error("record-type", "recordType 必须是 private-poet-volume-bundle。", "recordType")
    if draft.get("schemaVersion") != SCHEMA_VERSION:
        error("schema-version", f"schemaVersion 必须是 {SCHEMA_VERSION}。", "schemaVersion")
    access = draft.get("access") if isinstance(draft.get("access"), dict) else {}
    if access.get("visibility") != "private" or access.get("publicationState") != "not-submitted":
        error("publication-boundary", "draft 必须保持 private / not-submitted。", "access")

    evidence = {item.get("id"): item for item in draft.get("evidence", []) if isinstance(item, dict)}
    people = {item.get("id"): item for item in draft.get("entities", {}).get("people", []) if isinstance(item, dict)}
    places = {item.get("id"): item for item in draft.get("entities", {}).get("places", []) if isinstance(item, dict)}
    works = {item.get("id"): item for item in draft.get("entities", {}).get("works", []) if isinstance(item, dict)}
    stories = {item.get("id"): item for item in draft.get("storyCards", []) if isinstance(item, dict)}

    def check_evidence(ids: Any, path: str, direct: bool = False) -> None:
        if not isinstance(ids, list) or not ids:
            error("missing-evidence", "每个可见候选至少需要一个 evidenceId。", path)
            return
        for evidence_id in ids:
            record = evidence.get(evidence_id)
            if record is None:
                error("evidence-ref-missing", f"找不到 evidenceId {evidence_id}。", path)
            elif direct and record.get("support") != "direct":
                error("evidence-not-direct", "连接和故事卡必须绑定 direct 证据。", path)

    entities = draft.get("entities") if isinstance(draft.get("entities"), dict) else {}
    for collection_name in ("people", "places", "works"):
        for index, entity in enumerate(entities.get(collection_name, [])):
            if isinstance(entity, dict):
                check_evidence(entity.get("evidenceIds"), f"entities.{collection_name}[{index}].evidenceIds")

    volumes = draft.get("volumes") if isinstance(draft.get("volumes"), dict) else {}
    journey = volumes.get("journey") if isinstance(volumes.get("journey"), dict) else {}
    for index, item in enumerate(journey.get("items", [])):
        if not isinstance(item, dict):
            continue
        path = f"volumes.journey.items[{index}]"
        if item.get("placeId") not in places:
            error("journey-place-missing", "行迹引用了不存在的地点。", path)
        place = places.get(item.get("placeId")) or {}
        if item.get("mapEligible") and (place.get("resolutionState") != "resolved" or place.get("mapKind") == "none"):
            error("journey-map-place", "只有已解析且可定位的地点才能上图。", path)
        check_evidence(item.get("evidenceIds"), f"{path}.evidenceIds", direct=True)
        for story_id in item.get("storyIds", []):
            if story_id not in stories:
                error("journey-story-missing", "行迹引用了不存在的故事卡。", path)

    poem_world = volumes.get("poemWorld") if isinstance(volumes.get("poemWorld"), dict) else {}
    for index, item in enumerate(poem_world.get("items", [])):
        if not isinstance(item, dict):
            continue
        path = f"volumes.poemWorld.items[{index}]"
        if item.get("workId") not in works:
            error("poem-work-missing", "诗境引用了不存在的作品。", path)
        if item.get("kind") == "place-link" and item.get("placeId") not in places:
            error("poem-place-missing", "place-link 必须引用已识别地点。", path)
        check_evidence(item.get("evidenceIds"), f"{path}.evidenceIds", direct=True)
        for story_id in item.get("storyIds", []):
            if story_id not in stories:
                error("poem-story-missing", "诗境引用了不存在的故事卡。", path)

    social = volumes.get("social") if isinstance(volumes.get("social"), dict) else {}
    for index, edge in enumerate(social.get("edges", [])):
        if not isinstance(edge, dict):
            continue
        path = f"volumes.social.edges[{index}]"
        if edge.get("sourcePersonId") not in people or edge.get("targetPersonId") not in people:
            error("social-person-missing", "关系边两端必须是已识别人物。", path)
        if edge.get("sourcePersonId") == edge.get("targetPersonId"):
            error("social-self-edge", "关系边不能连接同一人物。", path)
        check_evidence(edge.get("evidenceIds"), f"{path}.evidenceIds", direct=True)
        for story_id in edge.get("storyIds", []):
            if story_id not in stories:
                error("social-story-missing", "关系边引用了不存在的故事卡。", path)

    for index, card in enumerate(draft.get("storyCards", [])):
        if not isinstance(card, dict):
            continue
        path = f"storyCards[{index}]"
        check_evidence(card.get("evidenceIds"), f"{path}.evidenceIds", direct=True)
        for anchor in card.get("anchorRefs", []):
            if not isinstance(anchor, dict):
                continue
            table = people if anchor.get("type") == "person" else places if anchor.get("type") == "place" else works
            if anchor.get("id") not in table:
                error("anchor-ref-missing", "故事卡的 anchorRef 找不到对应实体。", path)
        if card.get("disclaimerCode") != "not-independent-historical-fact":
            error("story-disclaimer", "故事卡必须声明不是独立历史事实。", path)

    if not evidence:
        warning("no-evidence", "草稿没有生成证据。", "evidence")
    if any(item.get("resolutionState") != "resolved" for item in people.values()):
        warning("candidate-person", "存在尚未完成身份消歧的人物候选。", "entities.people")
    if any(item.get("discoveryState") != "matched" for item in works.values()):
        warning("candidate-work", "存在尚未与作品目录匹配的作品候选。", "entities.works")
    return {
        "recordType": "book-analysis-validation-report",
        "schemaVersion": "0.1.0",
        "valid": not any(item["severity"] == "error" for item in issues),
        "errorCount": sum(item["severity"] == "error" for item in issues),
        "warningCount": sum(item["severity"] == "warning" for item in issues),
        "issues": issues,
    }


def build_draft(
    *,
    job: dict[str, Any],
    segments: list[dict[str, Any]],
    book_title: str,
    poet_id: str,
    poet_name: str,
    file_name: str,
    file_sha256_value: str,
    people_catalog: list[dict[str, Any]],
    place_catalog: list[dict[str, Any]],
    work_catalog: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Build the v2-shaped private bundle and its stage reports."""
    job_id = job["jobId"]
    source_file_id = f"book-file-{file_sha256_value[:16]}"
    book_id = slug(book_title.strip(), f"book-{file_sha256_value[:12]}")
    package_id = f"bpm-{book_id}-{file_sha256_value[:8]}"[:90]
    bundle_id = f"ppvb-{book_id}-{file_sha256_value[:8]}"[:100]
    spans = spans_from_segments(segments)

    people_by_id = {item.get("id"): item for item in people_catalog if isinstance(item, dict) and isinstance(item.get("id"), str)}
    places_by_id = {item.get("id"): item for item in place_catalog if isinstance(item, dict) and isinstance(item.get("id"), str)}
    works_by_id = {item.get("id"): item for item in work_catalog if isinstance(item, dict) and isinstance(item.get("id"), str)}

    entity_people: dict[str, dict[str, Any]] = {}
    entity_places: dict[str, dict[str, Any]] = {}
    entity_works: dict[str, dict[str, Any]] = {}
    evidence: dict[str, dict[str, Any]] = {}
    story_cards: list[dict[str, Any]] = []
    journey_items: list[dict[str, Any]] = []
    poem_items: list[dict[str, Any]] = []
    social_edges: list[dict[str, Any]] = []
    spotlights: dict[str, set[str]] = {}

    def ensure_evidence(kind: str, span: dict[str, Any], support: str = "direct", extra: str = "") -> str:
        evidence_id = stable_id("ev", job_id, kind, span["startOffset"], span["endOffset"], extra)
        if evidence_id not in evidence:
            evidence[evidence_id] = evidence_record(
                evidence_id=evidence_id,
                span=span,
                source_file_id=source_file_id,
                job_id=job_id,
                support=support,
            )
        return evidence_id

    def mention_records(span: dict[str, Any], records: list[dict[str, Any]], canonical: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for record in records:
            mention = first_mention(span["text"], names_for(record, canonical))
            if mention:
                values.append({**record, "matchedName": mention[2]})
        return sorted(values, key=lambda item: len(item["matchedName"]), reverse=True)

    first_span = spans[0] if spans else {
        "segment": {"id": "seg-empty"},
        "text": "",
        "startOffset": 0,
        "endOffset": 0,
        "ordinal": 1,
    }
    poet_person = people_by_id.get(poet_id)
    poet_mention = first_mention(first_span["text"], [poet_name, *names_for(poet_person or {}, "name")])
    poet_span = dict(first_span)
    if poet_mention:
        poet_span["startOffset"] = first_span["startOffset"] + poet_mention[0]
        poet_span["endOffset"] = first_span["startOffset"] + poet_mention[1]
        poet_span["text"] = poet_mention[2]
    poet_evidence = ensure_evidence("poet-identity", poet_span, "direct" if poet_mention else "context", poet_id)
    entity_people[poet_id] = {
        "id": poet_id,
        "name": poet_name,
        "aliases": poet_person.get("aliases", []) if isinstance(poet_person, dict) else [],
        "resolutionState": "resolved" if poet_person else "candidate",
        "evidenceIds": [poet_evidence],
    }

    for span in spans:
        mentioned_people = mention_records(span, people_catalog, "name")
        for person in mentioned_people:
            person_id = person["id"]
            if person_id not in entity_people:
                entity_people[person_id] = {
                    "id": person_id,
                    "name": person.get("name", person_id),
                    "aliases": person.get("aliases", []),
                    "resolutionState": "resolved",
                    "evidenceIds": [ensure_evidence("person-mention", span, extra=person_id)],
                }

        mentioned_places = mention_records(span, place_catalog, "name")
        for place in mentioned_places:
            place_id = place["id"]
            if place_id in entity_places:
                continue
            coordinates = place.get("sourceCoordinates") if isinstance(place.get("sourceCoordinates"), dict) else {}
            has_coordinate = isinstance(coordinates.get("x"), (int, float)) and isinstance(coordinates.get("y"), (int, float))
            place_entity = {
                "id": place_id,
                "label": place.get("name", place_id),
                "historicalNames": place.get("historicalNames", []),
                "resolutionState": "resolved",
                "mapKind": "point" if has_coordinate else "region",
                "evidenceIds": [ensure_evidence("place-mention", span, extra=place_id)],
            }
            if isinstance(place.get("modernName"), str) and place["modernName"].strip():
                place_entity["modernName"] = place["modernName"]
            if has_coordinate:
                place_entity["coordinate"] = {
                    "x": coordinates["x"],
                    "y": coordinates["y"],
                    "precision": "display-only",
                }
            entity_places[place_id] = place_entity

        mentioned_works = mention_records(span, work_catalog, "title")
        for work in mentioned_works:
            author_id = work.get("personId")
            if isinstance(author_id, str) and author_id not in entity_people:
                author = people_by_id.get(author_id)
                if isinstance(author, dict):
                    entity_people[author_id] = {
                        "id": author_id,
                        "name": author.get("name", author_id),
                        "aliases": author.get("aliases", []),
                        "resolutionState": "resolved",
                        "evidenceIds": [ensure_evidence("work-author-context", span, "context", author_id)],
                    }
            work_id = work["id"]
            if work_id not in entity_works:
                work_entity = {
                    "id": work_id,
                    "title": work.get("title", work_id),
                    "discoveryState": "matched",
                    "evidenceIds": [ensure_evidence("work-mention", span, extra=work_id)],
                }
                if isinstance(work.get("personId"), str):
                    work_entity["authorPersonId"] = work["personId"]
                if isinstance(work.get("genre"), str) and work["genre"].strip():
                    work_entity["genre"] = work["genre"]
                entity_works[work_id] = work_entity
        for title_match in TITLE_PATTERN.finditer(span["text"]):
            title = title_match.group(1).strip()
            if not title or any(work.get("title") == title for work in work_catalog):
                continue
            extracted_id = stable_id("work", job_id, title)
            entity_works.setdefault(
                extracted_id,
                {
                    "id": extracted_id,
                    "title": title,
                    "discoveryState": "extracted-title",
                    "evidenceIds": [ensure_evidence("extracted-work-title", span, extra=title)],
                },
            )

        action_candidates: list[tuple[int, str]] = []
        for predicate, pattern in ACTION_RULES:
            match = pattern.search(span["text"])
            if match:
                action_candidates.append((match.start(), predicate))
        action = min(action_candidates, key=lambda item: item[0]) if action_candidates else None
        for place in mentioned_places:
            if action is None:
                continue
            place_id = place["id"]
            item_id = stable_id("journey", job_id, span["startOffset"], place_id, action[1])
            if any(item.get("id") == item_id for item in journey_items):
                continue
            evidence_id = ensure_evidence("journey-candidate", span, extra=f"{place_id}|{action[1]}")
            story_id = stable_id("story", job_id, "journey", item_id)
            story_cards.append(
                {
                    "id": story_id,
                    "kind": "journey",
                    "title": f"{entity_places[place_id]['label']} · {action[1]}",
                    "summary": story_summary("journey", f"{poet_name}与{entity_places[place_id]['label']}"),
                    "claimType": "fact",
                    "anchorRefs": [{"type": "person", "id": poet_id}, {"type": "place", "id": place_id}],
                    "evidenceIds": [evidence_id],
                    "reviewState": "needs-review",
                    "disclaimerCode": "not-independent-historical-fact",
                }
            )
            journey_items.append(
                {
                    "id": item_id,
                    "placeId": place_id,
                    "predicate": action[1],
                    "sequence": len(journey_items) + 1,
                    "time": time_qualifier(span["text"], len(journey_items) + 1),
                    "storyIds": [story_id],
                    "mapEligible": entity_places[place_id]["mapKind"] != "none",
                    "evidenceIds": [evidence_id],
                    "reviewState": "needs-review",
                }
            )

        for work in mentioned_works:
            for place in mentioned_places:
                work_id = work["id"]
                place_id = place["id"]
                relation_type = (
                    "composed-at" if re.search(r"(?:作于|写于)", span["text"])
                    else "inscribed-at" if re.search(r"(?:题于|题写|刻于)", span["text"])
                    else "describes-place" if LITERARY_CONTEXT.search(span["text"])
                    else "mentioned-place"
                )
                item_id = stable_id("poem", job_id, span["startOffset"], work_id, place_id, relation_type)
                if any(item.get("id") == item_id for item in poem_items):
                    continue
                evidence_id = ensure_evidence("poem-world-candidate", span, extra=f"{work_id}|{place_id}")
                story_id = stable_id("story", job_id, "place", item_id)
                anchors = [{"type": "place", "id": place_id}, {"type": "work", "id": work_id}]
                if isinstance(work.get("personId"), str):
                    anchors.append({"type": "person", "id": work["personId"]})
                story_cards.append(
                    {
                        "id": story_id,
                        "kind": "place",
                        "title": f"《{entity_works[work_id]['title']}》 · {entity_places[place_id]['label']}",
                        "summary": story_summary("place", f"《{entity_works[work_id]['title']}》与{entity_places[place_id]['label']}"),
                        "claimType": "interpretation",
                        "anchorRefs": anchors,
                        "evidenceIds": [evidence_id],
                        "reviewState": "needs-review",
                        "disclaimerCode": "not-independent-historical-fact",
                    }
                )
                poem_items.append(
                    {
                        "id": item_id,
                        "kind": "place-link",
                        "workId": work_id,
                        "placeId": place_id,
                        "relationType": relation_type,
                        "storyIds": [story_id],
                        "evidenceIds": [evidence_id],
                        "reviewState": "needs-review",
                    }
                )
                spotlights.setdefault(place_id, set()).add(story_id)

        if len(mentioned_people) >= 2 and RELATIONSHIP_CUES.search(span["text"]):
            for left_index, left in enumerate(mentioned_people):
                for right in mentioned_people[left_index + 1:]:
                    left_id = left["id"]
                    right_id = right["id"]
                    if left_id == right_id:
                        continue
                    edge_id = stable_id("edge", job_id, span["startOffset"], left_id, right_id)
                    if any(edge.get("id") == edge_id for edge in social_edges):
                        continue
                    evidence_id = ensure_evidence("social-candidate", span, extra=f"{left_id}|{right_id}")
                    story_id = stable_id("story", job_id, "relationship", edge_id)
                    place_ids = [place["id"] for place in mentioned_places]
                    work_ids = [work["id"] for work in mentioned_works]
                    story_cards.append(
                        {
                            "id": story_id,
                            "kind": "relationship",
                            "title": f"{left.get('name', left_id)}与{right.get('name', right_id)} · 往来线索",
                            "summary": story_summary("relationship", f"{left.get('name', left_id)}与{right.get('name', right_id)}"),
                            "claimType": "fact",
                            "anchorRefs": [
                                {"type": "person", "id": left_id},
                                {"type": "person", "id": right_id},
                                *[{"type": "place", "id": place_id} for place_id in place_ids],
                                *[{"type": "work", "id": work_id} for work_id in work_ids],
                            ],
                            "evidenceIds": [evidence_id],
                            "reviewState": "needs-review",
                            "disclaimerCode": "not-independent-historical-fact",
                        }
                    )
                    social_edges.append(
                        {
                            "id": edge_id,
                            "sourcePersonId": left_id,
                            "targetPersonId": right_id,
                            "relationTypes": relationship_types(span["text"]),
                            "time": time_qualifier(span["text"], len(social_edges) + 1),
                            "placeIds": place_ids,
                            "workIds": work_ids,
                            "storyIds": [story_id],
                            "evidenceIds": [evidence_id],
                            "reviewState": "needs-review",
                        }
                    )

    limitations = [
        "这是离线候选抽取：只使用现有 canonical 人物、地点、作品目录和规则，不调用外部模型或搜索。",
        "所有候选默认需要人工回读；作品—地点关系不自动推出人物到访，关系卡不独立构成历史事实。",
        "未识别的同名人物、历史地名和未进入目录的作品会留在原文中，不会被猜测补齐。",
    ]
    if not journey_items:
        limitations.append("没有发现满足“地点 + 明确生平动作”的行迹候选。")
    if not poem_items:
        limitations.append("没有发现同时包含目录作品和地点的诗境候选。")
    if not social_edges:
        limitations.append("没有发现同时包含两位目录人物和明确往来触发词的关系候选。")

    draft: dict[str, Any] = {
        "recordType": "private-poet-volume-bundle",
        "schemaVersion": SCHEMA_VERSION,
        "bundleId": bundle_id,
        "jobId": job_id,
        "createdAt": utc_now(),
        "access": {"visibility": "private", "publicationState": "not-submitted"},
        "reviewState": "needs-review",
        "source": {
            "bookId": book_id,
            "bookTitle": book_title.strip(),
            "packageId": package_id,
            "packageSha256": file_sha256_value,
            "packageOwnerJobId": job_id,
        },
        "poet": {
            "id": poet_id,
            "name": poet_name.strip(),
            "identityState": "resolved" if poet_person else "candidate",
        },
        "evidence": list(evidence.values()),
        "entities": {
            "people": list(entity_people.values()),
            "places": list(entity_places.values()),
            "works": list(entity_works.values()),
        },
        "storyCards": story_cards,
        "volumes": {
            "journey": {
                "state": "ready" if journey_items else "empty",
                "routeSemantics": "narrative-sequence-not-exact-route",
                "items": journey_items,
                "limitations": ["只纳入同句出现明确生平动作的地点；诗题和诗句地点不会反推行迹。"],
            },
            "poemWorld": {
                "state": "ready" if poem_items else "empty",
                "items": poem_items,
                "spotlights": [{"placeId": place_id, "storyIds": sorted(story_ids)} for place_id, story_ids in spotlights.items()],
                "limitations": ["作品—地点连接表示作品空间语义，不自动等同于创作地或人物到访。"],
            },
            "social": {
                "state": "ready" if social_edges else "empty",
                "edges": social_edges,
                "limitations": ["只有同一文本片段出现两位目录人物和往来触发词时才生成关系候选。"],
            },
        },
        "limitations": limitations,
    }
    validation = draft_validation(draft)
    stage_reports = {
        "resolve": {
            "recordType": "book-agent-entity-candidates",
            "schemaVersion": "0.1.0",
            "jobId": job_id,
            "sourceFileId": source_file_id,
            "peopleCount": len(entity_people),
            "placeCount": len(entity_places),
            "workCount": len(entity_works),
            "matcher": "exact-canonical-name-and-title-v1",
        },
        "claims": {
            "recordType": "book-agent-evidence-candidates",
            "schemaVersion": "0.1.0",
            "jobId": job_id,
            "evidenceCount": len(evidence),
            "binding": "evidenceIds-and-anchorRefs-v2-prototype",
        },
        "events": {
            "recordType": "book-agent-three-volume-candidates",
            "schemaVersion": "0.1.0",
            "jobId": job_id,
            "journeyCount": len(journey_items),
            "poemWorldCount": len(poem_items),
            "socialCount": len(social_edges),
            "storyCardCount": len(story_cards),
            "sourceFileName": file_name,
        },
    }
    return draft, validation, stage_reports


def write_stage_artifacts(
    *,
    job_path: Path,
    draft: dict[str, Any],
    validation: dict[str, Any],
    stage_reports: dict[str, dict[str, Any]],
    dry_run: bool = False,
) -> dict[str, str]:
    root = job_root_for_manifest(job_path, load_job(job_path))
    payloads: dict[str, tuple[str, dict[str, Any]]] = {
        "02-resolve/entities.json": ("book-agent-entity-candidates", stage_reports["resolve"] | {"entities": draft["entities"]}),
        "03-claims/evidence.json": ("book-agent-evidence-candidates", stage_reports["claims"] | {"evidence": draft["evidence"]}),
        "03-claims/connections.json": (
            "book-agent-connection-candidates",
            {
                "recordType": "book-agent-connection-candidates",
                "schemaVersion": "0.1.0",
                "jobId": draft["jobId"],
                "journey": draft["volumes"]["journey"]["items"],
                "poemWorld": draft["volumes"]["poemWorld"]["items"],
                "social": draft["volumes"]["social"]["edges"],
            },
        ),
        "04-corpus/corpus-stage-report.json": (
            "book-agent-corpus-stage-report",
            {
                "recordType": "book-agent-corpus-stage-report",
                "schemaVersion": "0.1.0",
                "jobId": draft["jobId"],
                "status": "not-run",
                "reason": "Prototype only matches the current published works catalogue; it does not infer an unindexed poem from a place name.",
            },
        ),
        "05-enrichment/enrichment-stage-report.json": (
            "book-agent-enrichment-stage-report",
            {
                "recordType": "book-agent-enrichment-stage-report",
                "schemaVersion": "0.1.0",
                "jobId": draft["jobId"],
                "status": "not-run",
                "reason": "No external model, web search, OCR or third-party enrichment provider is enabled by this prototype.",
            },
        ),
        "06-events/story-cards.json": ("book-agent-story-card-candidates", stage_reports["events"] | {"storyCards": draft["storyCards"]}),
        "07-review/validation-report.json": ("book-agent-validation-report", validation),
        "08-map/draft.json": ("private-poet-volume-bundle", draft),
    }
    if dry_run:
        return {relative_path: str(root / relative_path) for relative_path in payloads}
    existing = [root / relative_path for relative_path in payloads if (root / relative_path).exists()]
    if existing:
        raise BookAgentError(
            "The job already contains book-agent artifacts; refusing to overwrite: "
            + ", ".join(str(path.relative_to(root)) for path in existing)
        )
    artifacts: list[dict[str, Any]] = []
    artifact_ids = {
        relative_path: "book-agent-" + relative_path.replace("/", "-").replace(".json", "")
        for relative_path in payloads
    }
    for relative_path, (record_type, payload) in payloads.items():
        target = root / relative_path
        write_json_atomically(target, payload)
        artifact_id = artifact_ids[relative_path]
        parents = ("extract-segments",)
        if relative_path == "02-resolve/entities.json":
            parents = ("extract-segments",)
        elif relative_path.startswith("03-claims"):
            parents = (artifact_ids["02-resolve/entities.json"], "extract-segments")
        elif relative_path.startswith(("04-corpus", "05-enrichment")):
            parents = (artifact_ids["03-claims/connections.json"],)
        elif relative_path.startswith("06-events"):
            parents = (artifact_ids["03-claims/connections.json"],)
        elif relative_path.startswith("07-review"):
            parents = (artifact_ids["06-events/story-cards.json"], artifact_ids["03-claims/connections.json"])
        elif relative_path.startswith("08-map"):
            parents = (artifact_ids["07-review/validation-report.json"], artifact_ids["06-events/story-cards.json"])
        artifacts.append(
            make_artifact(
                root,
                stage={
                    "02-resolve": "resolve",
                    "03-claims": "claims",
                    "04-corpus": "corpus",
                    "05-enrichment": "enrichment",
                    "06-events": "events",
                    "07-review": "review",
                    "08-map": "map",
                }[relative_path.split("/", 1)[0]],
                artifact_id=artifact_id,
                record_type=record_type,
                relative_path=relative_path,
                parent_artifact_ids=parents,
            )
        )
    complete_stages(
        job_path,
        stage_names=("resolve", "claims", "corpus", "enrichment", "events", "review", "map"),
        artifacts=artifacts,
        actor=f"{PIPELINE_VERSION}",
        reason="Generated private entity, evidence, three-volume and story-card candidates; awaiting human review.",
        final_status="awaiting-review",
    )
    return {relative_path: str(root / relative_path) for relative_path in payloads}


def run_book_analysis(
    *,
    input_path: Path,
    book_title: str,
    poet_id: str,
    poet_name: str,
    data_processing_consent: bool,
    source_id: str | None = None,
    job_id: str | None = None,
    quarantine_root: Path = DEFAULT_QUARANTINE_ROOT,
    job_root: Path = DEFAULT_JOB_ROOT,
    raw_manifest: Path = DEFAULT_RAW_MANIFEST,
    source_manifest: Path = DEFAULT_SOURCE_MANIFEST,
    max_upload_bytes: int = DEFAULT_MAX_BYTES,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
    people_catalog_path: Path = DEFAULT_PEOPLE_CATALOG,
    place_catalog_path: Path = DEFAULT_PLACE_CATALOG,
    work_catalog_path: Path = DEFAULT_WORK_CATALOG,
) -> dict[str, Any]:
    require_id(poet_id, "poet id")
    if not book_title.strip() or not poet_name.strip():
        raise BookAgentError("Book title and poet name are required.")
    if not data_processing_consent:
        raise BookAgentError("Data-processing consent is required for a private book job.")
    inspection = inspect_upload(input_path, max_bytes=max_upload_bytes)
    digest = file_sha256(inspection["inputPath"])
    actual_source_id = source_id or f"upload-book-{digest[:12]}"
    receipt_outcome = ingest_file(
        input_path,
        source_id=actual_source_id,
        quarantine_root=quarantine_root,
        max_bytes=max_upload_bytes,
    )
    receipt = receipt_outcome["receipt"]
    actual_job_id = job_id or generated_job_id(utc_now())
    source = source_record(actual_source_id, source_manifest)
    job = build_job_manifest(
        job_id=actual_job_id,
        created_at=utc_now(),
        poet_id=poet_id,
        poet_name=poet_name,
        source_id=actual_source_id,
        input_sha256=receipt["sha256"],
        content_type=receipt["detectedContentType"],
        access_level="quarantine",
        data_processing_consent=True,
        external_transfer_consent=False,
        allow_external_providers=False,
        max_api_requests=0,
        max_tokens=None,
        max_cost_cny=None,
        publication_mode="human-review",
        source=source,
        snapshots=reference_snapshots(raw_manifest, source_manifest),
    )
    job_directory = initialize_job(job_root, job)
    job_path = job_directory / "job.json"
    extraction = extract_job(
        job_path,
        quarantine_root=quarantine_root,
        max_segment_chars=max_segment_chars,
    )
    base = {
        "jobId": actual_job_id,
        "jobPath": str(job_path),
        "sourceId": actual_source_id,
        "quarantinePath": receipt_outcome["quarantinePath"],
        "inputContentType": receipt["detectedContentType"],
        "extraction": extraction,
    }
    if not extraction["completed"]:
        return {**base, "completed": False, "status": extraction["status"]}
    root = job_directory
    segments_path = root / "01-extract" / "segments.jsonl"
    segments = [json.loads(line) for line in segments_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    draft, validation, stage_reports = build_draft(
        job=load_job(job_path),
        segments=segments,
        book_title=book_title,
        poet_id=poet_id,
        poet_name=poet_name,
        file_name=input_path.name,
        file_sha256_value=receipt["sha256"],
        people_catalog=read_json_file(people_catalog_path, "People catalogue"),
        place_catalog=read_json_file(place_catalog_path, "Place catalogue"),
        work_catalog=read_json_file(work_catalog_path, "Work catalogue"),
    )
    artifacts = write_stage_artifacts(job_path=job_path, draft=draft, validation=validation, stage_reports=stage_reports)
    return {
        **base,
        "completed": True,
        "status": "awaiting-review",
        "draftPath": artifacts["08-map/draft.json"],
        "validationPath": artifacts["07-review/validation-report.json"],
        "summary": {
            "people": len(draft["entities"]["people"]),
            "places": len(draft["entities"]["places"]),
            "works": len(draft["entities"]["works"]),
            "journey": len(draft["volumes"]["journey"]["items"]),
            "poemWorld": len(draft["volumes"]["poemWorld"]["items"]),
            "social": len(draft["volumes"]["social"]["edges"]),
            "storyCards": len(draft["storyCards"]),
            "evidence": len(draft["evidence"]),
            "validation": validation,
        },
    }


def update_job_status(job_path: Path, *, status: str, actor: str, reason: str) -> dict[str, Any]:
    job = load_job(job_path)
    root = job_root_for_manifest(job_path, job)
    next_job = copy.deepcopy(job)
    previous = next_job["status"]
    next_job["status"] = status
    next_job["transitions"].append({"at": utc_now(), "from": previous, "to": status, "actor": actor, "reason": reason})
    validation = validate_job_manifest(next_job, artifact_root=root)
    if not validation.valid:
        details = "; ".join(f"{item.code}: {item.message}" for item in validation.errors)
        raise BookAgentError(f"Refusing to update job status: {details}")
    write_json_atomically(job_path, next_job)
    return next_job


def approve_job(job_path: Path, *, reviewer: str, notes: str) -> dict[str, Any]:
    job = load_job(job_path)
    if job.get("status") != "awaiting-review":
        raise BookAgentError("Only an awaiting-review job can be approved.")
    root = job_root_for_manifest(job_path, job)
    draft_path = root / "08-map" / "draft.json"
    report_path = root / "07-review" / "validation-report.json"
    draft = read_json_file(draft_path, "Private draft")
    report = read_json_file(report_path, "Validation report")
    if not report.get("valid"):
        raise BookAgentError("The draft has validation errors; fix the job or reject it before approval.")
    approved_draft = copy.deepcopy(draft)
    for collection in (
        approved_draft["volumes"]["journey"]["items"],
        approved_draft["volumes"]["poemWorld"]["items"],
        approved_draft["volumes"]["social"]["edges"],
        approved_draft["storyCards"],
    ):
        for record in collection:
            if record.get("reviewState") != "rejected":
                record["reviewState"] = "approved-private-preview"
    approved_draft["reviewState"] = "approved-private-preview"
    human_review = {
        "recordType": "book-agent-human-review",
        "schemaVersion": "0.1.0",
        "jobId": job["jobId"],
        "state": "approved-private-preview",
        "reviewer": reviewer,
        "reviewedAt": utc_now(),
        "notes": notes,
    }
    human_review_path = root / "07-review" / "human-review.json"
    approved_draft_path = root / "08-map" / "approved-draft.json"
    if human_review_path.exists() or approved_draft_path.exists():
        raise BookAgentError("This job already contains human-review output; refusing to overwrite it.")
    write_json_atomically(human_review_path, human_review)
    write_json_atomically(approved_draft_path, approved_draft)
    review_artifact = make_artifact(
        root,
        stage="review",
        artifact_id="book-agent-human-review",
        record_type="book-agent-human-review",
        relative_path="07-review/human-review.json",
        parent_artifact_ids=("book-agent-07-review-validation-report",),
    )
    approved_artifact = make_artifact(
        root,
        stage="map",
        artifact_id="book-agent-approved-draft",
        record_type="private-poet-volume-bundle",
        relative_path="08-map/approved-draft.json",
        parent_artifact_ids=("book-agent-08-map-draft", "book-agent-human-review"),
    )
    next_job = copy.deepcopy(job)
    next_job["artifacts"].extend([review_artifact, approved_artifact])
    previous = next_job["status"]
    next_job["status"] = "approved-private-preview"
    next_job["transitions"].append(
        {
            "at": utc_now(),
            "from": previous,
            "to": "approved-private-preview",
            "actor": reviewer,
            "reason": notes or "Human reviewer approved the valid private book draft.",
        }
    )
    job_validation = validate_job_manifest(next_job, artifact_root=root)
    if not job_validation.valid:
        details = "; ".join(f"{item.code}: {item.message}" for item in job_validation.errors)
        raise BookAgentError(f"Refusing to write human review outputs: {details}")
    write_json_atomically(job_path, next_job)
    return {"job": next_job, "approvedDraftPath": str(approved_draft_path), "humanReviewPath": str(human_review_path)}


def release_job(job_path: Path, *, actor: str, notes: str) -> dict[str, Any]:
    job = load_job(job_path)
    if job.get("status") != "approved-private-preview":
        raise BookAgentError("Only an approved-private-preview job can produce a release manifest.")
    root = job_root_for_manifest(job_path, job)
    approved_path = root / "08-map" / "approved-draft.json"
    draft = read_json_file(approved_path if approved_path.is_file() else root / "08-map" / "draft.json", "Private draft")
    release_root = root / "09-release"
    release_root.mkdir(exist_ok=False)
    release = {
        "recordType": "private-book-release-manifest",
        "schemaVersion": "0.1.0",
        "releaseId": f"release-{draft['bundleId']}",
        "bundleId": draft["bundleId"],
        "jobId": draft["jobId"],
        "source": draft["source"],
        "reviewState": draft["reviewState"],
        "publicationState": "approved-for-curation",
        "reviewer": actor,
        "releasedAt": utc_now(),
        "notes": notes,
        "acceptedEntityIds": [
            *[item["id"] for item in draft["entities"]["people"] if item.get("resolutionState") == "resolved"],
            *[item["id"] for item in draft["entities"]["places"] if item.get("resolutionState") == "resolved"],
            *[item["id"] for item in draft["entities"]["works"] if item.get("discoveryState") == "matched"],
        ],
        "acceptedConnectionIds": [
            *[item["id"] for item in draft["volumes"]["journey"]["items"] if item.get("reviewState") == "approved-private-preview"],
            *[item["id"] for item in draft["volumes"]["poemWorld"]["items"] if item.get("reviewState") == "approved-private-preview"],
            *[item["id"] for item in draft["volumes"]["social"]["edges"] if item.get("reviewState") == "approved-private-preview"],
        ],
        "acceptedStoryIds": [item["id"] for item in draft["storyCards"] if item.get("reviewState") == "approved-private-preview"],
        "boundary": "Private curation package only. An explicit records/derived/public exporter is still required before public data changes.",
    }
    release_path = release_root / "release-manifest.json"
    write_json_atomically(release_path, release)
    update_job_status(
        job_path,
        status="approved-for-curation",
        actor=actor,
        reason=notes or "Generated a private release manifest after human review.",
    )
    return {"releasePath": str(release_path), "status": "approved-for-curation", "release": release}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="Upload, extract and build a private draft.")
    run.add_argument("--input", type=Path, required=True, help="Local .txt, .text, .md or text-layer .pdf book.")
    run.add_argument("--book-title", required=True)
    run.add_argument("--poet-id", required=True)
    run.add_argument("--poet-name", required=True)
    run.add_argument("--data-processing-consent", action="store_true")
    run.add_argument("--source-id")
    run.add_argument("--job-id")
    run.add_argument("--quarantine-root", type=Path, default=DEFAULT_QUARANTINE_ROOT)
    run.add_argument("--job-root", type=Path, default=DEFAULT_JOB_ROOT)
    run.add_argument("--raw-manifest", type=Path, default=DEFAULT_RAW_MANIFEST)
    run.add_argument("--source-manifest", type=Path, default=DEFAULT_SOURCE_MANIFEST)
    run.add_argument("--people-catalog", type=Path, default=DEFAULT_PEOPLE_CATALOG)
    run.add_argument("--place-catalog", type=Path, default=DEFAULT_PLACE_CATALOG)
    run.add_argument("--work-catalog", type=Path, default=DEFAULT_WORK_CATALOG)
    run.add_argument("--max-upload-bytes", type=int, default=DEFAULT_MAX_BYTES)
    run.add_argument("--max-segment-chars", type=int, default=DEFAULT_MAX_SEGMENT_CHARS)

    review = subparsers.add_parser("review", help="Apply an explicit human approval to a valid draft.")
    review.add_argument("--job", type=Path, required=True)
    review.add_argument("--reviewer", required=True)
    review.add_argument("--notes", default="")
    review.add_argument("--approve-all", action="store_true", help="Approve all non-rejected candidates in this prototype.")

    publish = subparsers.add_parser("publish", help="Create a private release manifest after human review.")
    publish.add_argument("--job", type=Path, required=True)
    publish.add_argument("--actor", required=True)
    publish.add_argument("--notes", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "run":
            outcome = run_book_analysis(
                input_path=args.input,
                book_title=args.book_title,
                poet_id=args.poet_id,
                poet_name=args.poet_name,
                data_processing_consent=args.data_processing_consent,
                source_id=args.source_id,
                job_id=args.job_id,
                quarantine_root=args.quarantine_root,
                job_root=args.job_root,
                raw_manifest=args.raw_manifest,
                source_manifest=args.source_manifest,
                max_upload_bytes=args.max_upload_bytes,
                max_segment_chars=args.max_segment_chars,
                people_catalog_path=args.people_catalog,
                place_catalog_path=args.place_catalog,
                work_catalog_path=args.work_catalog,
            )
            print(json.dumps(outcome, ensure_ascii=False, indent=2))
            return 0 if outcome.get("completed") else 2
        if args.command == "review":
            if not args.approve_all:
                raise BookAgentError("This prototype requires --approve-all for its explicit review command.")
            outcome = approve_job(args.job, reviewer=args.reviewer, notes=args.notes)
            job = outcome["job"]
            print(json.dumps({"jobId": job["jobId"], "status": job["status"], "jobPath": str(args.job), "approvedDraftPath": outcome["approvedDraftPath"], "humanReviewPath": outcome["humanReviewPath"]}, ensure_ascii=False, indent=2))
            return 0
        release = release_job(args.job, actor=args.actor, notes=args.notes)
        print(json.dumps(release, ensure_ascii=False, indent=2))
        return 0
    except (BookAgentError, IntakeError, ValueError) as exc:
        print(f"Book analysis agent error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
