import bell from "@/assets/icons/bell.svg?raw";
import bellBadge from "@/assets/icons/bell.badge.svg?raw";
import gear from "@/assets/icons/gear.svg?raw";
import microphone from "@/assets/icons/microphone.svg?raw";
import { cn } from "@/lib/utils";

// The SF Symbols exports, kept byte for byte in src/assets/icons. They paint in
// white; inlined, that white becomes currentColor so each button gives the
// icon its own colour. The badge dot keeps the colour it was drawn with.
const inline = (svg: string) => svg.slice(svg.indexOf("<svg")).replace(/fill="white"/g, 'fill="currentColor"');

const ICONS = {
  bell: inline(bell),
  "bell.badge": inline(bellBadge),
  gear: inline(gear),
  microphone: inline(microphone),
} as const;

export type IconName = keyof typeof ICONS;

/** Sized by its height; the width follows the symbol's own proportions. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <span
      aria-hidden
      data-icon={name}
      className={cn("inline-block [&>svg]:h-full [&>svg]:w-auto", className)}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
