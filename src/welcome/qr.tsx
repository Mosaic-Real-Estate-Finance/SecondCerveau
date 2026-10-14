import { useMemo } from "react";
import { encode } from "uqr";

// A plain QR code: square modules, the standard four-module quiet zone, dark
// on light in both themes (--qr-*): scanned inverted, a code fails on some
// cameras. Correction M, version 2 for the app's address.
export function Qr({ value, className }: { value: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 4 });
    let path = "";
    data.forEach((row, y) => row.forEach((dark, x) => dark && (path += `M${x} ${y}h1v1h-1z`)));
    return { size, path };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label={`QR code : ${value}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="var(--qr-paper)" />
      <path d={path} fill="var(--qr-ink)" />
    </svg>
  );
}
