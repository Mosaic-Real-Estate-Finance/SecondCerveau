import { useEffect, useRef } from "react";
import { caretAfter, digitsOf, formatNational } from "@/lib/phone";
import { cn } from "@/lib/utils";

// A number is grouped as it is typed, the way the chosen country groups it:
// two by two in France, three then three then two by two in Switzerland, and
// so on. The caret is put back where the same digit was, so editing in the
// middle of a number works; a backspace onto a separator takes the digit in
// front of it, which is what the key is expected to do.

export function PhoneNumberInput({
  country,
  value,
  onChange,
  label,
  className,
}: {
  country: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef(value);

  // Switching country regroups what is already typed.
  useEffect(() => {
    const next = formatNational(country, value);
    if (next !== value) onChange(next);
    // Only on a country change: typing is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const handle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const node = event.currentTarget;
    const raw = node.value;
    const caret = node.selectionStart ?? raw.length;
    let digits = digitsOf(raw);
    let before = digitsOf(raw.slice(0, caret)).length;

    // Nothing shorter but a separator gone: the keystroke meant the digit.
    if (raw.length < previous.current.length && digits.length === digitsOf(previous.current).length && before > 0) {
      digits = digits.slice(0, before - 1) + digits.slice(before);
      before -= 1;
    }

    const formatted = formatNational(country, digits);
    previous.current = formatted;
    // The DOM is put back in step here rather than on the next render: when
    // the formatted value has not changed (a letter typed, say) React has no
    // reason to re-render and would leave the stray character on screen.
    node.value = formatted;
    const at = caretAfter(formatted, before);
    node.setSelectionRange(at, at);
    onChange(formatted);
  };

  return (
    <input
      ref={input}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      aria-label={label}
      value={value}
      onChange={handle}
      className={cn(
        "h-12 min-w-0 rounded-2xl bg-white-smoke px-4 text-base tabular-nums text-midnight-blue outline-none placeholder:text-[color:var(--muted)]",
        className,
      )}
      placeholder="6 12 34 56 78"
    />
  );
}
