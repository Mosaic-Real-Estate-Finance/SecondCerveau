import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { COUNTRIES, countryOf, flagOf, matchCountry } from "@/lib/phone";
import { cn } from "@/lib/utils";

// The indicatif is picked in the app, not in the operating system's own
// wheel: a sheet with a search that reads both the country name and the dial
// code, so "suis", "41" and "+41" all land on Switzerland.
//
// Two things make it behave on a phone.
//
// The sheet is rendered into <body>. It lives inside the contact panel,
// whose menu layer carries a transform — and a transformed ancestor becomes
// the containing block of everything `position: fixed` under it, so the
// sheet was laid out against that box instead of the screen: it appeared
// above the visible area, its backdrop covered nothing, and there was no way
// left to close it.
//
// And the keyboard is dismissed before it opens. Tapping the indicatif while
// typing a number left the keyboard up, which shrinks the visual viewport
// under the sheet and scrolls the page about.

export function CountryPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const country = countryOf(value);

  return (
    <>
      <button
        type="button"
        // As the finger lands, so the keyboard has begun to retract by the
        // time the sheet is on screen.
        onPointerDown={() => (document.activeElement as HTMLElement | null)?.blur()}
        onClick={() => {
          (document.activeElement as HTMLElement | null)?.blur();
          setOpen(true);
        }}
        aria-label={`${label} : ${country.name} ${country.dial}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-12 shrink-0 items-center gap-1 rounded-2xl bg-white-smoke pl-2.5 pr-1.5 text-base text-midnight-blue outline-none"
      >
        <span aria-hidden className="text-[15px] leading-none">
          {flagOf(country.code)}
        </span>
        <span className="tabular-nums">{country.dial}</span>
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-[color:var(--muted)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <CountrySheet
          value={value}
          onPick={(code) => {
            onChange(code);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CountrySheet({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(false);

  const matches = useMemo(() => COUNTRIES.filter((country) => matchCountry(country, query)), [query]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Choisir un indicatif">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-[color:var(--scrim-strong)] transition-opacity duration-200",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 mx-auto flex h-[70dvh] max-w-[480px] flex-col rounded-t-3xl bg-white transition-transform duration-300",
          shown ? "translate-y-0" : "translate-y-full",
        )}
        style={{ transitionTimingFunction: "var(--page-slide-ease)" }}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
          {/* Not autofocused: the point of opening this is to get away from
              the keyboard. It is one tap away for anyone who wants to type. */}
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pays ou indicatif"
            aria-label="Rechercher un pays ou un indicatif"
            className="h-12 min-w-0 flex-1 appearance-none rounded-2xl bg-white-smoke px-4 text-base text-midnight-blue outline-none placeholder:text-[color:var(--muted)] [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 shrink-0 items-center rounded-full px-3 text-base font-medium text-navy"
          >
            Annuler
          </button>
        </div>

        <ul
          role="listbox"
          aria-label="Indicatifs"
          className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}
        >
          {matches.map((country) => (
            <li key={country.code} role="option" aria-selected={country.code === value}>
              <button
                type="button"
                onClick={() => onPick(country.code)}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base",
                  country.code === value && "bg-white-smoke font-medium",
                )}
              >
                <span aria-hidden className="w-6 shrink-0 text-[17px] leading-none">
                  {flagOf(country.code)}
                </span>
                <span className="min-w-0 flex-1 truncate">{country.name}</span>
                <span className="shrink-0 tabular-nums text-[color:var(--muted)]">{country.dial}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="py-6 text-base text-[color:var(--muted)]">Aucun pays ne correspond.</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
