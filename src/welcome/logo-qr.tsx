import { useId, useMemo } from "react";
import { encode } from "uqr";

// A QR code that is the Mosaic symbol itself, drawn on the symbol's own
// geometry (src/assets/mosaic-symbole.svg) and nothing around it.
//
// The symbol is a cube seen in isometric view. Its top face carries the real
// code, projected onto the rhombus as if it lay on the cube: a camera reads a
// code at an angle as a matter of course, the finder patterns giving it the
// perspective. The two side faces carry modules of the same size, on their
// own planes, cut by the symbol's exact paths — the two slots of each face
// included. They are filler: nothing in them looks like a finder pattern, and
// the gap between the faces is the code's margin on that side.
//
// The address is written in capitals so it fits the alphanumeric mode: a
// smaller code (version 2) with stronger error correction (Q) than the same
// text in bytes. Scheme and host are case-insensitive.

// The symbol's faces, viewBox 0 0 102.15 116.62: an origin and two edges.
type Face = { origin: number[]; u: number[]; v: number[] };
const TOP: Face = { origin: [51.07, 0], u: [48.52, 28.01], v: [-48.51, 28.01] };
const LEFT: Face = { origin: [0, 32.44], u: [48.52, 28.01], v: [0, 56.17] };
const RIGHT: Face = { origin: [53.63, 60.45], u: [48.52, -28.01], v: [0, 56.17] };
const LEFT_PATH =
  "M0,32.44 L48.52,60.45 L48.52,116.62 L0,88.61Z M12.77,58.59 L17.88,61.54 L17.88,98.93 L12.77,95.98Z M30.65,68.91 L35.75,71.86 L35.75,109.25 L30.65,106.30Z";
const RIGHT_PATH =
  "M102.15,32.44 L53.63,60.45 L53.63,116.62 L102.15,88.61Z M89.38,58.59 L84.27,61.54 L84.27,98.93 L89.38,95.98Z M71.50,68.91 L66.40,71.86 L66.40,109.25 L71.50,106.30Z";

const matrix = ({ origin, u, v }: Face, n: number) =>
  `matrix(${u[0] / n} ${u[1] / n} ${v[0] / n} ${v[1] / n} ${origin[0]} ${origin[1]})`;

// A stable pseudo-random sequence, so the faces are the same on every visit.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// One path of unit squares, slightly inset so neighbours read as modules.
const squares = (cells: [number, number][], inset: number) => {
  const side = 1 - 2 * inset;
  return cells.map(([i, j]) => `M${i + inset} ${j + inset}h${side}v${side}h${-side}z`).join("");
};

export function LogoQr({ value, className }: { value: string; className?: string }) {
  const clip = useId().replace(/:/g, "");
  const drawing = useMemo(() => {
    const { data, size } = encode(value.toUpperCase(), { ecc: "Q", border: 0 });
    const code: [number, number][] = [];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (data[j][i]) code.push([i, j]);
    // The side faces: random modules, denser than a code, so the slots read
    // as cut-outs; lighter, so the camera finds the real code on top.
    const next = random(11);
    const filler = () => {
      const cells: [number, number][] = [];
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (next() < 0.66) cells.push([i, j]);
      return squares(cells, 0.07);
    };
    return { size, code: squares(code, 0), left: filler(), right: filler() };
  }, [value]);

  const { size, code, left, right } = drawing;
  return (
    <svg viewBox="-6 -6 114.15 128.62" className={className} role="img" aria-label={`QR code : ${value}`}>
      <defs>
        <clipPath id={`${clip}-l`}>
          <path d={LEFT_PATH} clipRule="evenodd" />
        </clipPath>
        <clipPath id={`${clip}-r`}>
          <path d={RIGHT_PATH} clipRule="evenodd" />
        </clipPath>
      </defs>
      <g fill="var(--qr-ink)">
        <path d={code} transform={matrix(TOP, size)} />
        <g clipPath={`url(#${clip}-l)`}>
          <path d={left} transform={matrix(LEFT, size)} opacity={0.78} className="welcome-qr-face" />
        </g>
        <g clipPath={`url(#${clip}-r)`}>
          <path d={right} transform={matrix(RIGHT, size)} opacity={0.6} className="welcome-qr-face" style={{ animationDelay: "120ms" }} />
        </g>
      </g>
    </svg>
  );
}
