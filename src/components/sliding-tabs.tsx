import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// transitions.dev, tabs sliding: the active pill slides between the options.
// The snippet's orchestration, moved into a component: the active tab's
// offsetLeft / offsetWidth are written onto the pill, and the CSS tweens.
// On first paint and on any resize — the window, or the labels once the font
// has loaded — the pill is put in place without a transition, so it never
// slides in from nowhere.
//
// The bar scrolls sideways when the labels are wider than the screen; the
// active tab is brought into view as it is picked.

export type Tab<T extends string> = { id: T; label: string; count?: number };

export function SlidingTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const node = bar.current;
    const marker = pill.current;
    if (!node || !marker) return;
    const moveTo = (animate: boolean) => {
      const tab = node.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return;
      if (!animate) {
        const previous = marker.style.transition;
        marker.style.transition = "none";
        marker.style.transform = `translateX(${tab.offsetLeft}px)`;
        marker.style.width = `${tab.offsetWidth}px`;
        void marker.offsetWidth;
        marker.style.transition = previous;
      } else {
        marker.style.transform = `translateX(${tab.offsetLeft}px)`;
        marker.style.width = `${tab.offsetWidth}px`;
      }
      // The bar's own scroller only: scrollIntoView would also move the
      // pages around it, which slide on transforms.
      const scroller = node.parentElement!;
      const start = node.offsetLeft + tab.offsetLeft;
      const end = start + tab.offsetWidth;
      const gutter = node.offsetLeft;
      const left =
        start - gutter < scroller.scrollLeft
          ? start - gutter
          : end + gutter > scroller.scrollLeft + scroller.clientWidth
            ? end + gutter - scroller.clientWidth
            : null;
      if (left !== null) scroller.scrollTo({ left, behavior: animate ? "smooth" : "auto" });
    };
    moveTo(placed.current);
    placed.current = true;
    const observer = new ResizeObserver(() => moveTo(false));
    observer.observe(node);
    return () => observer.disconnect();
  }, [value, tabs]);

  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      <div ref={bar} className="t-tabs" role="tablist" aria-label={label}>
        <span ref={pill} className="t-tabs-pill" aria-hidden="true" />
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className="t-tab whitespace-nowrap text-[14px] font-medium"
          >
            {tab.label}
            {tab.count ? <span className="ml-1.5 tabular-nums opacity-60">{tab.count}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
