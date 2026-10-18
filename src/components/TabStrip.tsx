"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/** Horizontally scrolling tabs that keep the active tab in view on phones. */
export default function TabStrip({ tabs, active, base }: { tabs: { key: string; label: string }[]; active: string; base: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  return (
    <nav aria-label="Account sections" className="no-scrollbar sticky top-0 z-20 -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50/95 px-4 backdrop-blur md:mx-0 md:px-0">
      {tabs.map((x) => (
        <Link
          key={x.key}
          ref={x.key === active ? ref : undefined}
          href={`${base}${x.key === "overview" ? "" : `?tab=${x.key}`}`}
          scroll={false}
          aria-current={x.key === active ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium ${x.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500"}`}
        >
          {x.label}
        </Link>
      ))}
    </nav>
  );
}
