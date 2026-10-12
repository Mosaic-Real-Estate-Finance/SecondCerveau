import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import "./maquette.css";
import { MEETINGS } from "./data";
import { MeetingCard } from "./MeetingCard";

// A mockup of the « Notifications » screen, apart from the app: no sign-in,
// no server, fictional meetings, one per case. /maquette.html.

function Maquette() {
  // A new key resets every card to its first state.
  const [round, setRound] = useState(0);
  return (
    <div
      className="mx-auto min-h-full max-w-[480px] px-4"
      style={{
        paddingTop: "calc(var(--safe-top) + 12px)",
        paddingBottom: "calc(var(--safe-bottom) + 48px)",
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-[color:var(--hairline)] px-4 py-2.5">
        <p className="text-xs text-[color:var(--muted)]">
          Maquette : réunions fictives, rien n'est envoyé.
        </p>
        <button
          type="button"
          onClick={() => setRound((n) => n + 1)}
          className="shrink-0 text-xs font-medium text-navy"
        >
          Réinitialiser
        </button>
      </div>

      <h1 className="font-serif text-2xl">Notifications</h1>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Réunions Read AI avec une personne que le CRM ne connaît pas. Rien n'est
        écrit dans Notion avant votre décision.
      </p>

      <div key={round} className="mt-6 flex flex-col gap-3">
        {MEETINGS.map((meeting) => (
          <MeetingCard key={meeting.id} meeting={meeting} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Maquette />
  </StrictMode>,
);
