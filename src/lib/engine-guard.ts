// iOS never reports a crash. It brings the tab back, and the dictation is
// gone with it.
//
// So anything the transcription engine does that a phone might not take —
// holding 406 MB of weights in memory while a recording is running, running
// a pass during it — is done behind a breadcrumb. It is written before the
// risky work starts and removed when it ends, and also whenever the page is
// legitimately hidden, closed or navigated away from. A breadcrumb still
// there on the next launch can therefore mean only one thing: the tab died
// doing it. The engine steps down a level and stays there.
//
// Level 0 transcribes the dictation as it is spoken. Level 1 and above is
// the plain path: nothing is loaded until the recording is over, and the
// whole file is transcribed in one go.

const LEVEL = "mosaic-engine-level";
const CRUMB = "mosaic-engine-busy";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // No storage: the guard simply does not carry across launches.
  }
};

let level = Number(read(LEVEL)) || 0;

const crumb = read(CRUMB);
if (crumb) {
  level += 1;
  write(LEVEL, String(level));
  write(CRUMB, null);
}

/** What the engine was doing when the tab last died, if it did. */
export const lastCrash = crumb;

export const engineLevel = () => level;

/** True while the dictation may be transcribed as it is spoken. */
export const liveAllowed = () => level < 1;

/** Marks the start of work the tab might not survive. */
export const guardStart = (what: string) => write(CRUMB, `${what} ${new Date().toISOString()}`);

export const guardEnd = () => write(CRUMB, null);

// Leaving the page is not a crash, and neither is the phone being locked
// mid dictation. Both clear the breadcrumb, so the guard only ever fires on
// a tab that really went away without a word.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", guardEnd);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") guardEnd();
  });
}
