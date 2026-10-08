import { useEffect, useState } from "react";
import { PrimaryButton, TextButton } from "@/components/screen";
import { Shimmer } from "@/components/shimmer";
import { useToast } from "@/components/toast";
import { openInstallInvite } from "@/components/install-invite";
import { logout } from "@/lib/api";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";
import { isStandalone } from "@/lib/standalone";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

// Three settings: notifications, appearance, and signing out.

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "auto", label: "Automatique" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];

export function SettingsScreen({
  active,
  email,
  onBack,
  onSignedOut,
}: {
  active: boolean;
  email: string;
  onBack: () => void;
  onSignedOut: () => void;
}) {
  const toast = useToast();
  const [push, setPush] = useState<"unknown" | "on" | "off">("unknown");
  const [busy, setBusy] = useState(false);
  const installed = isStandalone();
  const theme = useThemePreference();

  useEffect(() => {
    if (!active || !installed) return;
    void currentSubscription()
      .then((subscription) => setPush(subscription ? "on" : "off"))
      .catch(() => setPush("off"));
  }, [active, installed]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (push === "on") {
        await disablePush({ optOut: true });
        setPush("off");
      } else if (await enablePush()) {
        setPush("on");
      } else {
        toast.show("Notifications refusées : autorisez-les dans les réglages de l'iPhone.");
      }
    } catch (error) {
      toast.show((error as Error).message || "Les notifications n'ont pas pu être activées.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The device stops receiving the team's notifications with the session.
      await disablePush().catch(() => undefined);
      await logout();
    } catch {
      // Signed out locally all the same: the cookie is HttpOnly, and a
      // session the server could not revoke still runs out on its own.
    } finally {
      setBusy(false);
      onSignedOut();
    }
  };

  return (
    <div>
      {/* A sheet's header: the title, and the way out on the right. */}
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-serif text-2xl">Réglages</h1>
        <TextButton onClick={onBack} className="-mr-3">
          OK
        </TextButton>
      </header>

      <section className="rounded-2xl bg-white-smoke p-4">
        <h2 className="text-base font-medium">Notifications</h2>
        {installed && pushSupported() ? (
          <>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Une réunion ajoutée, des personnes à valider, ou une réunion qui n'a pas pu être enregistrée. Jamais de
              résumé ni de transcription.
            </p>
            <label className="mt-3 flex min-h-11 items-center justify-between gap-3">
              <span className="text-base">Recevoir les notifications</span>
              <input
                type="checkbox"
                role="switch"
                checked={push === "on"}
                disabled={busy || push === "unknown"}
                onChange={() => void toggle()}
                className="h-6 w-6 accent-[color:var(--color-navy)]"
              />
            </label>
          </>
        ) : installed ? (
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            Cet appareil ne reçoit pas les notifications (iOS 16.4 ou plus récent requis).
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Les notifications n'arrivent que dans l'application installée sur l'écran d'accueil.
            </p>
            <TextButton onClick={openInstallInvite} className="-ml-3 mt-1">
              Installer l'application
            </TextButton>
          </>
        )}
      </section>

      <section className="mt-4 rounded-2xl bg-white-smoke p-4">
        <h2 className="text-base font-medium">Apparence</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">Automatique suit le réglage de l'iPhone.</p>
        <div role="radiogroup" aria-label="Apparence" className="mt-3 flex flex-wrap gap-2">
          {THEMES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => setThemePreference(value)}
              className={theme === value ? "chip on" : "chip"}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl bg-white-smoke p-4">
        <h2 className="text-base font-medium">Compte</h2>
        <p className="mt-1 truncate text-xs text-[color:var(--muted)]">
          Vous êtes connecté avec <Shimmer>{email}</Shimmer>
        </p>
      </section>

      <PrimaryButton onClick={() => void signOut()} disabled={busy} className="mt-6">
        Se déconnecter
      </PrimaryButton>
    </div>
  );
}
