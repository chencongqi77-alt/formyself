"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import {
  relationshipReadingCollection,
  socialRelationshipHref,
  socialWorkReadingHref,
} from "../../../../../lib/relationship-reading";
import { loadJson } from "../../../../../lib/loadJson";

type Person = {
  id: string;
  name: string;
  aliases?: string[];
  dynasty?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  intro?: string;
  reviewStatus?: string;
};

type NetworkPerson = {
  id: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
};

type NetworkEdge = {
  id: string;
  source: string;
  target: string;
};

type NetworkPayload = {
  person: { id: string; name: string };
  reviewState?: string;
  people: NetworkPerson[];
  edges: NetworkEdge[];
};

type PoetIndex = {
  poets: Array<{ id: string; name: string; path: string }>;
};

type CorpusWork = {
  id: string;
  personId: string;
  title: string;
  genre: string;
  text: string[];
};

type DetailData = {
  anchor: { id: string; name: string };
  edge: NetworkEdge;
  people: Person[];
  networkPeople: NetworkPerson[];
  worksById: Map<string, CorpusWork>;
};

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_RELEASE_PATH = /^\/data\/poet-social\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;

function decodeParam(value: string | undefined): string {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return "";
  }
}

function personLifeLabel(person: Person | NetworkPerson | undefined): string {
  if (!person) return "生卒年待考";
  if (person.birthYear && person.deathYear) {
    return `${person.birthYear}–${person.deathYear}`;
  }
  if (person.birthYear) return `${person.birthYear} 年生`;
  if (person.deathYear) return `${person.deathYear} 年卒`;
  return "生卒年待考";
}

function personById(
  people: Person[],
  fallbackPeople: NetworkPerson[],
  id: string,
): Person | NetworkPerson | undefined {
  return people.find((person) => person.id === id) ?? fallbackPeople.find((person) => person.id === id);
}

