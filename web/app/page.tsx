import Image from "next/image";
import Link from "next/link";

import { BookUploadEntry } from "./components/BookUploadEntry";
import { SiteNav } from "./components/SiteNav";
import styles from "./home.module.css";

const MODULES = [
  {
    key: "journey",
    name: "行迹卷",
    stat: "26 位诗人 · 152 段行迹",
    href: "/journey",
    aria: "进入行迹卷，查看诗人的人生行迹",
  },
  {
    key: "poem-world",
    name: "诗境图",
    stat: "27 位诗人 · 6,346 条诗—地线索",
    href: "/poem-world",
    aria: "进入诗境图，查看诗句与地点的关联",
  },
  {
    key: "social",
    name: "交游录",
    stat: "27 位诗人 · 4,493 条交游关系",
    href: "/social",
    aria: "进入交游录，查看诗人的交游网络",
  },
] as const;

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 18">
      <path d="M1 9h31M25 2l7 7-7 7" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        跳到正文
      </a>

      <div className={styles.frame}>
        <SiteNav current="home" />

        <section className={styles.hero} id="main-content" aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <h1 id="home-title">
              <span>在诗行之间，</span>
              <span>重走山河与人生。</span>
            </h1>
            <p>从诗人的行迹、诗句里的山河与交游网络，读懂古诗词的来处。</p>
            <BookUploadEntry />
          </div>

          <div className={styles.archiveVisual}>
            <figure className={styles.routeArtwork}>
              <Image
                src="/dongpo-route-cover.png"
                width={1672}
                height={941}
                alt="山水长卷中的诗人行迹路线"
                priority
                unoptimized
                sizes="(max-width: 1080px) calc(100vw - 120px), 55vw"
              />
            </figure>
          </div>
        </section>

        <section className={styles.folioList} aria-labelledby="reading-paths-title">
          <h2 className={styles.srOnly} id="reading-paths-title">
            古诗词阅读路径
          </h2>
          {MODULES.map((module) => (
            <Link
              key={module.key}
              className={styles.folioRow}
              href={module.href}
              aria-label={module.aria}
            >
              <h3>{module.name}</h3>
              <p>{module.stat}</p>
              <span className={styles.folioArrow} aria-hidden="true">
                <ArrowIcon />
              </span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
