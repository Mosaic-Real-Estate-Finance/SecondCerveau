import { useMemo } from "react";
import { encode } from "uqr";
import symbol from "@/assets/mosaic-symbole.svg?raw";

// A QR code in the shape of the Mosaic symbol: the cube's hexagon.
//
// A QR code has to stay square to be read, so the code itself is untouched —
// error correction H, the symbol in its centre — and the hexagon is drawn
// around it: decorative dots fill the silhouette outside a quiet zone wide
// enough for a camera to find the code's edge. The dots are shaded face by
// face (top, left, right), as the symbol is. Dark on light in both themes,
// on the --qr-* colours: scanned inverted, a code fails on some cameras.

const QUIET = 4; // modules of blank margin around the code
const LOGO = 9; // modules cleared in the centre for the symbol

// A stable pseudo-random sequence, so the pattern is the same on every visit.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const inline = (svg: string) =>
  svg
    .replace(/<title>.*?<\/title>/, "")
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

export function LogoQr({ value, className }: { value: string; className?: string }) {
  const drawing = useMemo(() => {
    const { data, size } = encode(value, { ecc: "H", border: 0 });
    const half = size / 2 + QUIET;
    // Pointy-top regular hexagon (the symbol's own proportions, 0.866:1)
    // just large enough to hold the code and its quiet zone: the square's
    // corner (half, half) sits on the slanted edge when R = half·(1 + 1/√3).
    const R = half * (1 + 1 / Math.sqrt(3)) + 1.2;
    const W = R * Math.sqrt(3); // flat-to-flat width
    const H = R * 2;
    const inHex = (x: number, y: number, inset = 0) =>
      Math.abs(x) <= W / 2 - inset && Math.abs(x) / Math.sqrt(3) + Math.abs(y) <= R - inset * 1.155;

    const cells: string[] = [];
    const deco: { x: number; y: number; face: 0 | 1 | 2; delay: number }[] = [];
    const next = random(7);
    const span = Math.ceil(R) + 1;
    const lo = Math.floor((size - LOGO) / 2);
    const hi = lo + LOGO;
    const finder = (i: number, j: number) => (i < 7 && j < 7) || (i >= size - 7 && j < 7) || (i < 7 && j >= size - 7);

    for (let j = -span; j < size + span; j++) {
      for (let i = -span; i < size + span; i++) {
        const x = i + 0.5 - size / 2;
        const y = j + 0.5 - size / 2;
        const inCode = i >= 0 && j >= 0 && i < size && j < size;
        if (inCode) {
          if (finder(i, j)) continue; // drawn whole below
          if (i >= lo && i < hi && j >= lo && j < hi) continue; // the symbol
          if (data[j][i]) cells.push(`M${i + 0.08} ${j + 0.08}h0.84v0.84h-0.84z`);
          continue;
        }
        if (Math.abs(x) < half && Math.abs(y) < half) continue; // quiet zone
        if (!inHex(x, y, 0.9)) continue;
        if (next() < 0.48) continue;
        // The cube's three faces meet at the centre: the top one above the
        // two lines rising at 30°, left and right below them.
        const face = y < -Math.abs(x) / Math.sqrt(3) ? 0 : x < 0 ? 1 : 2;
        deco.push({ x: i + 0.5, y: j + 0.5, face, delay: Math.hypot(x, y) * 14 });
      }
    }

    // Hexagon path, with softly rounded corners.
    const corners = Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 3) * k - Math.PI / 2;
      return [size / 2 + R * Math.cos(a), size / 2 + R * Math.sin(a)] as const;
    });
    const r = 2.4;
    let hex = "";
    corners.forEach(([cx, cy], k) => {
      const [px, py] = corners[(k + 5) % 6];
      const [nx, ny] = corners[(k + 1) % 6];
      const toward = (tx: number, ty: number) => {
        const d = Math.hypot(tx - cx, ty - cy);
        return [cx + ((tx - cx) / d) * r, cy + ((ty - cy) / d) * r];
      };
      const [ax, ay] = toward(px, py);
      const [bx, by] = toward(nx, ny);
      hex += `${k ? "L" : "M"}${ax.toFixed(3)} ${ay.toFixed(3)}Q${cx.toFixed(3)} ${cy.toFixed(3)} ${bx.toFixed(3)} ${by.toFixed(3)}`;
    });
    hex += "Z";

    const finders = [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ];
    return { size, W, H, hex, cells: cells.join(""), deco, finders, lo };
  }, [value]);

  const { size, W, H, hex, cells, deco, finders, lo } = drawing;
  const pad = 1.5;
  const viewBox = `${size / 2 - W / 2 - pad} ${size / 2 - H / 2 - pad} ${W + pad * 2} ${H + pad * 2}`;
  const faceOpacity = [1, 0.62, 0.38];

  return (
    <svg viewBox={viewBox} className={className} role="img" aria-label={`QR code : ${value}`}>
      <path
        d={hex}
        fill="var(--qr-paper)"
        style={{ filter: "drop-shadow(0 0.6px 1.2px var(--shadow))" }}
        stroke="var(--hairline)"
        strokeWidth={0.12}
      />
      <g fill="var(--qr-ink)">
        {deco.map(({ x, y, face, delay }, k) => (
          <circle
            key={k}
            cx={x}
            cy={y}
            r={0.36}
            opacity={faceOpacity[face]}
            className="welcome-qr-dot"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
        <path d={cells} />
        {finders.map(([i, j]) => (
          <g key={`${i}-${j}`}>
            <path
              fillRule="evenodd"
              d={`M${i + 1.6} ${j}h3.8a1.6 1.6 0 0 1 1.6 1.6v3.8a1.6 1.6 0 0 1-1.6 1.6h-3.8a1.6 1.6 0 0 1-1.6-1.6v-3.8a1.6 1.6 0 0 1 1.6-1.6z
                 M${i + 1.9} ${j + 1}h3.2a0.9 0.9 0 0 1 0.9 0.9v3.2a0.9 0.9 0 0 1-0.9 0.9h-3.2a0.9 0.9 0 0 1-0.9-0.9v-3.2a0.9 0.9 0 0 1 0.9-0.9z`}
            />
            <rect x={i + 2} y={j + 2} width={3} height={3} rx={0.8} />
          </g>
        ))}
        <g
          style={{ color: "var(--qr-ink)" }}
          transform={`translate(${lo + 1.1} ${lo + 0.75}) scale(${(LOGO - 2.2) / 102.15})`}
          dangerouslySetInnerHTML={{ __html: inline(symbol) }}
        />
      </g>
    </svg>
  );
}
