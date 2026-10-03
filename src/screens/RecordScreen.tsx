import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { VoiceBeam } from "voice-glow";
import { Symbol } from "@/components/logo";
import { noteDate, Screen, statusLabel, TextButton } from "@/components/screen";
import { useToast } from "@/components/toast";
import { formatTime, VoiceRecorder } from "@/components/voice-recorder";
import { storageIsDurable, useNotes, type Note } from "@/lib/notes";
import { pageSlideMs } from "@/lib/schedule";
import { coolMicrophone, useMeter, useRecorder, warmMicrophone } from "@/lib/use-recorder";

// The glow stays in the Mosaic blues: navy at the centre, lighter tints of the
// same hue outward, no hue drift.
const BEAM_COLORS = ["#000082", "#1f1fb0", "#3d3dd6", "#020342", "#5b5be8", "#1f1fb0", "#3d3dd6"];
const BEAM_BAND = { core: "#000082", above: "#3d3dd6", mid: "#1f1fb0", below: "#020342" };

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

const PROMPTS = ["Qu'est-ce qu'on note aujourd'hui ?", "Un point à enregistrer ?", "Une info à enregistrer ?"];

export function RecordScreen({
  active,
  firstName,
  onRecorded,
  onOpen,
}: {
  active: boolean;
  firstName: string;
  onRecorded: (note: Note) => void;
  onOpen: (note: Note) => void;
}) {
  const recorder = useRecorder();
  const notes = useNotes();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Set while the panel is reset behind a screen that has already left, so
  // its own animation does not run against the page slide.
  const [quiet, setQuiet] = useState(false);
  const recording = recorder.state === "starting" || recorder.state === "recording";

  // Drawn once per app launch, not on every render.
  const prompt = useMemo(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)], []);

  // Pending notes, minus the one being dictated right now.
  const pending = notes.filter((note) => !(recording && note.status === "recording"));

  // Pointer down, not click: the recording starts as the finger lands, about
  // a tenth of a second before the click would fire. The click stays for
  // keyboards and screen readers.
  const openPanel = () => {
    if (open) return;
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

  // Leaving the screen with the panel open (resume from the list) closes it.
  useEffect(() => {
    if (!active && open && !recording) setOpen(false);
  }, [active, open, recording]);

  // The microphone stays open while this screen is on show, so a press
  // records at once; it is released as soon as the app or the screen is left.
  useEffect(() => {
    const sync = () => {
      if (active && document.visibilityState === "visible") void warmMicrophone();
      else if (!recording) coolMicrophone();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active, recording]);

  return (
    <Screen>
      {/* The greeting sits in the upper part; the button holds the middle of
          the screen, in the layer below. */}
      <div className="flex flex-col items-center pt-[9vh] text-center">
        <Symbol className="h-16 text-midnight-blue" />
        <h1 className="mt-8 text-balance font-serif text-2xl">
          Bonjour {firstName},
          <br />
          {prompt}
        </h1>
      </div>
      <div className="flex-1" aria-hidden />

      {pending.length > 0 && (
        <section aria-labelledby="pending-title" className="pb-2">
          <h2 id="pending-title" className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            En attente
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {pending.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onOpen(note)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white-smoke px-4 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium">
                      {note.contact ? note.contact.name : noteDate(note.createdAt)}
                    </span>
                    <span className="block text-xs text-[color:var(--muted)]">
                      {statusLabel(note)}, {formatTime(note.duration)}
                    </span>
                  </span>
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="h-5 w-5 shrink-0 text-navy"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Along the bottom of the screen, a glow that rises with the voice. */}
      {/* `active` as well as the state: the glow is rendered into <body>, so
          this screen leaving no longer takes it with it — opening a pending
          note mid dictation would have left it burning over the next page. */}
      {active && recorder.state === "recording" && <Beam stream={recorder.stream} paused={recorder.paused} />}

      {/* Centred on the screen, growing into the recording panel. */}
      <div className="pointer-events-none fixed inset-0 z-20 mx-auto flex max-w-[480px] items-center justify-center px-4">
        <div className="record-morph t-morph pointer-events-auto" data-open={open} data-quiet={quiet || undefined}>
          <div className="t-morph-menu flex flex-col justify-between p-4" aria-hidden={!open}>
            <div className="flex items-center justify-between">
              <span className="text-base text-white" aria-live="polite">
                {recorder.state === "error"
                  ? "Enregistrement impossible"
                  : recorder.paused
                    ? "En pause"
                    : recorder.state === "recording"
                      ? "Enregistrement"
                      : "Ouverture du micro"}
              </span>
              <TextButton onClick={cancel} className="-mr-3 text-white" tabIndex={open ? 0 : -1}>
                {recorder.state === "error" ? "Fermer" : "Annuler"}
              </TextButton>
            </div>
            {recorder.state === "error" ? (
              <p className="text-base text-white">{recorder.error}</p>
            ) : (
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
            className="t-morph-plus"
            aria-expanded={open}
            aria-label="Dicter une note"
            onPointerDown={openPanel}
            onClick={openPanel}
            tabIndex={open ? -1 : 0}
          >
            <svg
              viewBox="0 0 24 24"
              width="40"
              height="40"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            </svg>
          </button>
        </div>
      </div>
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
// arrives there already white, the same white the canvas shows underneath,
// and the light reads as coming from beyond the edge instead of stopping at
// one. In an installed app there is no bar and no line, and the same fade
// simply softens the very bottom of the glow.
const BEAM_MASK = "linear-gradient(to bottom, transparent 0%, #000 34%, #000 90%, transparent 100%)";

function Beam({ stream, paused }: { stream: MediaStream | null; paused: boolean }) {
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20"
      style={{
        height: BEAM_HEIGHT,
        maskImage: BEAM_MASK,
        WebkitMaskImage: BEAM_MASK,
      }}
    >
      <VoiceBeam
        type="mobile"
        theme="light"
        // On hold the glow fades out rather than following the room.
        active={!paused}
        stream={stream}
        colors={BEAM_COLORS}
        bandColors={BEAM_BAND}
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
