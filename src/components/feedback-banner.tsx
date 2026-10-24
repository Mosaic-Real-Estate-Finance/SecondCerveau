import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { StackBanner } from "@/components/stack-banner";
import { SuccessCheck } from "@/components/success-check";
import { VoiceRecorder } from "@/components/voice-recorder";
import { bannerSlot } from "@/lib/banner-slot";
import { feedbackAsked, sendFeedback, useFeedbackDue, type Feeling } from "@/lib/feedback";
import { useQuickDictation } from "@/lib/quick-dictation";
import { cn } from "@/lib/utils";

// Feedback, in two places.
//
// On the home screen, once a dictation has reached Notion, a few times only
// (lib/feedback.ts) and never with another banner (lib/banner-slot.ts): « Ça
// s'est bien passé ? », answered at once — yes, and it is thanked; a
// problem, and the banner morphs into the field to say what happened.
//
// At the top of the settings, there whenever wanted: the whole card opens
// straight onto the field.
//
// Every opening is transitions.dev 20, plus menu morph: the box takes the
// height of the face on show on the bouncier ease, the first face slides out
// blurred, the next slides in. The field's microphone is the same morph one
// level down: the field gives way to the live dictation, and back.

/** Left alone, the question fades after this long. */
const SHOWN_MS = 8000;
/** Once landed on the home screen, the time for the page slide to settle. */
const SETTLE_MS = 1200;
/** « Merci », then gone. */
const THANKS_MS = 1800;

// ---- The morph -------------------------------------------------------------

function MorphBox({
  open,
  closed,
  opened,
  faceClassName,
}: {
  open: boolean;
  closed: ReactNode;
  opened: ReactNode;
  faceClassName?: string;
}) {
  // The face on show is measured as it changes: the form grows an error
  // line, the dictation its text, the thanks replace the field.
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

  return (
    <div className="morph-box" data-open={open} style={{ height }}>
      <div ref={closedFace} className={cn("morph-face morph-closed", faceClassName)} aria-hidden={open} inert={open}>
        {closed}
      </div>
      <div ref={openFace} className={cn("morph-face morph-open", faceClassName)} aria-hidden={!open} inert={!open}>
        {opened}
      </div>
    </div>
  );
}

function Thanks() {
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <SuccessCheck show />
      <p className="mt-2 font-semibold">Merci pour votre retour</p>
      <p className="mt-0.5 text-xs text-[color:var(--muted)]">Il nous aide à améliorer l'app.</p>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Fermer"
      className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--muted)]"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

// ---- The field, and its microphone ----------------------------------------

