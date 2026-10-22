import { useState } from "react";
import { StackBanner } from "@/components/stack-banner";

// What is still waiting to reach Notion, said on the home screen of the
// installed app: Read AI calls to decide, dictations not yet sent. The bell
// only lights up; this says how much, and opens « Notifications ».
//
// Closed, it stays closed until something new arrives: the count it was
// closed on is kept, and only a higher one brings it back.

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export function PendingBanner({
  visible,
  meetings,
  notes,
  onOpen,
}: {
  visible: boolean;
  /** Read AI calls waiting for a decision. */
  meetings: number;
  /** Dictations on this phone, not yet in Notion. */
  notes: number;
  onOpen: () => void;
}) {
  const total = meetings + notes;
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const dismissed = closedAt !== null && total <= closedAt;

  const detail = [
    meetings ? `${plural(meetings, "réunion")} à valider` : "",
    notes ? `${plural(notes, "dictée")} à envoyer` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <StackBanner visible={visible && total > 0 && !dismissed} label="Sujets à traiter">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{plural(total, "sujet")} à traiter</p>
        <p className="mt-0.5 text-xs text-[color:var(--muted)]">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 rounded-full bg-navy px-4 py-2.5 font-medium text-on-accent"
      >
        Voir →
      </button>
      <button
        type="button"
        onClick={() => setClosedAt(total)}
        aria-label="Fermer"
        className="-ml-1 -mr-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)]"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </StackBanner>
  );
}
