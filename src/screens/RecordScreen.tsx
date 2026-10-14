import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { VoiceBeam } from "voice-glow";
import { Icon } from "@/components/icon";
import { Symbol } from "@/components/logo";
import { Screen, TextButton } from "@/components/screen";
import { useToast } from "@/components/toast";
import { VoiceRecorder } from "@/components/voice-recorder";
import { useConnectivity, type Connectivity } from "@/lib/connectivity";
import { storageIsDurable, useNote, useNotes, type Note } from "@/lib/notes";
import { pageSlideMs } from "@/lib/schedule";
import { cssVar, useColorScheme } from "@/lib/theme";
import { useMeter, useRecorder, type Hold } from "@/lib/use-recorder";

// The glow stays in the Mosaic blues: navy at the centre, lighter tints of the
// same hue outward, no hue drift. The values are the theme's (--beam-* in
// index.css), read again when the system turns light or dark.
const beamPalette = () => {
  const [core, mid, above, edge, deep] = ["--beam-core", "--beam-mid", "--beam-above", "--beam-edge", "--beam-deep"].map(cssVar);
  return {
    colors: [core, mid, above, deep, edge, mid, above],
    band: { core, above, mid, below: deep },
  };
};

// Multipliers on the light theme's own (stroke 1.2, inner 0.85, bloom 0.5),
// plus a little more colour and a little more gain.
const BEAM_DENSITY = {
  strokeOpacity: 1.3,
  innerOpacity: 1.9,
  bloomOpacity: 2.4,
  brightness: 1.25,
  saturation: 2.1,
  sensitivity: 3.8,
  // Breathing between words, so the screen never looks dead mid sentence.
  idle: 0.26,
} as const;

/** The panel's opening, as in index.css (.record-panel). */
const OPEN_MS = 420;

const PROMPTS = ["Qu'est-ce qu'on note aujourd'hui ?", "Un point à enregistrer ?", "Une info à enregistrer ?"];

