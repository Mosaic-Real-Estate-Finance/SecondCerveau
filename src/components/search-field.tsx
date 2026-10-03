import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// transitions.dev 13, input clear with dissolve. The per frame routine is the
// snippet's own, moved into a component; it reads every timing from the
// motion tokens so _root.css stays the single source.

const root = () => document.documentElement;
const num = (name: string, fallback: number) => {
  const value = parseFloat(getComputedStyle(root()).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
};

function bezier(str: string) {
  const m = String(str).match(/cubic-bezier\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/);
  if (!m) return (t: number) => t;
  const [x1, y1, x2, y2] = m.slice(1).map(parseFloat);
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const dx = ((ax * s + bx) * s + cx) * s - t;
      const d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(dx) < 1e-6 || d === 0) break;
      s -= dx / d;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const phold = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const clearing = useRef(false);

  useEffect(() => {
    if (clearing.current) return;
    wrap.current?.classList.toggle("has-value", value.length > 0);
    if (mirror.current && value) mirror.current.textContent = value.replace(/ /g, " ");
  }, [value]);

  function buildGlow(text: string) {
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.font = getComputedStyle(input.current!).font;
    const rgb = "2,3,66";
    const w = wrap.current!.clientWidth || 280;
    const padLeft = parseFloat(getComputedStyle(input.current!).paddingLeft) || 12;
    const spread = num("--glow-spread", 1.5);
    const layers: string[] = [];
    let x = 0;
    text.split(/(\s+)/).forEach((seg) => {
      const segW = canvas.measureText(seg).width;
      if (seg.trim()) {
        const cx = padLeft + x + segW / 2;
        const hw = Math.max(segW * 0.45, 8) * spread;
        ([[0, 0.8, 7, 0.22], [hw * 0.45, 0.55, 8, 0.18], [-hw * 0.4, 0.65, 6, 0.16], [hw * 0.15, 0.9, 5, 0.14]] as const).forEach(
          ([dx, rwm, rh, a]) => {
            const lx = (((cx + dx) / w) * 100).toFixed(2);
            layers.push(
              `radial-gradient(ellipse ${Math.max(hw * rwm, 2).toFixed(1)}px ${rh}px at ${lx}% 100%, rgba(${rgb},${a}), transparent)`,
            );
          },
        );
      }
      x += segW;
    });
    return layers.join(", ");
  }

  function clearWithAnimation() {
    const w = wrap.current, i = input.current, m = mirror.current, p = phold.current, g = glow.current;
    if (!w || !i || !m || !p || !g || clearing.current || !value) return;
    clearing.current = true;
    const keepFocus = document.activeElement === i;
    m.textContent = value.replace(/ /g, " ");

    const cs = getComputedStyle(root());
    const total = num("--clear-dur", 1000);
    const outDur = num("--clear-out-dur", 400);
    const inDur = num("--clear-in-dur", 400);
    const outFly = num("--clear-out-fly", 12);
    const inFly = num("--clear-in-fly", 12);
    const blur = num("--clear-blur", 2);
    const delay = num("--glow-delay", 50);
    const peakAt = num("--glow-peak-at", 0.15);
    const gOp = num("--glow-opacity", 0.42);
    const easeOut = bezier(cs.getPropertyValue("--clear-out-ease"));
    const easeIn = bezier(cs.getPropertyValue("--clear-in-ease"));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    onChange("");
    w.classList.remove("has-value");
    w.classList.add("is-clearing");
    g.style.background = buildGlow(m.textContent ?? "");
    g.style.opacity = "0";
    p.style.transform = `translateY(-${inFly}px)`;
    p.style.opacity = "0.9";
    p.style.filter = `blur(${blur}px)`;

    const finish = () => {
      w.classList.remove("is-clearing");
      [m, p].forEach((el) => (el.style.cssText = ""));
      m.textContent = "";
      g.style.opacity = "0";
      g.style.background = "";
      clearing.current = false;
      if (keepFocus) requestAnimationFrame(() => i.focus({ preventScroll: true }));
    };
    if (reduced) return finish();

    const t0 = performance.now();
    const tick = (now: number) => {
      const el = now - t0;
      const eo = easeOut(Math.min(1, el / outDur));
      m.style.transform = `translateY(${(eo * outFly).toFixed(1)}px)`;
      m.style.opacity = (1 - eo).toFixed(3);
      m.style.filter = `blur(${(eo * blur).toFixed(1)}px)`;

      const ei = easeIn(Math.min(1, el / inDur));
      p.style.transform = `translateY(${(-inFly + ei * inFly).toFixed(1)}px)`;
      p.style.opacity = (0.9 + ei * 0.1).toFixed(3);
      p.style.filter = `blur(${(blur - ei * blur).toFixed(1)}px)`;

      let gv = 0;
      if (el > delay) {
        const gp = Math.min(1, (el - delay) / Math.max(1, total - delay));
        gv = gp < peakAt ? gp / peakAt : 1 - (gp - peakAt) / (1 - peakAt);
      }
      g.style.opacity = (gv * gOp).toFixed(3);

      if (el < total) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
  }

  const keep = (event: React.PointerEvent | React.MouseEvent) => {
    if (document.activeElement === input.current) event.preventDefault();
  };

  return (
    <div ref={wrap} className="search-field t-clear h-12 rounded-2xl bg-white-smoke text-base">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-4 top-1/2 z-[4] h-5 w-5 -translate-y-1/2 text-[color:var(--muted)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
      <input
        ref={input}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="relative z-[1] h-full w-full appearance-none bg-transparent text-midnight-blue outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <div ref={mirror} className="t-clear-mirror text-midnight-blue" aria-hidden />
      <div ref={phold} className="t-clear-placeholder" aria-hidden>
        {placeholder}
      </div>
      <div ref={glow} className="t-clear-glow" aria-hidden />
      <button
        type="button"
        aria-label="Effacer la recherche"
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={clearWithAnimation}
        className={cn(
          "t-clear-btn absolute right-0 top-0 z-[4] flex h-12 w-12 items-center justify-center text-[color:var(--muted)] transition-opacity",
          value ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </div>
  );
}
