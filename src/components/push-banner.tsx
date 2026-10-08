import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { enablePush, pushOptedOut, pushSupported } from "@/lib/push";
import { isStandalone } from "@/lib/standalone";
import { cn } from "@/lib/utils";

// Notifications are what tell the team a Read AI meeting is waiting for a
// decision, so the installed app asks for them straight away and keeps
// asking, politely, until they are on.
//
// iOS only shows the permission prompt from a tap. On the first launch the
// prompt is therefore tied to the first tap anywhere in the app; after that,
// and whenever the permission is not granted, a banner offers « Activer ».
// A permission once refused cannot be asked again from the page: the banner
// then says where to turn it back on.

type Permission = NotificationPermission | "unsupported";

const read = (): Permission => (pushSupported() ? Notification.permission : "unsupported");

const LEAVE_MS = 250 + 60; // --stack-close, plus a frame or two

export function PushBanner({ visible }: { visible: boolean }) {
  const toast = useToast();
  const installed = isStandalone();
  const [permission, setPermission] = useState<Permission>(read);
  const asking = useRef(false);

  const ask = async () => {
    if (asking.current) return;
    if (Notification.permission === "denied") {
      toast.show("Notifications refusées : réactivez-les dans Réglages › Notifications › Mosaic.");
      return;
    }
    asking.current = true;
    try {
      await enablePush();
    } catch {
      // The banner stays; a second tap tries again.
    } finally {
      asking.current = false;
      setPermission(read());
    }
  };

  useEffect(() => {
    if (!installed || permission === "unsupported") return;
    // Already allowed: make sure this device is subscribed, silently.
    if (permission === "granted") {
      if (!pushOptedOut()) void enablePush().catch(() => undefined);
      return;
    }
    if (permission !== "default") return;
    // touchend is what iOS counts as a user gesture; click covers the rest.
    const first = () => {
      stop();
      void ask();
    };
    const stop = () => {
      document.removeEventListener("touchend", first, true);
      document.removeEventListener("click", first, true);
    };
    document.addEventListener("touchend", first, true);
    document.addEventListener("click", first, true);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed, permission === "unsupported"]);

  // Turned on from the iPhone's settings while the app was in the background.
  useEffect(() => {
    const sync = () => document.visibilityState === "visible" && setPermission(read());
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const wanted = installed && visible && permission !== "granted" && permission !== "unsupported";

  // Mounted with .is-enter, reflowed, then released in the same task, as the
  // snippet orchestrates it; unmounted only after its .is-leaving close.
  const [shown, setShown] = useState(wanted);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (wanted) {
      setLeaving(false);
      setShown(true);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const timer = window.setTimeout(() => setShown(false), LEAVE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const banner = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    const node = banner.current;
    if (!shown || !node) return setEntered(false);
    void node.offsetWidth;
    setEntered(true);
  }, [shown]);

  if (!shown) return null;
  return (
    <div className="push-banner-stage" role="region" aria-label="Notifications">
      <div className="t-stack">
        <div ref={banner} className={cn("t-stack-banner push-banner", !entered && "is-enter", leaving && "is-leaving")} data-depth="0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Les notifications sont importantes</p>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              Elles permettent de valider l'ajout d'un résumé de Read AI dans Notion.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void ask()}
            className="shrink-0 rounded-full bg-navy px-4 py-2.5 text-sm font-medium text-white"
          >
            Activer →
          </button>
        </div>
      </div>
    </div>
  );
}
