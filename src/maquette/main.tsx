import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import { ToastProvider, useToast } from "@/components/toast";
import type { ContactsState } from "@/App";
import type { ReviewItem } from "@/lib/api";
import type { Note } from "@/lib/notes";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { COMPANIES, CONTACTS, items as freshItems, notes as freshNotes, TYPES } from "./fixtures";

// A demo of the « Notifications » screen, apart from the app: no sign-in, no
// server. /maquette.html.
//
// It is the screen itself, not a copy: the routes it calls are answered here,
// in the page, after a pause the length of a real one, and nothing leaves the
// browser. The notes are the page's own, never the phone's store — the demo
// shares the app's origin, and deleting a note here must not touch a real one.

let queue: ReviewItem[] = freshItems();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return reply({ error: "Hors de la maquette" }, 404);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const drop = (id: string) => (queue = queue.filter((item) => item.id !== id));
  switch (url.pathname) {
    case "/api/readai/items":
      await pause(400);
      return reply({ items: queue, excluded: [], count: queue.length });
    case "/api/readai/settle":
      // Contacts created, then the note: a few seconds for real.
      await pause(1400);
      drop(body.itemId);
      return reply({ closed: true, noteUrl: "#" });
    case "/api/readai/ignore":
      await pause(300);
      drop(body.itemId);
      return reply({ closed: true, noteUrl: null });
    case "/api/readai/retry":
      await pause(1400);
      drop(body.itemId);
      return reply({ closed: true, noteUrl: "#" });
    case "/api/companies":
      return reply({ companies: COMPANIES, typeOptions: [] });
    default:
      return reply({ ok: true });
  }
};

const contacts: ContactsState = { status: "ready", contacts: CONTACTS, typeOptions: TYPES };

function Demo() {
  const toast = useToast();
  const [notes, setNotes] = useState<Note[]>(freshNotes);
  return (
    <NotificationsScreen
      active
      contacts={contacts}
      focusId={null}
      notes={notes}
      onDeleteNote={(id) => setNotes((list) => list.filter((note) => note.id !== id))}
      onBack={() => toast.show("Dans l'app : retour à l'accueil.")}
      onCount={() => undefined}
      onOpenNote={() => toast.show("Dans l'app : la note s'ouvre pour choisir un contact ou l'envoyer.")}
      onOpenExcluded={() => toast.show("Dans l'app : Réglages › Contacts exclus.")}
      onUnauthorized={() => undefined}
    />
  );
}

function Maquette() {
  // A new key resets everything to the first state.
  const [round, setRound] = useState(0);
  return (
    <ToastProvider>
      <div className="mx-auto min-h-full max-w-[480px]">
        <div
          className="mx-4 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-[color:var(--hairline)] px-4 py-2.5"
          style={{ marginTop: "calc(var(--safe-top) + 12px)" }}
        >
          <p className="text-xs text-[color:var(--muted)]">Maquette : données fictives, rien n'est envoyé.</p>
          <button
            type="button"
            onClick={() => {
              queue = freshItems();
              setRound((n) => n + 1);
            }}
            className="shrink-0 text-xs font-medium text-navy"
          >
            Réinitialiser
          </button>
        </div>
        <Demo key={round} />
      </div>
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Maquette />
  </StrictMode>,
);
