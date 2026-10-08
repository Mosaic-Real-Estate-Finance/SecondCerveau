import { waitUntil } from "@vercel/functions";

// Work that continues after the response has gone.
//
// On Vercel, waitUntil keeps the function alive until the promise settles, up
// to its maxDuration (vercel.json). Elsewhere — the Vite dev server — there is
// no request context and the call does nothing, but the promise is already
// running in a process that stays up, which comes to the same thing.
//
// A failure is logged by its kind only. The work being guarded carries the
// content of meetings and the addresses of their participants, and none of
// that may reach a log (constitution, principle VIII).
export function later(label: string, work: Promise<unknown>): void {
  const guarded = work.catch((error: unknown) => {
    console.error(`[${label}] échec en arrière-plan : ${(error as Error)?.name ?? "Error"}`);
  });
  try {
    waitUntil(guarded);
  } catch {
    // No request context: the promise runs on regardless.
  }
}
