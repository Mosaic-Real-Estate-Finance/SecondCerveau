import type { ReactNode } from "react";
import type { Note } from "@/lib/notes";
import { cn } from "@/lib/utils";

export function Screen({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex min-h-full flex-col px-4", className)}
      style={{ paddingTop: "calc(var(--safe-top) + 12px)", paddingBottom: "calc(var(--safe-bottom) + 24px)" }}
    >
      {children}
    </div>
  );
}

export function TopBar({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <header className="mb-6">
      <button
        type="button"
        onClick={onBack}
        className="-ml-3 flex h-11 items-center gap-1 rounded-full px-3 text-base text-navy"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        {backLabel}
      </button>
      <h1 className="mt-2 font-serif text-2xl">{title}</h1>
    </header>
  );
}

export function PrimaryButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex h-14 w-full items-center justify-center rounded-2xl bg-navy px-5 text-base font-medium text-on-accent transition-opacity disabled:opacity-40",
        className,
      )}
    />
  );
}

/** The round navy button that opens a sheet: create, attach. */
export function CircleButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy text-on-accent", className)}
    />
  );
}

export function TextButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn("inline-flex h-11 items-center rounded-full px-3 text-base font-medium text-navy", className)}
    />
  );
}

export function statusLabel(note: Note) {
  switch (note.status) {
    case "recording":
      return "Enregistrement en cours";
    case "recorded":
      return "En attente de transcription";
    case "transcribing":
      return "Transcription en cours";
    case "transcribed":
      return note.contact === undefined ? "À rattacher à un contact" : "Prête à envoyer";
    case "transcription-failed":
      return "Transcription échouée";
    case "sending":
      return "Envoi en cours";
    case "send-failed":
      return "Envoi échoué";
  }
}

const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function noteDate(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? `Aujourd'hui, ${time.format(date)}` : `${day.format(date)}, ${time.format(date)}`;
}
