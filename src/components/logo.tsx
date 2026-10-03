import logo from "@/assets/mosaic-logo.svg?raw";
import symbol from "@/assets/mosaic-symbole.svg?raw";
import { cn } from "@/lib/utils";

// Both files paint with currentColor, so one asset serves blue on white and
// white on blue. Width and height are dropped to let CSS size them.
const inline = (svg: string) => svg.replace(/\s(width|height)="[^"]*"/g, "").replace(/<title>.*?<\/title>/, "");
const LOGO = inline(logo);
const SYMBOL = inline(symbol);

export function Logo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Mosaic Real Estate Finance"
      className={cn("block [&>svg]:h-full [&>svg]:w-auto", className)}
      dangerouslySetInnerHTML={{ __html: LOGO }}
    />
  );
}

export function Symbol({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block [&>svg]:h-full [&>svg]:w-auto", className)}
      dangerouslySetInnerHTML={{ __html: SYMBOL }}
    />
  );
}
