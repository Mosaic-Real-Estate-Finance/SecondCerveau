import { useEffect, useState } from "react";
import { StackBanner } from "@/components/stack-banner";
import { bannerSlot } from "@/lib/banner-slot";

// What is still waiting to reach Notion, said on the home screen of the
// installed app at each opening: Read AI calls to decide, dictations not yet
// sent. It shows for a few seconds and fades away on its own; a tap anywhere
// on it opens « Notifications ».

/** How long it stays before fading. */
const SHOWN_MS = 5000;

export function PendingBanner({
  opening,
  visible,
  meetings,
  notes,
  onOpen,
}: {
  /** Changes at each opening of the app, once the count has been read. */
  opening: number;
  /** Whether a banner may show at all right now (home screen, no other). */
  visible: boolean;
  /** Read AI calls waiting for a decision. */
  meetings: number;
  /** Dictations on this phone, not yet in Notion. */
  notes: number;
  onOpen: () => void;
}) {
  const total = meetings + notes;
  const [showing, setShowing] = useState(false);

  // Each opening, if there is something to say and room to say it — the
  // feedback question may hold the place, or have just left it.
  useEffect(() => {
    if (!opening || !visible || total === 0 || !bannerSlot.claim("pending")) return;
    setShowing(true);
    const timer = window.setTimeout(() => setShowing(false), SHOWN_MS);
    return () => window.clearTimeout(timer);
    // Only an opening starts it; the count changing under it does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);

  // Leaving the home screen, or another banner taking the place, ends it.
  useEffect(() => {
    if (!visible) setShowing(false);
  }, [visible]);
  useEffect(() => {
    if (!showing) bannerSlot.release("pending");
  }, [showing]);

  // « 5 sujets attendent votre validation », then what they are without
  // counting them again: « On ajoute ces réunions dans Notion ? », « cette
  // dictée », « ces réunions et cette dictée ».
  const title = total > 1 ? `${total} sujets attendent votre validation` : "1 sujet attend votre validation";
  const what = [
    meetings ? (meetings > 1 ? "ces réunions" : "cette réunion") : "",
    notes ? (notes > 1 ? "ces dictées" : "cette dictée") : "",
  ]
    .filter(Boolean)
    .join(" et ");
  const detail = `On ajoute ${what} dans Notion\u00a0?`;

  return (
    <StackBanner visible={showing && visible && total > 0} label="Sujets à traiter" fade className="is-pressable">
      <button
        type="button"
        onClick={() => {
          setShowing(false);
          onOpen();
        }}
        aria-label={`${title}. ${detail}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {/* The text has the width; the way forward is a round arrow, the
            whole banner being the button. A pill there squeezed the text
            into a narrow column with a gap beside it. */}
        <span className="min-w-0 flex-1">
          <span className="block text-balance font-semibold leading-snug">{title}</span>
          <span className="mt-0.5 block text-pretty text-xs text-[color:var(--muted)]">{detail}</span>
        </span>
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-on-accent"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </button>
    </StackBanner>
  );
}
