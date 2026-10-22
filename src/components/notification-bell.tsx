import { useEffect, useRef, useState } from "react";
import bell from "@/assets/icons/bell.svg?raw";
import bellBadge from "@/assets/icons/bell.badge.svg?raw";
import { cn } from "@/lib/utils";

// The home screen's bell, drawn from the two SF Symbol exports kept in
// src/assets/icons. bell.badge.svg holds two paths: the bell cut open at its
// top right, and the badge itself — the circle at (441, 145), r 106 — which
// is the part that moves. Both are drawn in the badge's frame (726 high):
// the plain bell sits 41.1 lower in it, exactly where the cut one is, so the
// bell never jumps when the badge comes and goes.
//
// Something new: the bell swings and the badge springs in. Back to zero: the
// badge shrinks away, then the bell closes over its notch.

const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
const [PLAIN] = paths(bell);
const [CUT, BADGE] = paths(bellBadge);
const LEAVE_MS = 200;

export function NotificationBell({ count, className }: { count: number; className?: string }) {
  const [shown, setShown] = useState(count > 0);
  const [leaving, setLeaving] = useState(false);
  // A new key at each arrival restarts the swing and the spring.
  const [ring, setRing] = useState(count > 0 ? 1 : 0);
  const previous = useRef(count);

  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    if (count > before) {
      setLeaving(false);
      setShown(true);
      setRing((n) => n + 1);
      return;
    }
    if (count > 0 || before === 0) return;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [count]);

  return (
    <svg viewBox="0 0 588.87 726.429" aria-hidden className={cn("notification-bell", className)}>
      <g key={ring} className={cn("bell-body", ring > 0 && "is-ringing")}>
        {shown ? (
          <path d={CUT} fill="currentColor" />
        ) : (
          <path d={PLAIN} transform="translate(0 41.1358)" fill="currentColor" />
        )}
      </g>
      {shown && <path key={`badge-${ring}`} d={BADGE} className={cn("bell-badge", leaving && "is-leaving")} />}
    </svg>
  );
}
