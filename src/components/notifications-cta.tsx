import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { enablePush, pushOptedOut, pushSupported } from "@/lib/push";
import { isStandalone, notificationSettingsPath, thisDevice, yourDevice } from "@/lib/standalone";

// At the top of « Notifications » while they are off on this device. This is
// the screen the notifications lead to, so it is where their absence costs
// the most: a call waiting here is a call nobody has been told about.
//
// Three cases, three sentences: never asked (a button, which is the tap iOS
// requires), refused (only the iPhone's settings can undo it), and not the
// installed app (iOS has no push in a browser tab).

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
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
          <Icon name="bell" className="h-4" />
        </span>
        <h2 id="notifications-cta-title" className="text-base font-medium leading-snug">
          {state === "denied" ? "Les notifications sont bloquées" : "Ne laissez aucune réunion en attente"}
        </h2>
      </div>
      <p className="mt-2 text-xs leading-snug text-on-accent/80">
        {state === "off" &&
          "Activez les notifications : vous serez prévenu dès qu'une réunion Read AI attend votre décision, et elle ira dans Notion en un geste."}
        {state === "denied" &&
          `Elles ont été refusées sur ${thisDevice()}. Pour les réactiver : ${notificationSettingsPath()}.`}
        {state === "browser" &&
          `Elles n'arrivent que dans l'app installée. Ouvrez Mosaic depuis l'écran d'accueil de ${yourDevice()} pour les activer.`}
      </p>
      {state === "off" && (
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy}
          className="mt-3 flex h-10 w-full items-center justify-center rounded-xl bg-white text-sm font-medium text-navy disabled:opacity-60"
        >
          {busy ? "Activation…" : "Activer les notifications"}
        </button>
      )}
    </section>
  );
}
