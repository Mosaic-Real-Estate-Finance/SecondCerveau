import { deletePushSubscription, savePushSubscription } from "@/lib/api";

// Web Push on this device (brief §9). On an iPhone it only exists inside the
// installed app, from iOS 16.4, and the permission can only be asked from a
// tap — never on load.

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  Boolean(KEY);

// The application server key travels as base64url; the API wants bytes.
function keyBytes(base64url: string) {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// Turned off from the settings on this device: the app does not subscribe
// it again on its own, even though the permission is still granted.
const OPT_OUT = "mosaic-push-off";
export const pushOptedOut = () => {
  try {
    return localStorage.getItem(OPT_OUT) === "1";
  } catch {
    return false;
  }
};
const setOptOut = (off: boolean) => {
  try {
    if (off) localStorage.setItem(OPT_OUT, "1");
    else localStorage.removeItem(OPT_OUT);
  } catch {
    // Private mode: the choice lasts as long as the subscription does.
  }
};

/** From a tap. Resolves false when the permission was refused. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  setOptOut(false);
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }));
  await savePushSubscription(subscription.toJSON());
  return true;
}

/** `optOut`: the user turned them off, rather than signing out. */
export async function disablePush({ optOut = false } = {}): Promise<void> {
  if (optOut) setOptOut(true);
  const subscription = await currentSubscription();
  if (!subscription) return;
  await deletePushSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}
