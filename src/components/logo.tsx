import symbol from "@/assets/mosaic-symbole.svg?raw";
import { cn } from "@/lib/utils";

// The file paints with currentColor, so one asset serves blue on white and
// white on blue. Width and height are dropped to let CSS size them.
const inline = (svg: string) => svg.replace(/\s(width|height)="[^"]*"/g, "").replace(/<title>.*?<\/title>/, "");
const SYMBOL = inline(symbol);

export function Symbol({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block [&>svg]:h-full [&>svg]:w-auto", className)}
      dangerouslySetInnerHTML={{ __html: SYMBOL }}
    />
  );
}
