// The home screen shows one banner that comes and goes at a time — the
// pending count, the feedback question — and leaves a pause between two, so
// that nothing reads as one notice after another. The banners that stay
// until something is fixed (an outage, notifications to turn on) are kept
// apart by App and are never on screen with these.

/** The quiet time after a banner, before the next may show. */
export const BANNER_GAP_MS = 45_000;

let owner: string | null = null;
let freeAt = 0;

export const bannerSlot = {
  /** Takes the place for `id`; false while another holds it or the pause lasts. */
  claim(id: string): boolean {
    if (owner === id) return true;
    if (owner !== null || Date.now() < freeAt) return false;
    owner = id;
    return true;
  },
  release(id: string) {
    if (owner !== id) return;
    owner = null;
    freeAt = Date.now() + BANNER_GAP_MS;
  },
  /** How long before a claim could succeed, as far as the pause goes. */
  waitMs: () => (owner !== null ? 2_000 : Math.max(0, freeAt - Date.now())),
};
