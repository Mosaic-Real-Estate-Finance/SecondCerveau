import { useEffect, useRef } from "react";

// transitions.dev 10, success check. The path length is measured on mount
// rather than hard coded, as the snippet recommends for custom paths.
export function SuccessCheck({ show }: { show: boolean }) {
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const path = wrap.current?.querySelector("path");
    if (!path) return;
    const length = String(Math.ceil(path.getTotalLength()) + 1);
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
  }, []);

  useEffect(() => {
    const node = wrap.current;
    if (!node || !show) return;
    node.setAttribute("data-state", "out");
    void node.offsetWidth;
    node.setAttribute("data-state", "in");
  }, [show]);

  return (
    <span ref={wrap} className="t-success-check text-navy" data-state="out" aria-hidden>
      <svg viewBox="0 0 48 48" width="56" height="56" fill="none">
        <circle cx="24" cy="24" r="22" fill="currentColor" />
        <path d="M14 24.5l6.5 6.5L34 17.5" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
