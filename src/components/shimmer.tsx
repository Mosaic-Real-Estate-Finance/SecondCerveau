import { cn } from "@/lib/utils";

// transitions.dev 15, shimmer text: the text is duplicated into data-text for
// the ::before layer that carries the moving band.
export function Shimmer({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cn("t-shimmer", className)} data-text={children}>
      {children}
    </span>
  );
}
