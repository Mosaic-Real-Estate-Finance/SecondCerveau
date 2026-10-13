import { StackBanner } from "@/components/stack-banner";
import { dismissOutage, useOutage } from "@/lib/outage";

// What a user is told when transcription stops on the account's side (see
// lib/outage.ts): not the reason, which is not theirs to fix, but that the
// owner knows and that they will hear when it is fixed.

export function OutageBanner({ visible }: { visible: boolean }) {
  const outage = useOutage();
  return (
    <StackBanner visible={visible && outage !== null} label="Transcription indisponible">
      <p className="min-w-0 flex-1 text-xs leading-snug">
        Désolé, nous avons un problème avec l'outil de transcription. Théo vient de recevoir une alerte et va corriger au
        plus vite. Vous serez prévenu dès que c'est réglé.
      </p>
      <button
        type="button"
        onClick={dismissOutage}
        aria-label="Fermer"
        className="tap-target -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)]"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </StackBanner>
  );
}
