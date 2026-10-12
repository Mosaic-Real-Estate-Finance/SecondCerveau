import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// transitions.dev, tabs sliding: the active pill slides between the options.
// The snippet's orchestration, as it is written there:
//   - on a click, the active tab's offsetLeft / offsetWidth are written onto
//     the pill, and the CSS transition tweens between the two positions;
//   - on first paint and on resize, the same values are written WITHOUT a
//     transition (suspended, reflowed, restored), so the pill is in place
//     before any animation can run.
// Nothing else ever touches the pill: a placement without transition at the
// wrong moment is what cuts a slide short.
//
// Full width here: the tabs share the bar equally (.sliding-tabs, index.css).

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

  const moveTo = (animate: boolean) => {
    const node = bar.current;
    const marker = pill.current;
    const tab = node?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!marker || !tab) return;
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
  };

  // First paint and resize: in place, without a transition. The observer
  // reports once as it starts; that first report is the first paint.
  useLayoutEffect(() => {
    moveTo(false);
    const node = bar.current;
    if (!node) return;
    let width = node.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (node.offsetWidth === width) return;
      width = node.offsetWidth;
      moveTo(false);
    });
    observer.observe(node);
    return () => observer.disconnect();
    // Once: later moves are the clicks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new tab: the pill slides there.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    moveTo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div ref={bar} className={cn("t-tabs sliding-tabs", className)} role="tablist" aria-label={label}>
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
  );
}
