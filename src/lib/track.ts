// Usage events, sent to /api/track (functions/api/track.ts), which writes
// them to Notion after it has answered.
//
// Fire and forget: a beacon, queued by the browser and sent even as the page
// closes, with nothing to wait for and nothing to report. Without beacons, a
// keepalive fetch whose result is ignored. Nothing here can throw or slow
// what the user is doing.

export type TrackAction =
  | "Le site a été ouvert"
  | "Le guide /welcome a été ouvert"
  | "Une dictée a été enregistrée"
  | "Les notifications ont été approuvées"
  | "Un utilisateur a été exclu"
  | "Les notifications ont été activées"
  | "Le panneau Outlook a été ouvert";

/** `user`: the mailbox, where no session cookie says who it is (Outlook). */
export function track(action: TrackAction, user?: string) {
  // The mockup plays the real screens with made-up data: nothing it does
  // happened.
  if (location.pathname.startsWith("/maquette")) return;
  try {
    const body = JSON.stringify(user ? { action, user } : { action });
    if (navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/track", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Not worth a thing to the user.
  }
}
