import { useState } from "react";
import { sendFeedback, type Feeling } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { currentUser } from "./office";

// How it went, asked once the note is in Notion — never before, never in the
// way. The note is already written whatever happens here: this box sends a
// feedback to « Retours sur l'app » through the same route as the dictation's
// (functions/api/feedback.ts), and nothing else.
//
// Nothing of the mail travels with it: not the subject, not a contact, not a
// file name. Only what the user types, the device, and whose mailbox it is
// (turned into a first name on the server, as for every other feedback).
//
// No dictation field here: the app's FeedbackField records through the
// microphone, which a taskpane does not reliably get.

type Choice = { feeling: Feeling; label: string; ask: string | null; prefix: string };

const CHOICES: Choice[] = [
  { feeling: "satisfied", label: "Ça marche bien", ask: null, prefix: "" },
  { feeling: "problem", label: "J'ai eu un problème", ask: "Qu'est-ce qui s'est passé ?", prefix: "" },
  // No column value of its own: « Retour libre », marked in the comment so the
  // missing features can be sorted out of the free remarks.
  {
    feeling: "free",
    label: "Il manque une fonctionnalité",
    ask: "Qu'aimerais-tu pouvoir faire ?",
    prefix: "Fonctionnalité manquante (Outlook) : ",
  },
];

const DEVICE = "Complément Outlook";

export function OutlookFeedback() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | { error: string }>("idle");

  const submit = async (picked: Choice, comment: string) => {
    setState("sending");
    try {
      const body = comment.trim() ? `${picked.prefix}${comment.trim()}` : picked.prefix.replace(/ : $/, "");
      await sendFeedback(picked.feeling, body, { device: DEVICE, user: currentUser() });
      setState("sent");
    } catch (error) {
      setState({ error: (error as Error)?.message || "Le retour n'a pas pu être envoyé. Réessaye." });
    }
  };

  if (state === "sent") {
    return <p className="text-center text-xs text-[color:var(--muted)]">Merci pour ton retour.</p>;
  }

  const sending = state === "sending";
  const error = typeof state === "object" ? state.error : null;

  return (
    <div className="rounded-2xl border border-[color:var(--color-white-smoke)] bg-white p-3">
      <p className="mb-2 text-xs text-[color:var(--muted)]">Un retour sur le complément ? (facultatif)</p>
      <div className="flex flex-wrap gap-1.5">
        {CHOICES.map((one) => (
          <button
            key={one.feeling}
            type="button"
            disabled={sending}
            aria-pressed={choice?.feeling === one.feeling}
            className={cn("chip", choice?.feeling === one.feeling && "on")}
            onClick={() => {
              setChoice(one);
              // Nothing to add to « ça marche » : sent on the tap.
              if (!one.ask) void submit(one, "");
            }}
          >
            {one.label}
          </button>
        ))}
      </div>
      {choice?.ask && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            className="min-h-20 w-full rounded-xl bg-white-smoke px-3 py-2 text-sm text-midnight-blue outline-none"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={choice.ask}
            aria-label={choice.ask}
            maxLength={1800}
          />
          <p className="text-2xs text-[color:var(--muted)]">
            N'y colle pas le contenu du mail : décris ce que tu as fait et ce que tu attendais.
          </p>
          <button
            type="button"
            disabled={sending || !text.trim()}
            className="self-end rounded-full bg-navy px-4 py-2 text-xs text-on-accent disabled:opacity-50"
            onClick={() => void submit(choice, text)}
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-2xs text-[color:var(--muted)]">{error}</p>}
    </div>
  );
}
