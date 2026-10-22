import bell from "@/assets/icons/bell.svg?raw";
import checkmarkCircle from "@/assets/icons/checkmark.circle.svg?raw";
import gear from "@/assets/icons/gear.svg?raw";
import microphone from "@/assets/icons/microphone.svg?raw";
import minusCircle from "@/assets/icons/minus.circle.svg?raw";
import personFillXmark from "@/assets/icons/person.fill.xmark.svg?raw";
import personLineDottedPerson from "@/assets/icons/person.line.dotted.person.svg?raw";
import quoteBubble from "@/assets/icons/quote.bubble.svg?raw";
import squareAndPencil from "@/assets/icons/square.and.pencil.svg?raw";
import xmarkCircle from "@/assets/icons/xmark.circle.svg?raw";
import { cn } from "@/lib/utils";

// The SF Symbols exports, kept byte for byte in src/assets/icons. They paint in
// white or black, as exported; inlined, that becomes currentColor so each
// button gives the icon its own colour. The bell with its badge is drawn apart
// (notification-bell.tsx).
const inline = (svg: string) => svg.slice(svg.indexOf("<svg")).replace(/fill="(?:white|black)"/g, 'fill="currentColor"');

const ICONS = {
  bell: inline(bell),
  gear: inline(gear),
  microphone: inline(microphone),
  "checkmark.circle": inline(checkmarkCircle),
  "xmark.circle": inline(xmarkCircle),
  "minus.circle": inline(minusCircle),
  "person.fill.xmark": inline(personFillXmark),
  "person.line.dotted.person": inline(personLineDottedPerson),
  "quote.bubble": inline(quoteBubble),
  "square.and.pencil": inline(squareAndPencil),
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
