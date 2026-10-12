import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { enablePush, pushOptedOut, pushSupported } from "@/lib/push";
import { isStandalone } from "@/lib/standalone";

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
    <section className="mb-6 rounded-3xl bg-navy p-5 text-on-accent" aria-labelledby="notifications-cta-title">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
        <Icon name="bell" className="h-[22px]" />
      </span>
      <h2 id="notifications-cta-title" className="mt-4 font-serif text-xl">
        {state === "denied" ? "Les notifications sont bloquées" : "Ne laissez aucune réunion en attente"}
      </h2>
      <p className="mt-2 text-sm leading-snug text-on-accent/80">
        {state === "off" &&
          "Activez les notifications : vous serez prévenu dès qu'une réunion Read AI attend votre décision, et elle ira dans Notion en un geste."}
        {state === "denied" &&
          "Elles ont été refusées sur cet iPhone. Pour les réactiver : Réglages › Notifications › Mosaic › Autoriser les notifications."}
        {state === "browser" &&
          "Elles n'arrivent que dans l'app installée. Ouvrez Mosaic depuis l'écran d'accueil de votre iPhone pour les activer."}
      </p>
      {state === "off" && (
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-white text-base font-medium text-navy disabled:opacity-60"
        >
          {busy ? "Activation…" : "Activer les notifications"}
        </button>
      )}
    </section>
  );
}
