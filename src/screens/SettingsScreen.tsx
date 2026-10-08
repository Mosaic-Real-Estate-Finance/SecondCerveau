import { useEffect, useState } from "react";
import { PrimaryButton, TextButton } from "@/components/screen";
import { Shimmer } from "@/components/shimmer";
import { useToast } from "@/components/toast";
import { openInstallInvite } from "@/components/install-invite";
import { ApiError, fetchReview, logout, removeExcluded } from "@/lib/api";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";
import { isStandalone } from "@/lib/standalone";

// Notifications, the contacts excluded from Read AI, and signing out. The
// excluded contacts open in the same sheet, grown to its large detent.

export function SettingsScreen({
  active,
  email,
  onBack,
  onSignedOut,
  onExpand,
}: {
  active: boolean;
  email: string;
  onBack: () => void;
  onSignedOut: () => void;
  /** The excluded contacts want the sheet's large detent. */
  onExpand: (expanded: boolean) => void;
}) {
  const toast = useToast();
  const [view, setView] = useState<"main" | "excluded">("main");
  const show = (next: "main" | "excluded") => {
    setView(next);
    onExpand(next === "excluded");
  };
  // Back to the first view whenever the sheet is opened again.
  useEffect(() => {
    if (active) return;
    setView("main");
    onExpand(false);
  }, [active, onExpand]);
  const [push, setPush] = useState<"unknown" | "on" | "off">("unknown");
  const [busy, setBusy] = useState(false);
  const installed = isStandalone();

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

  if (view === "excluded") return <ExcludedContacts onBack={() => show("main")} onUnauthorized={onSignedOut} />;

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

      <button
        type="button"
        onClick={() => show("excluded")}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-white-smoke p-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium">Contacts exclus</span>
          <span className="mt-1 block text-xs text-[color:var(--muted)]">
            Les personnes que vous avez choisi de ne pas ajouter dans Notion.
          </span>
        </span>
        <Chevron />
      </button>

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

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--muted)]" aria-hidden>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

// The exclusion list is the team's: an address set aside by one is no
// longer proposed to anyone.
function ExcludedContacts({ onBack, onUnauthorized }: { onBack: () => void; onUnauthorized: () => void }) {
  const toast = useToast();
  const [emails, setEmails] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchReview()
      .then((data) => live && setEmails(data.excluded))
      .catch((cause) => {
        if (!live) return;
        if (cause instanceof ApiError && cause.status === 401) return onUnauthorized();
        setError((cause as Error).message || "Liste indisponible.");
      });
    return () => {
      live = false;
    };
  }, [onUnauthorized]);

  const remove = async (email: string) => {
    if (removing) return;
    setRemoving(email);
    try {
      setEmails((await removeExcluded(email)).excluded);
    } catch (cause) {
      toast.show((cause as Error).message || "Le contact n'a pas pu être retiré.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      <header className="mb-2">
        <TextButton onClick={onBack} className="-ml-3 flex items-center gap-1">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Réglages
        </TextButton>
        <h1 className="mt-1 font-serif text-2xl">Contacts exclus</h1>
      </header>
      <p className="mb-4 text-xs text-[color:var(--muted)]">
        Les personnes que vous avez refusé d'ajouter dans Notion ne vous sont plus proposées, ni à vos collègues.
        Retirez-en une pour qu'elle le soit à nouveau.
      </p>

      {error ? (
        <p className="text-sm text-[color:var(--muted)]">{error}</p>
      ) : emails === null ? (
        <p className="text-sm text-[color:var(--muted)]">Chargement…</p>
      ) : emails.length === 0 ? (
        <p className="rounded-2xl bg-white-smoke p-4 text-sm text-[color:var(--muted)]">Aucun contact exclu.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {emails.map((email) => (
            <li key={email} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white-smoke py-2 pl-4 pr-2">
              <span className="min-w-0 truncate text-sm">{email}</span>
              <TextButton onClick={() => void remove(email)} disabled={removing !== null} className="shrink-0 text-sm">
                {removing === email ? "Retrait…" : "Retirer"}
              </TextButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
