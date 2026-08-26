"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import {
  isLongWorkReading,
  WorkReadingTemplate,
  type WorkReadingPlaceRelation,
} from "../../components/WorkReadingTemplate";
import { loadJson } from "../../../lib/loadJson";

type ReviewStatus = "draft" | "needsReview" | "reviewed" | "verified" | "published";

type Work = {
  id: string;
  personId: string;
  placeIds?: string[];
  eventIds?: string[];
  title: string;
  genre: string;
  text: string[];
  libraryStatus?: "corpus";
};

type WorkPlaceLink = {
  id: string;
  workId: string;
  personId: string;
  placeId: string;
  eventId?: string;
  relationType: "composed-at" | "inscribed-at" | "describes-place" | "mentioned-place";
  certainty: "verified" | "probable";
  timeLabel?: string;
  note: string;
  reviewStatus: ReviewStatus;
};

type StoryEvent = {
  id: string;
  personId: string;
  placeId: string;
  startYear?: number;
  endYear?: number;
  timePrecision?: "year" | "range" | "era-only" | "era-and-month" | "sequence-only";
  timeLabel?: string;
  sequence?: number;
  lifeStage: string;
  role: string;
  title: string;
  summary: string;
};

type Place = {
  id: string;
  name: string;
  historicalNames: string[];
  modernName: string;
};

type Person = {
  id: string;
  name: string;
};

type DetailData = {
  people: Person[];
  works: Work[];
  events: StoryEvent[];
  places: Place[];
  workPlaceLinks: WorkPlaceLink[];
};

type CorpusIndex = {
  people?: Record<string, unknown>;
};

function corpusPersonIdFromWorkId(workId: string, corpusIndex: CorpusIndex) {
  return Object.keys(corpusIndex.people ?? {})
    .filter((personId) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(personId))
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .find((personId) => workId.startsWith(`corpus-${personId}-`));
}

function decodeWorkId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasYearRange(
  event: StoryEvent,
): event is StoryEvent & { startYear: number; endYear: number } {
  return Number.isFinite(event.startYear) && Number.isFinite(event.endYear);
}

function hasSequence(event: StoryEvent): event is StoryEvent & { sequence: number } {
  return Number.isFinite(event.sequence);
}

