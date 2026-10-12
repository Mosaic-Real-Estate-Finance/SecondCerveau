// The technical line under a sign-in failure.
//
// The sentence the panel shows ("Connexion Microsoft impossible.") is right
// for the reader and useless for whoever has to fix it: MSAL knows exactly why
// — a missing redirect, consent refused by policy, an unknown client id — and
// says so in `errorCode` and `errorMessage`. This keeps that, short enough to
// sit under the sentence and be read off a screenshot.
//
// Pure, so scripts/test-outlook.mjs can run it under Node.

const MAX = 200;

/** "errorCode — first 200 characters of the message", or null when MSAL said nothing. */
export function authDetail(error: unknown): string | null {
  const source = (error ?? {}) as { errorCode?: unknown; errorMessage?: unknown; message?: unknown };
  const code = typeof source.errorCode === "string" ? source.errorCode.trim() : "";
  const raw =
    typeof source.errorMessage === "string" && source.errorMessage.trim()
      ? source.errorMessage
      : typeof source.message === "string"
        ? source.message
        : "";
  // MSAL messages carry newlines and the trace and correlation ids; one line
  // of the start is what fits under a sentence.
  const message = raw.replace(/\s+/g, " ").trim().slice(0, MAX);
  if (!code && !message) return null;
  return code && message ? `${code} — ${message}` : code || message;
}