export function RecordScreen({
  active,
  firstName,
  reviewCount,
  onRecorded,
  onReview,
  onSettings,
}: {
  active: boolean;
  firstName: string;
  /** Read AI calls waiting for a decision. */
  reviewCount: number;
  onRecorded: (note: Note) => void;
  onReview: () => void;
  onSettings: () => void;
}) {
  const recorder = useRecorder();
  const notes = useNotes();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Set while the panel is reset behind a screen that has already left, so
  // its own animation does not run against the page slide.
  const [quiet, setQuiet] = useState(false);
  const recording = recorder.state === "starting" || recorder.state === "recording";
  // No recording is offered that could not be transcribed: the dictation is
  // turned into text live, on the network. A dictation already under way is
  // not interrupted by this — it holds and resumes on its own (use-recorder).
  const connectivity = useConnectivity(active);

  const blocked = !open && !recording && connectivity.status !== "online" && connectivity.status !== "checking";
  // While a bad link is being checked again, the screen stays on what it said.
  const [shownBlocked, setShownBlocked] = useState(false);
  useEffect(() => {
    if (connectivity.status !== "checking") setShownBlocked(blocked);
  }, [blocked, connectivity.status]);
  const offline = shownBlocked && !open && !recording;

  // Drawn once per app launch, not on every render.
  const prompt = useMemo(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)], []);

  // Notes not yet in Notion, minus the one being dictated right now. They are
  // listed in « Notifications »; here they only light the bell.
  const pending = notes.filter((note) => !(recording && note.status === "recording")).length;
  const waiting = reviewCount + pending;

  // Pointer down, not click: the recording starts as the finger lands, about
  // a tenth of a second before the click would fire. The click stays for
  // keyboards and screen readers.
  // The glow comes once the panel is open: mounting it is heavy (blurred
  // layers the size of the screen), and done mid opening it took frames from
  // the panel's own animation.
  const [beamOn, setBeamOn] = useState(false);
  useEffect(() => {
    if (!active || recorder.state !== "recording") return setBeamOn(false);
    const timer = window.setTimeout(() => setBeamOn(true), OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [active, recorder.state]);

  const openPanel = () => {
    if (open || offline) return;
    setOpen(true);
    void recorder.start();
  };

  const finish = async () => {
    // Saving no longer fails on its own — the note is held in memory and the
    // database is only the safety net under it — but reading the recording
    // out of the recorder still can. Without this the panel simply stayed
    // open and recording, with nothing said.
    let note: Note | null = null;
    try {
      note = await recorder.stop();
    } catch {
      toast.show("L'enregistrement n'a pas pu être relu. Réessayez.");
    }
    if (!note) return setOpen(false);
    // The dictation is safe in memory; what failed is only the copy that
    // would survive the tab being closed. Worth saying, not worth blocking.
    if (!storageIsDurable()) {
      toast.show("Sauvegarde hors ligne indisponible : envoyez la note sans fermer l'onglet.");
    }
    // Stopping took the glow down with it, and letting go of a canvas that
    // size costs the compositor a frame. It is given that frame here rather
    // than in the middle of the slide, where it showed as a stutter.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // The screen leaves next. The panel is on it, so it goes with it; it is
    // put back to a button once the slide is over, out of sight and without
    // an animation of its own to compete with the one on screen.
    onRecorded(note);
    setQuiet(true);
    window.setTimeout(() => setOpen(false), pageSlideMs());
    window.setTimeout(() => setQuiet(false), pageSlideMs() + 80);
  };

  const cancel = async () => {
    await recorder.cancel();
    setOpen(false);
  };

  // A dictation dropped by a transcription outage: the panel closes and the
  // banner explains (OutageBanner).
  useEffect(() => {
    if (recorder.shelved) setOpen(false);
  }, [recorder.shelved]);

  // Leaving the screen with the panel open (resume from the list) closes it.
  useEffect(() => {
    if (!active && open && !recording) setOpen(false);
  }, [active, open, recording]);

  return (
    <Screen>
      {/* Discreet on purpose: the screen is for dictating. The count is the
          only thing that asks for attention, and only when it is not zero. */}
      <div className="-mx-1 flex items-center justify-end">
        <button
          type="button"
          onClick={onReview}
          className="flex h-11 w-11 items-center justify-center rounded-full text-navy"
          aria-label={waiting ? `Notifications, ${waiting} en attente` : "Notifications"}
        >
          <Icon name={waiting > 0 ? "bell.badge" : "bell"} className="h-[22px]" />
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Réglages"
          className="flex h-11 w-11 items-center justify-center rounded-full text-navy"
        >
          <Icon name="gear" className="h-[22px]" />
        </button>
      </div>
      {/* The greeting sits in the upper part; the button holds the middle of
          the screen, in the layer below. */}
      {offline ? (
        <NoConnection
          status={connectivity.status}
          unstable={connectivity.status === "unstable"}
          onRetry={() => void connectivity.check()}
        />
      ) : (
        <>
          {/* On a short window the logo goes first, then the type tightens:
              the greeting and the button must both fit above the fold. */}
          <div className="flex flex-col items-center pt-[5vh] text-center">
            <Symbol className="h-16 text-midnight-blue [@media(max-height:640px)]:hidden" />
            <h1 className="mt-8 text-balance font-serif text-2xl [@media(max-height:640px)]:mt-0 [@media(max-height:520px)]:text-xl">
              Bonjour {firstName},
              <br />
              {prompt}
            </h1>
          </div>
          {/* The rest of the screen, in the flow of the page, under the
              greeting: the microphone in its middle, the panel opening over
              it in place. Nothing is measured or positioned by script, so
              nothing can put the button over the greeting — not fonts
              arriving late, nor Safari's bars, nor a short window (the page
              scrolls instead). */}
          <div className="record-stage" data-open={open} data-quiet={quiet || undefined}>
            <div className="record-anchor">
              <div className="record-panel flex flex-col justify-between p-4" aria-hidden={!open} inert={!open}>
                <div className="flex items-center justify-between">
                  <span className="text-base text-on-accent" aria-live="polite">
                    {recorder.state === "error"
                      ? "Enregistrement impossible"
                      : recorder.unavailable
                        ? "Transcription indisponible"
                        : recorder.hold
                          ? "En pause, connexion perdue"
                          : recorder.paused
                            ? "En pause"
                            : recorder.state === "recording"
                              ? "Enregistrement"
                              : "Ouverture du micro"}
                  </span>
                  <TextButton onClick={cancel} className="-mr-3 text-on-accent" tabIndex={open ? 0 : -1}>
                    {recorder.state === "error" ? "Fermer" : "Annuler"}
                  </TextButton>
                </div>
                {recorder.state === "error" ? (
                  <p className="text-base text-on-accent">{recorder.error}</p>
                ) : (
                  <LiveText noteId={recorder.noteId} hold={recorder.hold} unavailable={recorder.unavailable} />
                )}
                {recorder.state !== "error" && (
                  <LiveRecorder
                    recording={recorder.state === "recording"}
                    paused={recorder.paused}
                    onTogglePause={recorder.togglePause}
                    onFinish={finish}
                  />
                )}
              </div>
              <button
                type="button"
                className="record-mic"
                aria-expanded={open}
                aria-label="Dicter une note"
                onPointerDown={openPanel}
                onClick={openPanel}
                tabIndex={open ? -1 : 0}
              >
                <Icon name="microphone" className="h-9" />
              </button>
            </div>
          </div>
        </>
      )}


      {/* Along the bottom of the screen, a glow that rises with the voice. */}
      {/* `active` as well as the state: the glow is rendered into <body>, so
          this screen leaving no longer takes it with it — opening a pending
          note mid dictation would have left it burning over the next page. */}
      {beamOn && <Beam stream={recorder.stream} paused={recorder.paused} />}

    </Screen>
  );
}

// The glow along the bottom of the screen.
//
// It is rendered into <body>, away from the page. The page carries the
// transform and the blur of the slide transition, and a transformed ancestor
// both becomes the containing block of its fixed children and clips them to
// its own box. The strip was therefore cut off flat a little above the
// bottom of the screen — the light was in a frame, sliced across its
// brightest part.
//
// Placed from <body> it is measured against the screen, and its bottom edge
// is put exactly on it: `100dvh` is what is visible right now, and
// `100lvh - 100dvh` is the height of whatever browser chrome is floating
// over the rest. Adding the two lands the edge on the physical bottom in an
// installed app, in Safari with its bar out, and in Safari with it retracted
// — so the light always comes from under the edge, never from a line drawn
// across the page. The mask makes the top of the strip unable to show a seam
// whatever the glow does inside it.
const BEAM_HEIGHT = "min(56dvh, 460px)";
// Masked at both ends. The top is where the dome would otherwise show a
// seam; the bottom is the answer to a Safari 26 bug that no length can work
// around — the browser refuses to render fixed content below its floating
// controls, so the glow always ends on that line and used to be sliced
// across its brightest part. Fading it out over its last tenth means it
// arrives there already faded into the page, whatever the theme,
// and the light reads as coming from beyond the edge instead of stopping at
// one. In an installed app there is no bar and no line, and the same fade
// simply softens the very bottom of the glow.
const BEAM_MASK = "linear-gradient(to bottom, transparent 0%, #000 34%, #000 90%, transparent 100%)";

function Beam({ stream, paused }: { stream: MediaStream | null; paused: boolean }) {
  const scheme = useColorScheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const palette = useMemo(beamPalette, [scheme]);
  return createPortal(
    <div
      aria-hidden
      // Under the page: over the screen's colour, behind the microphone and
      // its panel (html paints the colour, body none; index.css).
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10"
      style={{
        height: BEAM_HEIGHT,
        maskImage: BEAM_MASK,
        WebkitMaskImage: BEAM_MASK,
      }}
    >
      <VoiceBeam
        type="mobile"
        theme={scheme}
        // On hold the glow fades out rather than following the room.
        active={!paused}
        stream={stream}
        colors={palette.colors}
        bandColors={palette.band}
        staticColors
        // Denser than the library's light theme, which is tuned for a glow
        // under a chat input rather than one that has a whole phone screen
        // of white above it. The three layers are lifted together so the
        // shape does not change — only how much of it there is — and the
        // microphone runs with automatic gain, so the level that reaches the
        // analyser is flatter than the room and needs a little more gain.
        {...BEAM_DENSITY}
        // The two per-frame effects a phone cannot afford: an SVG turbulence
        // filter recomputed every frame, and the band line, whose clip-paths
        // repaint the blurred layers under it.
        distortion={0}
        bandStrength={0}
        className="h-full w-full"
      >
        <div className="h-full w-full" />
      </VoiceBeam>
    </div>,
    document.body,
  );
}

// Subscribes to the live meter itself, so the ten updates a second redraw the
// pill alone.
function LiveRecorder({
  recording,
  paused,
  onTogglePause,
  onFinish,
}: {
  recording: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onFinish: () => void;
}) {
  const { amplitudes, elapsed } = useMeter();
  return (
    <VoiceRecorder
      state={recording ? "recording" : "idle"}
      amplitudes={amplitudes}
      elapsed={elapsed}
      paused={paused}
      onTogglePause={recording ? onTogglePause : undefined}
      onFinish={recording ? onFinish : undefined}
      finishLabel="Terminer l'enregistrement"
      className="w-full"
    />
  );
}

// The words as they are recognised, between the status line and the pill.
// Subscribes to the note on its own, so the text updating several times a
// second redraws this paragraph alone. Anchored to the bottom and clipped at
// the top: the newest words are always in view, the oldest fade out above.
const LIVE_MASK = "linear-gradient(to bottom, transparent 0%, #000 40%)";

const HOLD_TEXT: Record<NonNullable<Hold>, string> = {
  offline: "La connexion est coupée. L'enregistrement reprendra seul dès qu'elle revient ; rien de ce qui a été dit n'est perdu.",
  background: "Reprise de l'enregistrement…",
};

function LiveText({ noteId, hold, unavailable }: { noteId: string | null; hold: Hold; unavailable: string | null }) {
  const text = useNote(noteId)?.partial ?? "";
  if (unavailable) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden py-2" aria-live="polite">
        <p className="text-base leading-snug text-on-accent">
          {unavailable.charAt(0).toUpperCase() + unavailable.slice(1)}. L'enregistrement continue : la dictée sera
          transcrite dès que le service répondra.
        </p>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden py-2"
      style={hold ? undefined : { maskImage: LIVE_MASK, WebkitMaskImage: LIVE_MASK }}
      aria-live="polite"
    >
      <p className="text-base leading-snug text-on-accent">
        {hold ? HOLD_TEXT[hold] : text || <span className="opacity-60">Parlez, le texte s'affiche ici.</span>}
      </p>
    </div>
  );
}

// In place of the greeting and the microphone when the network cannot carry a
// dictation. It checks again by itself; the button only does it sooner.
function NoConnection({
  status,
  unstable,
  onRetry,
}: {
  status: Connectivity;
  unstable: boolean;
  onRetry: () => void;
}) {
  const checking = status === "checking";
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-[8vh] text-center" role="alert">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white-smoke text-midnight-blue">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-9 w-9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 8.8a14 14 0 0 1 19 0" />
          <path d="M5.6 12.2a9.5 9.5 0 0 1 12.8 0" />
          <path d="M8.8 15.5a5 5 0 0 1 6.4 0" />
          <circle cx="12" cy="19" r="0.9" fill="currentColor" stroke="none" />
          <path d="M3.5 3.5l17 17" />
        </svg>
      </span>
      <h1 className="mt-8 text-balance font-serif text-2xl">
        {unstable ? "Connexion trop instable" : "Pas de connexion internet"}
      </h1>
      <p className="mt-3 max-w-[22rem] text-balance text-base text-[color:var(--muted)]">
        La dictée est transcrite en direct : elle a besoin d'une connexion stable. Vérifiez le Wi-Fi ou le réseau
        mobile, l'enregistrement sera proposé dès qu'elle revient.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={checking}
        className="mt-8 flex h-12 items-center justify-center rounded-full bg-white-smoke px-6 text-base font-medium text-navy disabled:opacity-60"
      >
        {checking ? "Vérification…" : "Vérifier la connexion"}
      </button>
    </div>
  );
}
