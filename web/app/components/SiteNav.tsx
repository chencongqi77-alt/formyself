import Link from "next/link";

export type SiteNavSection = "home" | "journey" | "poem-world" | "social" | "agent";
export type SiteNavPrivateView = "journey" | "poem-world" | "social";

const NAV_ITEMS: {
  key: Exclude<SiteNavSection, "home">;
  href: string;
  label: string;
}[] = [
  { key: "journey", href: "/journey", label: "行迹卷" },
  { key: "poem-world", href: "/poem-world", label: "诗境图" },
  { key: "social", href: "/social", label: "交游录" },
  { key: "agent", href: "/agent", label: "Agent 工作台" },
];

type SiteNavProps = {
  current: SiteNavSection;
  privatePreviewActive?: boolean;
  privatePreviewView?: SiteNavPrivateView;
  onPrivatePreviewViewChange?: (view: SiteNavPrivateView) => void;
};

export function SiteNav({
  current,
  privatePreviewActive = false,
  privatePreviewView,
  onPrivatePreviewViewChange,
}: SiteNavProps) {
  return (
    <nav className="site-nav" aria-label="主导航">
      <Link className="site-nav-brand" href="/">
        诗行漫记
      </Link>

      <span className="site-nav-links">
        {NAV_ITEMS.map((item) => {
          const privateView: SiteNavPrivateView | null =
            item.key === "agent" ? null : item.key;
          if (privatePreviewActive && privateView && onPrivatePreviewViewChange) {
            const isActive = privatePreviewView === privateView;
            return (
              <button
                key={item.key}
                type="button"
                className={isActive ? "site-nav-private-button site-nav-private-button-active" : "site-nav-private-button"}
                aria-current={isActive ? "page" : undefined}
                aria-pressed={isActive}
                onClick={() => onPrivatePreviewViewChange(privateView)}
              >
                {item.label}
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={item.key === current && !(privatePreviewActive && item.key === "agent") ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </span>

      {current !== "home" ? (
        <Link className="site-nav-home" href="/">
          返回首页
        </Link>
      ) : null}
    </nav>
  );
}
