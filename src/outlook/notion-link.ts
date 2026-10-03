import { openExternal } from "./office";

// Opening the Mosaic notes base, from the one screen that cannot write to it.
//
// The database id is a build-time value: VITE_NOTION_NOTES_DB. It is not a
// secret — the token is, and that one never leaves the server — but Vite only
// exposes what carries the prefix, so the server-side NOTION_NOTES_DB cannot
// be read here.

const id = (import.meta.env.VITE_NOTION_NOTES_DB ?? "").replace(/-/g, "").trim();

/** The base itself when it is configured, Notion's front door otherwise. */
export const notesUrl = id ? `https://www.notion.so/${id}` : "https://www.notion.so";

/** What the desktop app answers to. Same address, its own scheme. */
const desktopUrl = `notion://${notesUrl.replace(/^https?:\/\//, "")}`;

/** How long to wait for the desktop app to take the link before giving up. */
const HANDOFF_MS = 700;

/**
 * Opens the notes base in the Notion desktop app when it is installed, and in
 * the browser otherwise.
 *
 * There is no way to ask whether an app is installed, so the only signal is
 * the one the operating system gives: handing a link to a desktop app takes
 * the focus away from this window. The scheme is offered first; if the focus
 * is still here a moment later, nothing took it and the web address opens
 * instead.
 *
 * Being wrong in one direction opens both the app and a tab, which is untidy.
 * Being wrong in the other leaves the reader with nothing at all, which is the
 * failure that matters — so the fallback always runs unless something
 * demonstrably took over.
 */
export function openNotes(): void {
  let handled = false;
  const took = () => {
    handled = true;
  };
  window.addEventListener("blur", took, { once: true });
  document.addEventListener("visibilitychange", took, { once: true });

  try {
    // Not a navigation of this window: the taskpane must stay where it is.
    window.open(desktopUrl, "_blank", "noopener,noreferrer");
  } catch {
    // A host that refuses the scheme outright: the web address will do.
  }

  window.setTimeout(() => {
    window.removeEventListener("blur", took);
    document.removeEventListener("visibilitychange", took);
    if (!handled && document.visibilityState === "visible") openExternal(notesUrl);
  }, HANDOFF_MS);
}
