import { useEffect, useState } from "react";
import { StackBanner } from "@/components/stack-banner";

// What is still waiting to reach Notion, said on the home screen of the
// installed app at each opening: Read AI calls to decide, dictations not yet
// sent. It shows for a few seconds and fades away on its own; a tap anywhere
// on it opens « Notifications ».

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
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

  // Each opening, if there is something to say and room to say it.
  useEffect(() => {
    if (!opening || !visible || total === 0) return;
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

  const detail = [
    meetings ? `${plural(meetings, "réunion")} à valider` : "",
    notes ? `${plural(notes, "dictée")} à envoyer` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <StackBanner visible={showing && visible && total > 0} label="Sujets à traiter" fade>
      <button
        type="button"
        onClick={() => {
          setShowing(false);
          onOpen();
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{plural(total, "sujet")} à traiter</span>
          <span className="mt-0.5 block text-xs text-[color:var(--muted)]">{detail}</span>
        </span>
        <span className="shrink-0 rounded-full bg-navy px-4 py-2.5 font-medium text-on-accent">Voir →</span>
      </button>
    </StackBanner>
  );
}
