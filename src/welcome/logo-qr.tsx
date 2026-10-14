import { useId, useMemo } from "react";
import { encode } from "uqr";

// A QR code in the shape of the Mosaic symbol: the cube's silhouette, filled
// with modules on one grid, its three faces shaded and its four slots cut, as
// in src/assets/mosaic-symbole.svg.
//
// The code itself is a plain square, upright, in the upper half of the cube —
// between the slots, which would cut through it. An earlier version laid the
// code on the cube's top face, in perspective; phone cameras barely found it.
// What a camera needs, measured on simulated photos of a screen (OpenCV and
// ZXing):
//   - the code square, never sheared;
//   - one blank module around it: filler touching the code breaks the finder
//     patterns' 1:1:3:1:1 rhythm and nothing decodes at all;
//   - the lines between the faces drawn thin across the code: at the
//     symbol's own width they erase too much of it.
//
// The address is written in capitals so it fits the alphanumeric mode, which
// keeps the code at version 2 with error correction Q. Scheme and host are
// case-insensitive.

const W = 102.15;
const H = 116.62;
const TOP_PATH = "M51.07,0 L99.59,28.01 L51.07,56.02 L2.56,28.01Z";
const LEFT_PATH =
  "M0,32.44 L48.52,60.45 L48.52,116.62 L0,88.61Z M12.77,58.59 L17.88,61.54 L17.88,98.93 L12.77,95.98Z M30.65,68.91 L35.75,71.86 L35.75,109.25 L30.65,106.30Z";
const RIGHT_PATH =
  "M102.15,32.44 L53.63,60.45 L53.63,116.62 L102.15,88.61Z M89.38,58.59 L84.27,61.54 L84.27,98.93 L89.38,95.98Z M71.50,68.91 L66.40,71.86 L66.40,109.25 L71.50,106.30Z";
const OUTLINE = "M51.07,0 L102.15,29.5 L102.15,88.61 L51.07,116.62 L0,88.61 L0,29.5Z";
const EDGES = "M2.56,28.01 L51.07,56.02 L99.59,28.01 M51.07,56.02 L51.07,116.62";

// The largest square that fits in the cube above the inner slots' tops
// (y 68.91): its top corners touch the slanted edges.
const CODE_SIDE = 53.4;
const CODE_TOP = 68.91 - CODE_SIDE;
const CODE_LEFT = (W - CODE_SIDE) / 2;
const MARGIN = 1; // blank modules around the code
const DENSITY = 0.5;

// A stable pseudo-random sequence, so the filler is the same on every visit.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// One path of unit squares; an inset leaves a hairline between neighbours.
const squares = (cells: [number, number][], inset: number) => {
  const side = 1 - 2 * inset;
  return cells.map(([i, j]) => `M${i + inset} ${j + inset}h${side}v${side}h${-side}z`).join("");
};

export function LogoQr({ value, className }: { value: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const drawing = useMemo(() => {
    const { data, size } = encode(value.toUpperCase(), { ecc: "Q", border: 0 });
    const m = CODE_SIDE / size;
    const code: [number, number][] = [];
    const filler: [number, number][] = [];
    const next = random(5);
    // Grid indices are the code's own, extended to cover the whole symbol.
    const from = (start: number) => Math.floor(-start / m) - 1;
    for (let j = from(CODE_TOP); j < (H - CODE_TOP) / m + 1; j++) {
      for (let i = from(CODE_LEFT); i < (W - CODE_LEFT) / m + 1; i++) {
        const inCode = i >= 0 && j >= 0 && i < size && j < size;
        const nearCode = i >= -MARGIN && j >= -MARGIN && i < size + MARGIN && j < size + MARGIN;
        if (inCode) {
          if (data[j][i]) code.push([i, j]);
        } else if (!nearCode && next() < DENSITY) filler.push([i, j]);
      }
    }
    return {
      transform: `matrix(${m} 0 0 ${m} ${CODE_LEFT} ${CODE_TOP})`,
      code: squares(code, 0),
      filler: squares(filler, 0.07),
    };
  }, [value]);

  const { transform, code, filler } = drawing;
  // Shading per face, on the filler only: the code stays at full contrast.
  const faces = [
    ["t", TOP_PATH, 1],
    ["l", LEFT_PATH, 0.75],
    ["r", RIGHT_PATH, 0.6],
  ] as const;
  return (
    <svg viewBox={`-3 -3 ${W + 6} ${H + 6}`} className={className} role="img" aria-label={`QR code : ${value}`}>
      <defs>
        {faces.map(([key, path]) => (
          <clipPath key={key} id={`${id}-${key}`}>
            <path d={path} clipRule="evenodd" />
          </clipPath>
        ))}
        <clipPath id={`${id}-o`}>
          <path d={OUTLINE} />
        </clipPath>
      </defs>
      <g fill="var(--qr-ink)">
        {faces.map(([key, , opacity]) => (
          <g key={key} clipPath={`url(#${id}-${key})`} opacity={opacity}>
            <path d={filler} transform={transform} className="welcome-qr-face" />
          </g>
        ))}
        <g clipPath={`url(#${id}-o)`}>
          <path d={code} transform={transform} />
        </g>
      </g>
      <path d={EDGES} stroke="var(--qr-paper)" strokeWidth={0.5} fill="none" />
    </svg>
  );
}
