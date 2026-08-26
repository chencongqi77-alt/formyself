import type { ReactNode } from "react";

import { SiteNav, type SiteNavSection } from "./SiteNav";

type ReadingModuleHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  className?: string;
};

export function ReadingModuleHeader({
  title,
  subtitle,
  controls,
  className,
}: ReadingModuleHeaderProps) {
  return (
    <header
      className={"site-header site-header--compact" + (className ? " " + className : "")}
    >
      <div className="brand-block brand-block--compact">
        <h1>
          <span className="brand-block__title">{title}</span>
          {subtitle ? <span className="brand-block__subtitle">{subtitle}</span> : null}
        </h1>
      </div>
      {controls}
    </header>
  );
}

type ReadingModuleFrameProps = {
  current: SiteNavSection;
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  className?: string;
  headerClassName?: string;
  skipTargetId?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function ReadingModuleFrame({
  current,
  title,
  subtitle,
  controls,
  className,
  headerClassName,
  skipTargetId = "main-content",
  children,
  footer,
}: ReadingModuleFrameProps) {
  return (
    <main className={"site-shell module-page" + (className ? " " + className : "")}>
      <a className="skip-link" href={"#" + skipTargetId}>
        跳到正文
      </a>
      <SiteNav current={current} />
      <ReadingModuleHeader
        title={title}
        subtitle={subtitle}
        controls={controls}
        className={headerClassName}
      />
      {children}
      {footer}
    </main>
  );
}

type JourneyStageProps = {
  ariaLabel: string;
  visual: ReactNode;
  rail: ReactNode;
  inspector: ReactNode;
};

export function JourneyStage({
  ariaLabel,
  visual,
  rail,
  inspector,
}: JourneyStageProps) {
  return (
    <section
      id="main-content"
      className="journey-stage journey-stage--map-first"
      aria-label={ariaLabel}
    >
      <div className="journey-stage-body">
        <section className="map-panel">{visual}{rail}</section>
        {inspector}
      </div>
    </section>
  );
}

type ContextAtlasStageProps = {
  ariaLabel: string;
  visual: ReactNode;
  context?: ReactNode;
  inspector: ReactNode;
};

export function ContextAtlasStage({
  ariaLabel,
  visual,
  context,
  inspector,
}: ContextAtlasStageProps) {
  return (
    <section id="main-content" className="poem-world-stage" aria-label={ariaLabel}>
      <div className="poem-world-stage-body">
        <section className="poem-world-map-panel">{visual}{context}</section>
        {inspector}
      </div>
    </section>
  );
}

type SocialGraphStageProps = {
  graph?: ReactNode;
  inspector?: ReactNode;
  children?: ReactNode;
};

export function SocialGraphStage({
  graph,
  inspector,
  children,
}: SocialGraphStageProps) {
  return (
    <div id="main-content" className="social-layout">
      {children ?? (
        <>
          {graph}
          {inspector}
        </>
      )}
    </div>
  );
}
