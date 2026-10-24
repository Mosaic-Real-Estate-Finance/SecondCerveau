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
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-balance font-semibold">{title}</span>
          <span className="mt-0.5 block text-balance text-xs text-[color:var(--muted)]">{detail}</span>
        </span>
        <span className="shrink-0 rounded-full bg-navy px-4 py-2.5 font-medium text-on-accent">Voir →</span>
      </button>
    </StackBanner>
  );
}
