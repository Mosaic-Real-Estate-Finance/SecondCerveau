// Derived from the Voice Note component of Rare UI (https://rareui.com),
// Copyright (c) 2026 Swami Malode, MIT + Commons Clause + Attribution, see
// components/ui/LICENSE-rare-ui. The design is the original one: pill, white
// control with a morphing icon, bars and counter. Playback, seeking and speeds
// are replaced by live capture: bars arrive on the right and scroll. The
// orbiting glow of the original is dropped; the screen glow carries the level.

import { memo, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type Transition } from "motion/react";
import { cn } from "@/lib/utils";

// all proportional to the bar height, so every size keeps the same look
const CONTROL_RATIO = 0.76;
const ICON_RATIO = 0.72;
const PEAK_RATIO = 0.68;

const ICON: Transition = { type: "spring", duration: 0.34, bounce: 0.2 };
const TAP: Transition = { type: "spring", duration: 0.25, bounce: 0.3 };
const INSTANT: Transition = { duration: 0 };

// Same construction as the play / pause morph: two four point quads per shape.
// A rounded hexagon reads as the record dot, the square as stop, and the two
// bars as pause — one quad each, so any of them morphs into any other.
const RECORD_SHAPE = [12, 6.5, 7.24, 9.25, 7.24, 14.75, 12, 17.5, 12, 6.5, 16.76, 9.25, 16.76, 14.75, 12, 17.5];
const STOP_SHAPE = [7.5, 7.5, 12, 7.5, 12, 16.5, 7.5, 16.5, 12, 7.5, 16.5, 7.5, 16.5, 16.5, 12, 16.5];
const PAUSE_SHAPE = [8, 7, 10.4, 7, 10.4, 17, 8, 17, 13.6, 7, 16, 7, 16, 17, 13.6, 17];