function sortEvents(events: StoryEvent[]) {
  const useSequence = events.length > 0 && events.every(hasSequence);

  return [...events].sort((a, b) => {
    if (useSequence) return (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id);

    const aHasYearRange = hasYearRange(a);
    const bHasYearRange = hasYearRange(b);
    if (aHasYearRange && bHasYearRange) {
      return (
        a.startYear - b.startYear ||
        a.endYear - b.endYear ||
        (hasSequence(a) ? a.sequence : Number.MAX_SAFE_INTEGER) -
          (hasSequence(b) ? b.sequence : Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
      );
    }
    if (aHasYearRange) return -1;
    if (bHasYearRange) return 1;
    return (
      (hasSequence(a) ? a.sequence : Number.MAX_SAFE_INTEGER) -
        (hasSequence(b) ? b.sequence : Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id)
    );
  });
}

export default function WorkDetailPage() {
  const params = useParams<{ workId: string }>();
  const workId = decodeWorkId(params.workId ?? "");
  const returnTarget = { href: "/journey", label: "返回行迹卷" };
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [people, works, events, places, workPlaceLinks, corpusIndex] = await Promise.all([
          loadJson<Person[]>("/data/people.json"),
          loadJson<Work[]>("/data/works.json"),
          loadJson<StoryEvent[]>("/data/events.json"),
          loadJson<Place[]>("/data/places.json"),
          loadJson<WorkPlaceLink[]>("/data/work-place-links.json"),
          loadJson<CorpusIndex>("/data/corpus/index.json").catch(() => ({})),
        ]);
        const corpusPersonId = corpusPersonIdFromWorkId(workId, corpusIndex);
        const corpusWorks = corpusPersonId
          ? await loadJson<Work[]>(`/data/corpus/${corpusPersonId}.json`).catch(() => [])
          : [];

        if (!cancelled) {
          setData({
            people,
            works: [...works, ...corpusWorks],
            events,
            places,
            workPlaceLinks,
          });
        }
      } catch {
        if (!cancelled) setError("作品暂时无法加载，请返回后重试。");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt, workId]);

  function retryLoad() {
    setData(null);
    setError("");
    setLoadAttempt((attempt) => attempt + 1);
  }

  const work = useMemo(() => data?.works.find((item) => item.id === workId), [data, workId]);

  const relatedPlaceLinks = useMemo(
    () =>
      (data?.workPlaceLinks ?? []).filter(
        (link) =>
          link.reviewStatus === "published" &&
          link.workId === workId &&
          link.personId === work?.personId,
      ),
    [data, work?.personId, workId],
  );

  const relatedEvents = useMemo(() => {
    const eventIds = new Set(
      relatedPlaceLinks.flatMap((link) => (link.eventId ? [link.eventId] : [])),
    );
    const events = (data?.events ?? []).filter((event) => {
      if (!work) return false;
      return eventIds.has(event.id) && event.personId === work.personId;
    });
    return sortEvents(events);
  }, [data, relatedPlaceLinks, work]);

  const relatedPlaces = useMemo(() => {
    const placeById = new Map((data?.places ?? []).map((place) => [place.id, place]));
    return relatedPlaceLinks.flatMap((link) => {
      const place = placeById.get(link.placeId);
      return place ? [{ link, place }] : [];
    });
  }, [data, relatedPlaceLinks]);

  const person = useMemo(
    () => data?.people.find((item) => item.id === work?.personId),
    [data, work],
  );

  if (!data) {
    return (
      <main className="work-reading-shell">
        <Link className="reading-back" href={returnTarget.href}>
          ← {returnTarget.label}
        </Link>
        <section className="work-reading-state" aria-live="polite" role={error ? "alert" : undefined}>
          <h1>{error || "正在整理作品与人生行迹……"}</h1>
          {error ? (
            <button className="work-reading-retry" type="button" onClick={retryLoad}>
              重试
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  if (!work) {
    return (
      <main className="work-reading-shell">
        <Link className="reading-back" href={returnTarget.href}>
          ← {returnTarget.label}
        </Link>
        <section className="work-reading-state">
          <h1>暂未找到这篇作品</h1>
          <p>它可能尚未收录，或链接已失效。</p>
        </section>
      </main>
    );
  }

  const placeNames = relatedPlaces.map(({ place }) => place.name).join("、");
  const hasCreationPlace = relatedPlaceLinks.some(
    (link) => link.relationType === "composed-at" || link.relationType === "inscribed-at",
  );
  const personName = person?.name ?? "这位人物";
  const readingRelations: WorkReadingPlaceRelation[] = relatedPlaces.map(({ link, place }) => ({
    id: link.id,
    relationType: link.relationType,
    certainty: link.certainty,
    timeLabel: link.timeLabel,
    note: link.note,
    placeName: place.name,
    modernName: place.modernName,
  }));
  const readingShellClassName =
    "work-reading-shell" + (isLongWorkReading(work.text) ? " work-reading-shell--long" : "");
  const readingLede = placeNames
    ? hasCreationPlace
      ? `这篇作品与${placeNames}关联为创作或题写关系。`
      : `这篇作品明确题咏${placeNames}；题咏地点不自动等同于创作地点。`
    : work.libraryStatus === "corpus"
      ? "从" + personName + "的全集索引中检索并阅读这篇作品。"
      : "沿着" + personName + "的人生行迹，读这篇作品。";

  return (
    <main className={readingShellClassName}>
      <WorkReadingTemplate
        work={work}
        personName={personName}
        lede={readingLede}
        relatedEvents={relatedEvents}
        relatedPlaces={readingRelations}
        backHref={returnTarget.href}
        backLabel={returnTarget.label}
      />
    </main>
  );
}
