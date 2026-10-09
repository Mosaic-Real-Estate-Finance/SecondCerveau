import { openExternal } from "./office";

// One button for every way out of the panel and into Notion. It was a text
// link, which read as a footnote next to the action that had just succeeded.

export function NotionButton({
  label,
  url,
  onClick,
}: {
  label: string;
  /** Opened through the host. Ignored when `onClick` is given. */
  url?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => (onClick ? onClick() : url && openExternal(url))}
      className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white-smoke px-4 py-3 text-sm font-medium text-navy outline-none transition-colors hover:bg-[color:var(--color-white-smoke)]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >
      <img src="/outlook/logo.svg" alt="" width="18" height="18" className="shrink-0" />
      <span>{label} ↗</span>
    </button>
  );
}
