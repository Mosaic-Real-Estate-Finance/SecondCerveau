import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { openInstallInvite } from "@/components/install-invite";
import { enablePush, pushOptedOut, pushSupported } from "@/lib/push";
import { isStandalone, notificationSettingsPath } from "@/lib/standalone";

// At the top of « Notifications » while they are off on this device. This is
// the screen the notifications lead to, so it is where their absence costs
// the most: a call waiting here is a call nobody has been told about.
//
// Three cases, each with its one way forward: not the installed app (iOS has
// no push in a browser tab: the install guide), never asked (a button, which
// is the tap iOS requires), refused (only the device's settings undo it).

type State = "off" | "denied" | "browser" | "on";

function read(): State {
  if (!isStandalone() || !pushSupported()) return "browser";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && !pushOptedOut() ? "on" : "off";
}

export function NotificationsCta() {
  const [state, setState] = useState<State>(read);
  const [busy, setBusy] = useState(false);

  // Turned on from the iPhone's settings while the app was in the background.
  useEffect(() => {
    const sync = () => document.visibilityState === "visible" && setState(read());
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  if (state === "on") return null;

  const enable = async () => {
    setBusy(true);
    try {
      await enablePush();
    } catch {
      // The card stays; a second tap tries again.
    } finally {
      setBusy(false);
      setState(read());
    }
  };

  return (
    <section className="mb-5 rounded-2xl bg-navy p-4 text-on-accent" aria-labelledby="notifications-cta-title">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-on-accent/15">
          <Icon name="bell" className="h-4" />
        </span>
        <h2 id="notifications-cta-title" className="text-base font-medium leading-snug">
          {state === "browser"
            ? "Installez l'app pour recevoir les notifications"
            : state === "denied"
              ? "Les notifications sont bloquées"
              : "Activez les notifications"}
        </h2>
      </div>
      <p className="mt-2 text-xs leading-snug text-on-accent/80">
        {state === "denied"
          ? `Réactivez-les dans ${notificationSettingsPath()}.`
          : "Soyez prévenu dès qu'une dictée ou une réunion attend votre validation."}
      </p>
      {state !== "denied" && (
        <button
          type="button"
          onClick={() => (state === "browser" ? openInstallInvite() : void enable())}
          disabled={busy}
          className="tap-target mt-3 flex h-10 w-full items-center justify-center rounded-xl bg-on-accent font-medium text-navy disabled:opacity-60"
        >
          {state === "browser" ? "Installer l'app" : busy ? "Activation…" : "Activer les notifications"}
        </button>
      )}
    </section>
  );
}
