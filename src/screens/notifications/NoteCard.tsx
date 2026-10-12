import { useState } from "react";
import { PrimaryButton, statusLabel, TextButton } from "@/components/screen";
import { Sheet } from "@/components/sheet";
import { formatTime } from "@/components/voice-recorder";
import { removeNote, type Note } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { formatWhen } from "@/lib/when";

// A dictation still on this phone, not yet in Notion. The same card as a
// meeting's: what it is, what it says, and two answers — carry on, or delete.
// Deleting used to be at the bottom of the note's own screen, behind the
// choice of a contact; it is here now, in plain view, and asks once.

const LEAVE_MS = 420;

/** The one thing to do next, as the button says it. */
function nextStep(note: Note) {
  if (note.status === "send-failed") return "Réessayer l'envoi";
  if (note.status === "transcription-failed") return "Ouvrir la note";
  if (note.contact === undefined) return "Choisir un contact";
  return "Vérifier et envoyer";
}

export function NoteCard({
  note,
  onOpen,
  onDelete = removeNote,
}: {
  note: Note;
  onOpen: (note: Note) => void;
  /** The phone's own store by default; the mockup keeps its notes apart. */
  onDelete?: (id: string) => unknown;
}) {
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const text = note.transcript || note.partial || "";
  const failed = note.status === "transcription-failed" || note.status === "send-failed";
  // Being written to Notion right now: deleting it would race the page.
  const sending = note.status === "sending";

  const remove = () => {
    setConfirming(false);
    setLeaving(true);
    // Folded away first, then forgotten: the list does not jump.
    window.setTimeout(() => void onDelete(note.id), LEAVE_MS);
  };

  return (
    <div className={cn("meeting-collapse", leaving && "is-closed")}>
      <div className="meeting-collapse-inner">
        <article className="rounded-2xl bg-white-smoke p-4">
          <header>
            <h3 className="truncate text-base font-semibold leading-snug">
              {note.contact ? note.contact.name : note.contact === null ? "Dictée sans contact" : "Dictée"}
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              {formatWhen(new Date(note.createdAt))} · {formatTime(note.duration)}
            </p>
          </header>

          <h4 className="mt-3 px-1 text-2xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            {statusLabel(note)}
          </h4>
          <div className="mt-1.5 rounded-xl bg-white px-3 py-2.5">
            {text ? (
              <p className="line-clamp-3 text-[14px] leading-snug">{text}</p>
            ) : (
              <p className="text-xs text-[color:var(--muted)]">
                {failed
                  ? note.error
                    ? `${note.error.charAt(0).toUpperCase()}${note.error.slice(1)}.`
                    : "La transcription n'a pas abouti."
                  : "Le texte apparaîtra ici une fois la dictée transcrite."}
              </p>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <PrimaryButton
              onClick={() => onOpen(note)}
              disabled={leaving}
              className="h-12 flex-1 whitespace-nowrap rounded-xl px-3"
            >
              {nextStep(note)}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={sending || leaving}
              className="h-12 flex-1 whitespace-nowrap rounded-xl bg-white px-3 font-medium text-midnight-blue disabled:opacity-40"
            >
              Supprimer
            </button>
          </div>
        </article>
      </div>

      <Sheet open={confirming} onClose={() => setConfirming(false)} label="Supprimer la dictée">
        <div>
          <h2 className="font-serif text-2xl">Supprimer cette dictée&nbsp;?</h2>
          <p className="mt-2 text-[color:var(--muted)]">
            L'enregistrement et sa transcription sont effacés de ce téléphone. Rien n'a encore été envoyé dans Notion :
            elle ne pourra pas être récupérée.
          </p>
          <button
            type="button"
            onClick={remove}
            className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-danger px-5 text-base font-medium text-on-accent"
          >
            Supprimer la dictée
          </button>
          <div className="mt-2 flex justify-center">
            <TextButton onClick={() => setConfirming(false)}>Annuler</TextButton>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