const toPath = (shape: number[]) => {
  let d = "";
  for (let quad = 0; quad < shape.length; quad += 8) {
    d += `M${shape[quad]} ${shape[quad + 1]}`;
    for (let point = 2; point < 8; point += 2) d += ` L${shape[quad + point]} ${shape[quad + point + 1]}`;
    d += " Z";
  }
  return d;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const morph = (from: number[], to: number[], t: number) => toPath(from.map((value, i) => value + (to[i] - value) * t));

const SHAPES = { record: RECORD_SHAPE, stop: STOP_SHAPE, pause: PAUSE_SHAPE };
type ShapeName = keyof typeof SHAPES;

// stroke rounds the corners the path leaves sharp
const ICON_PAINT = {
  fill: "currentColor",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinejoin: "round",
  strokeLinecap: "round",
} as const;

const SIZES = {
  sm: { height: 40, gap: 8, bar: 2, barGap: 2, pad: 12, text: "text-[11px]" },
  md: { height: 52, gap: 10, bar: 3, barGap: 3, pad: 14, text: "text-xs" },
  lg: { height: 64, gap: 12, bar: 3, barGap: 4, pad: 16, text: "text-[14px]" },
} as const;

const MIN_AMPLITUDE = 0.14;

export const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// idle: microphone opening. done: transcript ready, the bars stay as a record.
export type RecorderVisualState = "idle" | "recording" | "transcribing" | "done" | "failed";

export type VoiceRecorderProps = {
  state: RecorderVisualState;
  // Amplitudes in 0..1, oldest first; the newest bar is drawn on the right.
  amplitudes: number[];
  // Seconds since the start, counting up.
  elapsed: number;
  // At most this many slots, like the original's `bars`; fewer when the track
  // is too narrow for them at their minimum width. Once full, it scrolls.
  bars?: number;
  // The two controls of a dictation, at the right end of the pill: hold, and
  // finish. Both are left out where the pill only plays back a recording.
  onTogglePause?: () => void;
  paused?: boolean;
  onFinish?: () => void;
  finishLabel?: string;
  size?: keyof typeof SIZES;
  className?: string;
};

export function VoiceRecorder({
  state,
  amplitudes,
  elapsed,
  bars = 40,
  onTogglePause,
  paused = false,
  onFinish,
  finishLabel,
  size = "lg",
  className,
}: VoiceRecorderProps) {
  const metrics = SIZES[size];
  const control = Math.round(metrics.height * CONTROL_RATIO);
  // the controls sit as far from the right edge as they do from top and bottom
  const inset = Math.round((metrics.height - control) / 2);
  const reduced = !!useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(bars);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const room = Math.floor((entry.contentRect.width + metrics.barGap) / (metrics.bar + metrics.barGap));
      setFit(Math.max(1, Math.min(bars, room)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [bars, metrics.bar, metrics.barGap]);

  const visible = amplitudes.slice(-fit);
  const slots = Math.max(0, fit - visible.length);
  const button = Math.max(control, 44);
  const iconSize = Math.round(control * ICON_RATIO);

  return (
    <div
      data-slot="voice-recorder"
      data-state={state}
      data-paused={paused || undefined}
      className={cn("relative isolate inline-flex select-none items-center", className)}
      style={{ height: metrics.height, gap: metrics.gap, paddingLeft: metrics.pad, paddingRight: inset }}
    >
      <div className="absolute inset-0 -z-10 rounded-full bg-white-smoke" />

      <div
        ref={trackRef}
        aria-hidden
        className={cn(
          "relative h-full min-w-0 flex-1 overflow-hidden transition-opacity",
          paused && "opacity-50",
          state === "transcribing" && "opacity-45",
          state === "failed" && "opacity-30",
        )}
      >
        <Bars amplitudes={visible} slots={slots} metrics={metrics} />
      </div>

      <span
        data-slot="voice-recorder-time"
        role="timer"
        className={cn("flex shrink-0 items-center gap-1 font-semibold tabular-nums text-[color:var(--muted)]", metrics.text)}
      >
        {formatTime(elapsed)}
      </span>

      {onTogglePause && (
        <motion.button
          data-slot="voice-recorder-pause"
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? "Reprendre l'enregistrement" : "Mettre en pause"}
          aria-pressed={paused}
          whileTap={reduced ? undefined : { scale: 0.9 }}
          transition={reduced ? INSTANT : TAP}
          style={{ width: button, height: button }}
          className="z-10 flex shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-white text-midnight-blue outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <MorphIcon shape={paused ? "record" : "pause"} size={iconSize} reduced={reduced} />
        </motion.button>
      )}

      {onFinish && (
        <motion.button
          data-slot="voice-recorder-finish"
          type="button"
          onClick={onFinish}
          aria-label={finishLabel}
          whileTap={reduced ? undefined : { scale: 0.9 }}
          transition={reduced ? INSTANT : TAP}
          style={{ width: button, height: button }}
          className="z-10 flex shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-navy text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <svg
            viewBox="0 0 24 24"
            width={iconSize}
            height={iconSize}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5.5 12.5l4.5 4.5 8.5-10" />
          </svg>
        </motion.button>
      )}
    </div>
  );
}

function MorphIcon({ shape: name, size, reduced }: { shape: ShapeName; size: number; reduced: boolean }) {
  const path = useMotionValue(toPath(SHAPES[name]));
  const previous = useRef(name);

  useEffect(() => {
    const from = previous.current;
    if (from === name) return;
    previous.current = name;
    path.set(toPath(SHAPES[name]));
    if (reduced) return;
    const controls = animate(0, 1, {
      ...ICON,
      onUpdate: (t) => path.set(morph(SHAPES[from], SHAPES[name], clamp(t))),
      // the spring can overshoot, so land on the exact path
      onComplete: () => path.set(toPath(SHAPES[name])),
    });
    return () => controls.stop();
  }, [name, reduced, path]);

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <motion.path d={path} {...ICON_PAINT} />
    </svg>
  );
}

// Same bars as the original: flex slots with a minimum width. Slots not yet
// recorded wait at rest height in the unplayed tint; recorded ones take the
// played colour.
const Bars = memo(function Bars({
  amplitudes,
  slots,
  metrics,
}: {
  amplitudes: number[];
  slots: number;
  metrics: (typeof SIZES)[keyof typeof SIZES];
}) {
  return (
    <div className="flex h-full w-full items-center" style={{ gap: metrics.barGap }}>
      {Array.from({ length: slots }, (_, i) => (
        <span
          key={`slot-${i}`}
          className="flex-1 rounded-full bg-midnight-blue/30"
          style={{ minWidth: metrics.bar, height: `${(MIN_AMPLITUDE * PEAK_RATIO * 100).toFixed(2)}%` }}
        />
      ))}
      {amplitudes.map((amplitude, i) => (
        <span
          key={i}
          className="flex-1 rounded-full bg-midnight-blue"
          style={{
            minWidth: metrics.bar,
            height: `${(clamp(amplitude, MIN_AMPLITUDE, 1) * PEAK_RATIO * 100).toFixed(2)}%`,
          }}
        />
      ))}
    </div>
  );
});
