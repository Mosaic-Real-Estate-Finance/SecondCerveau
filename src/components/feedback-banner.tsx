import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StackBanner } from "@/components/stack-banner";
import { SuccessCheck } from "@/components/success-check";
import { bannerSlot } from "@/lib/banner-slot";
import { feedbackAsked, sendFeedback, useFeedbackDue, type Feeling } from "@/lib/feedback";
import { cn } from "@/lib/utils";

// How did that dictation go? Asked on the home screen once a dictation has
// reached Notion, a few times only (lib/feedback.ts), and never on screen
// with another banner (lib/banner-slot.ts).
//
// The banner holds one button; tapped, it morphs into the form in place —
// transitions.dev 20, plus menu morph: the box grows to the form's height on
// the bouncier ease, the banner's face slides out blurred and the form's
// slides in. Two answers first, then the field to say what happened.

/** Left alone, the question fades after this long. */
const SHOWN_MS = 8000;
/** Once landed on the home screen, the time for the page slide to settle. */
const SETTLE_MS = 1200;
/** « Merci », then gone. */
const THANKS_MS = 1800;

type Step = "ask" | "write" | "sending" | "done";

export function FeedbackBanner({ visible }: { visible: boolean }) {
  const due = useFeedbackDue();
  const [showing, setShowing] = useState(false);
  const [open, setOpen] = useState(false);

  // Due and on the home screen: wait for the place, then take it.
  useEffect(() => {
    if (!due || !visible || showing) return;
    let timer = 0;
    const attempt = () => {
      if (bannerSlot.claim("feedback")) {
        feedbackAsked();
        setShowing(true);
        return;
      }
      timer = window.setTimeout(attempt, Math.max(bannerSlot.waitMs(), 1000));
    };
    timer = window.setTimeout(attempt, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [due, visible, showing]);

  // Untouched, it goes; opened, it stays until answered or closed.
  useEffect(() => {
    if (!showing || open) return;
    const timer = window.setTimeout(() => setShowing(false), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [showing, open]);

  // Leaving the home screen ends it, answered or not.
  useEffect(() => {
    if (!visible) setShowing(false);
  }, [visible]);

  useEffect(() => {
    if (showing) return;
    bannerSlot.release("feedback");
    setOpen(false);
  }, [showing]);

  const lift = useKeyboardLift(open);

  return (
    <StackBanner visible={showing && visible} label="Votre avis" fade lift={lift} className="feedback-banner">
      <FeedbackMorph open={open} onOpen={() => setOpen(true)} onClose={() => setShowing(false)} />
    </StackBanner>
  );
}

function FeedbackMorph({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>("ask");
  const [feeling, setFeeling] = useState<Feeling>("satisfied");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The box takes the height of the face on show, measured as it changes:
  // the form grows a field, an error line, the thanks.
  const closedFace = useRef<HTMLDivElement>(null);
  const openFace = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const face = open ? openFace.current : closedFace.current;
    if (!face) return;
    const measure = () => setHeight(face.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(face);
    return () => observer.disconnect();
  }, [open]);

  const field = useRef<HTMLTextAreaElement>(null);
  const choose = (next: Feeling) => {
    setFeeling(next);
    setStep("write");
    // After the field is in place, so the keyboard rises on its own tap.
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  };

  const submit = async () => {
    setStep("sending");
    setError(null);
    try {
      await sendFeedback(feeling, text);
      field.current?.blur();
      setStep("done");
      window.setTimeout(onClose, THANKS_MS);
    } catch (cause) {
      setError((cause as Error).message);
      setStep("write");
    }
  };

  return (
    <div className="feedback-morph" data-open={open} style={{ height }}>
      <div ref={closedFace} className="feedback-face feedback-closed" aria-hidden={open} inert={open}>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Dictée bien envoyée</p>
          <p className="mt-0.5 text-xs text-[color:var(--muted)]">Comment ça s'est passé ?</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-full bg-navy px-4 py-2.5 font-medium text-on-accent"
        >
          Donner mon avis
        </button>
      </div>

      <div ref={openFace} className="feedback-face feedback-open" aria-hidden={!open} inert={!open}>
        {step === "done" ? (
          <div className="flex flex-col items-center py-2 text-center">
            <SuccessCheck show />
            <p className="mt-2 font-semibold">Merci pour votre retour</p>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">Il nous aide à améliorer l'app.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="pt-1 font-semibold">
                {step === "ask"
                  ? "Êtes-vous satisfait de cette dictée ?"
                  : feeling === "problem"
                    ? "Que s'est-il passé ?"
                    : "Un mot pour améliorer l'app ?"}
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)]"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {step === "ask" ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => choose("satisfied")}
                  className="h-11 flex-1 whitespace-nowrap rounded-xl bg-navy px-3 font-medium text-on-accent"
                >
                  Oui, satisfait
                </button>
                <button
                  type="button"
                  onClick={() => choose("problem")}
                  className="h-11 flex-1 whitespace-nowrap rounded-xl bg-[var(--banner-field)] px-3 font-medium text-midnight-blue"
                >
                  J'ai eu un problème
                </button>
              </div>
            ) : (
              <>
                <textarea
                  ref={field}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={
                    feeling === "problem"
                      ? "Décrivez ce qui s'est passé : à quel moment, ce que vous avez vu…"
                      : "Facultatif"
                  }
                  className="mt-2 w-full resize-none rounded-xl bg-[var(--banner-field)] px-3 py-2.5 text-base leading-snug outline-none placeholder:text-[color:var(--muted)]"
                />
                {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={step === "sending" || (feeling === "problem" && !text.trim())}
                  className={cn(
                    "mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-navy font-medium text-on-accent",
                    "disabled:opacity-50",
                  )}
                >
                  {step === "sending" ? "Envoi…" : error ? "Réessayer" : "Envoyer"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * How far the keyboard covers the bottom of the screen, while `active`: the
 * banner sits at the bottom, and a field there would type under the keys.
 */
function useKeyboardLift(active: boolean) {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return setLift(0);
    const update = () => setLift(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);
  return lift;
}
