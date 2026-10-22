import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// A banner at the top of the home screen, from transitions.dev's banner
// stacking: it drops in, and leaves the same way before it is unmounted.
// Shared by the notifications banner and the transcription outage one.

const LEAVE_MS = 250 + 60; // --stack-close, plus a frame or two
const FADE_MS = 600 + 60; // .is-fading, in index.css

export function StackBanner({
  visible,
  label,
  fade = false,
  children,
}: {
  visible: boolean;
  label: string;
  /** Leaves in a plain fade, for a banner that goes away on its own. */
  fade?: boolean;
  children: ReactNode;
}) {
  // Mounted with .is-enter, reflowed, then released in the same task, as the
  // snippet orchestrates it; unmounted only after its .is-leaving close.
  const [shown, setShown] = useState(visible);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (visible) {
      setLeaving(false);
      setShown(true);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const timer = window.setTimeout(() => setShown(false), fade ? FADE_MS : LEAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const banner = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    const node = banner.current;
    if (!shown || !node) return setEntered(false);
    void node.offsetWidth;
    setEntered(true);
  }, [shown]);

  if (!shown) return null;
  return (
    <div className="push-banner-stage" role="region" aria-label={label}>
      <div className="t-stack">
        <div ref={banner} className={cn("t-stack-banner push-banner", !entered && "is-enter", leaving && (fade ? "is-fading" : "is-leaving"))} data-depth="0">
          {children}
        </div>
      </div>
    </div>
  );
}
