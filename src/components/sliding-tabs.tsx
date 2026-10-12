import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
// Full width here: each tab is as wide as its label, and the room left over is
// shared out equally (.sliding-tabs, index.css). A tab may carry a shorter
// label for when the long ones do not fit the bar together: the long ones are
// measured, off screen, at every width.

export type Tab<T extends string> = { id: T; label: string; short?: string; count?: number };

/** What a tab draws: its label and its count. */
function Content({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count ? <span className="ml-1.5 tabular-nums opacity-60">{count}</span> : null}
    </>
  );
}

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
  const ruler = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  // Do the long labels fit side by side? The bar, less its padding and the
  // gaps, against the labels as a tab draws them (padding included).
  // Measured on a hidden copy, so the answer never depends on which labels
  // are on screen at the time.
  const fit = () => {
    const node = bar.current;
    const measures = ruler.current;
    if (!node || !measures) return;
    const style = getComputedStyle(node);
    const inner = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const room = inner - parseFloat(style.columnGap || "0") * (tabs.length - 1);
    const needed = [...measures.children].reduce((sum, child) => sum + (child as HTMLElement).offsetWidth, 0);
    setCompact(needed > room);
  };

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
    fit();
    moveTo(false);
    const node = bar.current;
    if (!node) return;
    let width = node.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (node.offsetWidth === width) return;
      width = node.offsetWidth;
      fit();
      moveTo(false);
    });
    observer.observe(node);
    return () => observer.disconnect();
    // Once: later moves are the clicks below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A count gaining a digit can tip a long label over: measured again.
  const counts = tabs.map((tab) => tab.count ?? 0).join();
  useLayoutEffect(fit, [counts]);
  // The tabs are as wide as their labels: new labels or counts move the
  // active one, and the pill follows it in place, without a slide.
  useLayoutEffect(() => moveTo(false), [counts, compact]);
  // The webfont landing changes every width.
  useEffect(() => {
    void document.fonts?.ready.then(fit);
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
          <Content label={compact && tab.short ? tab.short : tab.label} count={tab.count} />
        </button>
      ))}
      {/* The long labels, as a tab draws them, out of sight: the ruler of fit(). */}
      <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex w-0 overflow-hidden">
        {tabs.map((tab) => (
          <span key={tab.id} className="t-tab inline-flex items-center whitespace-nowrap text-[14px] font-medium">
            <Content label={tab.label} count={tab.count} />
          </span>
        ))}
      </div>
    </div>
  );
}