function FeedbackField({
  feeling,
  placeholder,
  required = false,
  onSent,
}: {
  feeling: Feeling;
  placeholder: string;
  /** No sending an empty field. */
  required?: boolean;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dictation = useQuickDictation();
  const dictating = dictation.state !== "idle" && dictation.state !== "error";

  const stopDictating = async () => {
    const said = await dictation.finish();
    if (said) setText((current) => (current.trim() ? `${current.trimEnd()} ${said}` : said));
  };

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      await sendFeedback(feeling, text);
      onSent();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <MorphBox
        open={dictating}
        closed={
          <div className="feedback-field relative">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={placeholder}
              className="block w-full resize-none rounded-xl bg-[var(--banner-field)] py-2.5 pl-3 pr-12 text-base leading-snug placeholder:text-[color:var(--muted)]"
            />
            <button
              type="button"
              onClick={() => void dictation.start()}
              aria-label="Dicter votre retour"
              className="absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center rounded-full text-navy"
            >
              <Icon name="microphone.circle.fill" className="h-7" />
            </button>
          </div>
        }
        opened={
          <div className="flex flex-col gap-2 rounded-xl bg-[var(--banner-field)] p-2">
            <p
              className="feedback-live min-h-[66px] px-1 pt-1 text-base leading-snug"
              aria-live="polite"
            >
              {dictation.text || (
                <span className="text-[color:var(--muted)]">
                  {dictation.state === "starting" ? "Ouverture du micro…" : "Parlez, le texte s'affiche ici."}
                </span>
              )}
            </p>
            <VoiceRecorder
              size="sm"
              state={dictation.state === "finishing" ? "transcribing" : dictation.state === "live" ? "recording" : "idle"}
              amplitudes={dictation.amplitudes}
              elapsed={dictation.elapsed}
              onFinish={dictation.state === "live" ? () => void stopDictating() : undefined}
              finishLabel="Terminer la dictée"
              className="w-full"
            />
          </div>
        }
      />
      {(error || dictation.error) && <p className="mt-1.5 text-xs text-danger">{error ?? dictation.error}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={sending || dictating || (required && !text.trim())}
        className="mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-navy font-medium text-on-accent disabled:opacity-50"
      >
        {sending ? "Envoi…" : error ? "Réessayer" : "Envoyer"}
      </button>
    </div>
  );
}

// ---- Home ----------------------------------------------------------------

export function FeedbackBanner({ visible }: { visible: boolean }) {
  const due = useFeedbackDue();
  const [showing, setShowing] = useState(false);
  const [answer, setAnswer] = useState<"satisfied" | "problem" | null>(null);
  const [round, setRound] = useState(0);

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

  // Unanswered, it goes; answered, it stays until done or closed.
  useEffect(() => {
    if (!showing || answer) return;
    const timer = window.setTimeout(() => setShowing(false), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [showing, answer]);

  // Leaving the home screen ends it, answered or not.
  useEffect(() => {
    if (!visible) setShowing(false);
  }, [visible]);

  useEffect(() => {
    if (showing) return;
    bannerSlot.release("feedback");
    setAnswer(null);
    setRound((n) => n + 1);
  }, [showing]);

  const lift = useKeyboardLift(answer === "problem");
  const close = () => setShowing(false);

  return (
    <StackBanner visible={showing && visible} label="Votre avis" fade lift={lift} className="feedback-banner">
      <MorphBox
        open={answer !== null}
        closed={
          <>
            <p className="text-balance font-semibold">Ça s'est bien passé&nbsp;?</p>
            <p className="mt-0.5 text-balance text-xs text-[color:var(--muted)]">
              Un problème&nbsp;? Une amélioration à faire&nbsp;? Dites-nous.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setAnswer("satisfied")}
                className="h-11 flex-1 whitespace-nowrap rounded-xl bg-navy px-3 font-medium text-on-accent"
              >
                Oui, très bien
              </button>
              <button
                type="button"
                onClick={() => setAnswer("problem")}
                className="h-11 flex-1 whitespace-nowrap rounded-xl bg-[var(--banner-field)] px-3 font-medium text-midnight-blue"
              >
                Un problème
              </button>
            </div>
          </>
        }
        opened={
          answer === "satisfied" ? (
            <SendSatisfied key={round} onDone={() => window.setTimeout(close, THANKS_MS)} />
          ) : (
            <ProblemForm key={round} onClose={close} />
          )
        }
      />
    </StackBanner>
  );
}

/** « Oui, très bien »: nothing more to ask; sent, then thanked. */
function SendSatisfied({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<"sending" | "done" | "failed">("sending");
  const send = () => {
    setStatus("sending");
    sendFeedback("satisfied", "").then(
      () => {
        setStatus("done");
        onDone();
      },
      () => setStatus("failed"),
    );
  };
  // Once, as the answer is given.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(send, []);
  if (status === "done") return <Thanks />;
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <p className="text-xs text-[color:var(--muted)]">
        {status === "sending" ? "Envoi…" : "Le retour n'a pas pu être envoyé."}
      </p>
      {status === "failed" && (
        <button type="button" onClick={send} className="shrink-0 rounded-full bg-navy px-4 py-2 font-medium text-on-accent">
          Réessayer
        </button>
      )}
    </div>
  );
}

function ProblemForm({ onClose }: { onClose: () => void }) {
  const [sent, setSent] = useState(false);
  if (sent) return <Thanks />;
  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="pt-1 font-semibold">Que s'est-il passé&nbsp;?</p>
        <CloseButton onClick={onClose} />
      </div>
      <FeedbackField
        feeling="problem"
        required
        placeholder="Décrivez ce qui s'est passé, ou ce qu'on pourrait améliorer…"
        onSent={() => {
          setSent(true);
          window.setTimeout(onClose, THANKS_MS);
        }}
      />
    </>
  );
}

// ---- Settings ------------------------------------------------------------

export function SettingsFeedback() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  // A new form at each opening: the last answer is not left in it.
  const [round, setRound] = useState(0);
  const close = () => {
    setOpen(false);
    window.setTimeout(() => {
      setSent(false);
      setRound((n) => n + 1);
    }, 300);
  };
  const title = (
    <>
      <Icon name="plus.message" className="mr-2 h-[17px] translate-y-[3px] text-navy" />
      Un retour à nous partager&nbsp;?
    </>
  );

  return (
    <section className="mb-4 rounded-2xl bg-white-smoke">
      <MorphBox
        open={open}
        faceClassName="p-4"
        closed={
          // The whole card is the button.
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-m-4 block w-[calc(100%+2rem)] rounded-2xl p-4 text-left transition-transform active:scale-[0.98]"
          >
            <span className="block text-base font-medium">{title}</span>
            <span className="mt-1 block text-xs text-[color:var(--muted)]">
              Dites-nous comment on pourrait améliorer l'application.
            </span>
          </button>
        }
        opened={
          sent ? (
            <Thanks />
          ) : (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <p className="pt-1 text-base font-medium">{title}</p>
                <CloseButton onClick={close} />
              </div>
              <FeedbackField
                key={round}
                feeling="free"
                required
                placeholder="Une idée, un problème, une remarque…"
                onSent={() => {
                  setSent(true);
                  window.setTimeout(close, THANKS_MS);
                }}
              />
            </>
          )
        }
      />
    </section>
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
