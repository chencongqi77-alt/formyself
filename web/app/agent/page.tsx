"use client";

import { useState } from "react";

import { BookAgentWorkbench } from "../components/BookAgentWorkbench";
import { SiteNav, type SiteNavPrivateView } from "../components/SiteNav";
import type { PrivateViewKey } from "../components/private-view";

function privateViewFromNav(view: SiteNavPrivateView): PrivateViewKey {
  return view === "poem-world" ? "poemWorld" : view;
}

function navViewFromPrivateView(view: PrivateViewKey): SiteNavPrivateView {
  return view === "poemWorld" ? "poem-world" : view;
}

export default function AgentPage() {
  const [privatePreviewActive, setPrivatePreviewActive] = useState(false);
  const [privateView, setPrivateView] = useState<PrivateViewKey>("journey");
  const pageClassName = privatePreviewActive
    ? `site-shell agent-preview-shell${privateView === "social" ? " social-page" : ""}`
    : "site-shell module-page agent-page-shell";

  return (
    <main className={pageClassName}>
      {privatePreviewActive ? (
        <a className="skip-link" href="#main-content">
          跳到正文
        </a>
      ) : null}
      <SiteNav
        current="agent"
        privatePreviewActive={privatePreviewActive}
        privatePreviewView={navViewFromPrivateView(privateView)}
        onPrivatePreviewViewChange={(view) => setPrivateView(privateViewFromNav(view))}
      />
      <BookAgentWorkbench
        activePrivateView={privateView}
        onPrivatePreviewChange={setPrivatePreviewActive}
      />
    </main>
  );
}