export default function RelationshipDetailPage() {
  const params = useParams<{ poetId: string; edgeId: string }>();
  const poetId = decodeParam(params.poetId);
  const edgeId = decodeParam(params.edgeId);
  const validRoute = SAFE_ID.test(poetId) && SAFE_ID.test(edgeId);
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!validRoute) return;

    let cancelled = false;

    void (async () => {
      try {
        const index = await loadJson<PoetIndex>("/data/poet-social-index.json");
        const entry = index.poets.find((poet) => poet.id === poetId);
        if (!entry || !SAFE_RELEASE_PATH.test(entry.path)) {
          throw new Error("未发布的交游图谱");
        }

        const [network, people] = await Promise.all([
          loadJson<NetworkPayload>(entry.path),
          loadJson<Person[]>("/data/people.json"),
        ]);
        const edge = network.edges.find((item) => item.id === edgeId);
        if (!edge || (edge.source !== network.person.id && edge.target !== network.person.id)) {
          throw new Error("关系不属于当前交游图谱");
        }

        const collection = relationshipReadingCollection(edge.source, edge.target);
        const workGroups = collection
          ? await Promise.all(
              collection.pairIds.map((personId) =>
                loadJson<CorpusWork[]>(`/data/corpus/${personId}.json`).catch(() => []),
              ),
            )
          : [];
        const worksById = new Map(
          workGroups.flat().map((work) => [work.id, work]),
        );
        if (!cancelled) {
          setData({
            anchor: network.person,
            edge,
            people,
            networkPeople: network.people,
            worksById,
          });
        }
      } catch {
        if (!cancelled) {
          setError("关系资料暂时无法加载，请返回交游录后重试。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [edgeId, loadAttempt, poetId, validRoute]);

  const backHref = validRoute ? socialRelationshipHref(poetId) : "/social";

  const relationships = useMemo(() => {
    if (!data) return null;
    const people = data.edge;
    return {
      first: personById(data.people, data.networkPeople, people.source),
      second: personById(data.people, data.networkPeople, people.target),
      collection: relationshipReadingCollection(people.source, people.target),
    };
  }, [data]);

  if (!validRoute) {
    return (
      <main className="relationship-reading-shell">
        <Link className="reading-back" href={backHref}>
          ← 返回交游录
        </Link>
        <section className="relationship-reading-state" role="alert">
          <h1>关系资料链接无效。</h1>
        </section>
      </main>
    );
  }

  if (!data || !relationships) {
    return (
      <main className="relationship-reading-shell">
        <Link className="reading-back" href={backHref}>
          ← 返回交游录
        </Link>
        <section
          className="relationship-reading-state"
          aria-live="polite"
          role={error ? "alert" : undefined}
        >
          <h1>{error || "正在整理两位诗人的关系资料……"}</h1>
          {error ? (
            <button
              type="button"
              onClick={() => {
                setData(null);
                setError("");
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              重试
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  const firstPerson = relationships.first ?? {
    id: data.edge.source,
    name: data.edge.source,
    birthYear: null,
    deathYear: null,
  };
  const secondPerson = relationships.second ?? {
    id: data.edge.target,
    name: data.edge.target,
    birthYear: null,
    deathYear: null,
  };
  const collection = relationships.collection;

  return (
    <main className="relationship-reading-shell">
      <Link className="reading-back" href={backHref}>
        ← 返回{data.anchor.name}的交游录
      </Link>

      <article className="relationship-reading">
        <header className="relationship-reading-hero">
          <div>
            <p className="relationship-reading-eyebrow">交游录 · 关系资料页</p>
            <h1>
              {firstPerson.name} <span>×</span> {secondPerson.name}
            </h1>
            <p>
              资料按人物、原典与诗文线索分段呈示，方便继续阅读。
            </p>
          </div>
        </header>

        <div className="relationship-reading-body">
          <div className="relationship-reading-main">
            <section className="relationship-reading-section" aria-labelledby="people-story-heading">
              <div className="relationship-reading-section-heading">
                <p>已发布人物资料</p>
                <h2 id="people-story-heading">两位诗人</h2>
              </div>
              <div className="relationship-person-cards">
                {[firstPerson, secondPerson].map((person) => {
                  const profile = data.people.find((item) => item.id === person.id);
                  return (
                    <article key={person.id} className="relationship-person-card">
                      <p>人物档案</p>
                      <h3>{person.name}</h3>
                      <span>
                        {profile?.dynasty ? `${profile.dynasty} · ` : ""}
                        {personLifeLabel(profile ?? person)}
                      </span>
                      {profile?.intro ? <div>{profile.intro}</div> : <div>人物简介尚待整理。</div>}
                    </article>
                  );
                })}
              </div>
            </section>

            {collection ? (
              <section className="relationship-reading-section" aria-labelledby="source-story-heading">
                <div className="relationship-reading-section-heading">
                  <p>原典故事卡</p>
                  <h2 id="source-story-heading">原典所见的两人交集</h2>
                </div>
                <div className="relationship-source-story-cards">
                  {collection.storyReferences.map((story) => (
                    <article key={story.id} className="relationship-source-story-card">
                      <p className="relationship-source-story-eyebrow">{story.eyebrow}</p>
                      <h3>{story.title}</h3>
                      <div className="relationship-source-story-copy">
                        <p>{story.summary}</p>
                        {story.paragraphs.map((paragraph, index) => (
                          <p key={`${story.id}-${index}`}>{paragraph}</p>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="relationship-reading-section" aria-labelledby="works-heading">
              <div className="relationship-reading-section-heading">
                <p>{collection ? "诗文线索" : "阅读资料"}</p>
                <h2 id="works-heading">
                  {collection ? "相关作品与全文入口" : "当前可用的关系资料"}
                </h2>
                {collection ? (
                  <span>保留题名与全文入口，便于自行核读。</span>
                ) : null}
              </div>
              {collection ? (
                <div className="relationship-work-cards">
                  {collection.workReferences.map((reference) => {
                    const works = reference.workIds.flatMap((workId) => {
                      const work = data.worksById.get(workId);
                      return work ? [work] : [];
                  });
                  return (
                    <article key={reference.id} className="relationship-work-card">
                      <h3>{reference.title}</h3>
                      <div>{reference.summary}</div>
                      <div className="relationship-work-links">
                        {works.map((work) => (
                          <Link
                            key={work.id}
                            href={socialWorkReadingHref(work.id, data.anchor.id)}
                          >
                            <span>{work.genre} · 查看全文</span>
                            <strong>{work.title}</strong>
                          </Link>
                        ))}
                      </div>
                    </article>
                    );
                  })}
                </div>
              ) : (
                <p className="relationship-reading-empty">
                  这条关系暂未整理出可单独阅读的原典或作品卡，不以缺口补写故事。
                </p>
              )}
            </section>
          </div>

        </div>
      </article>
    </main>
  );
}
