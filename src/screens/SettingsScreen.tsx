import { useEffect, useMemo, useState } from "react";
import { PrimaryButton, TextButton } from "@/components/screen";
import { SheetPages } from "@/components/sheet";
import { cssVar } from "@/lib/theme";
import { safeAreaLog } from "@/lib/safe-area";
import { cn } from "@/lib/utils";
import { Shimmer } from "@/components/shimmer";
import { useToast } from "@/components/toast";
import { openInstallInvite } from "@/components/install-invite";
import { ApiError, createHandoff, fetchReview, logout, removeExcluded } from "@/lib/api";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";
import { detectDevice, detectPlatform, isIOS, isStandalone, notificationSettingsPath } from "@/lib/standalone";

// Notifications, the contacts excluded from Read AI, and signing out. The
// excluded contacts open in the same sheet, grown to its large detent.

export function SettingsScreen({
  active,
  email,
  onBack,
  onSignedOut,
  onExpand,
  initialView = "main",
}: {
  active: boolean;
  email: string;
  onBack: () => void;
  onSignedOut: () => void;
  /** The excluded contacts want the sheet's large detent. */
  onExpand: (expanded: boolean) => void;
  /** Opened on a page other than the first: the « contacts exclus » banner. */
  initialView?: "main" | "excluded";
}) {
  const toast = useToast();
  const [view, setView] = useState<"main" | "excluded" | "phone">(initialView);
  // Five taps on the title: what the screen measured at launch (safe-area.ts).
  const [titleTaps, setTitleTaps] = useState(0);
  useEffect(() => {
    if (initialView === "excluded") onExpand(true);
    // At the opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const show = (next: "main" | "excluded" | "phone") => {
    setView(next);
    onExpand(next === "excluded");
  };
  const [push, setPush] = useState<"unknown" | "on" | "off">("unknown");
  const [busy, setBusy] = useState(false);
  const installed = isStandalone();
  // On a computer the notifications have nowhere to go: the phone is where
  // the app belongs, and this is where it is sent there.
  const desktop = useMemo(() => detectPlatform() === "desktop", []);

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
        toast.show(`Notifications refusées : autorisez-les dans ${notificationSettingsPath()}.`);
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

  // The second pages slide in beside the first, as every page of the app.
  const page =
    view === "excluded" ? (
      <ExcludedContacts onBack={() => show("main")} onUnauthorized={onSignedOut} />
    ) : view === "phone" ? (
      <PhoneHandoff onBack={() => show("main")} onUnauthorized={onSignedOut} />
    ) : null;

  return (
    <SheetPages id={view} depth={page ? 1 : 0}>
      {page ?? (
        <div>
          {/* A sheet's header: the title, and the way out on the right. */}
          <header className="mb-4 flex items-center justify-between">
            <h1 className="font-serif text-2xl" onClick={() => setTitleTaps((n) => n + 1)}>
              Réglages
            </h1>
            <TextButton onClick={onBack} className="-mr-3">
              OK
            </TextButton>
          </header>

          {desktop ? (
            <button
              type="button"
              onClick={() => show("phone")}
              className="flex w-full items-center gap-3 rounded-2xl bg-white-smoke p-4 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium">Installer l'application sur mon téléphone</span>
                <span className="mt-1 block text-xs text-[color:var(--muted)]">
                  Ajoutez l'app sur votre téléphone pour enregistrer des notes plus facilement.
                </span>
              </span>
              <Chevron />
            </button>
          ) : (
            <section className="rounded-2xl bg-white-smoke p-4">
              <h2 className="text-base font-medium">Notifications</h2>
              {installed && pushSupported() ? (
                <>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    Une réunion ajoutée, des personnes à valider, ou une réunion qui n'a pas pu être enregistrée. Jamais de
                    résumé ni de transcription.
                  </p>
                  {/* The one thing to touch in this card, set apart on its own plate. */}
                  <label className="mt-3 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                    <span className="text-base font-medium">Recevoir les notifications</span>
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
                  {isIOS()
                    ? `${detectDevice() === "ipad" ? "Cet iPad" : "Cet iPhone"} ne reçoit pas les notifications : iOS 16.4 ou plus récent est requis.`
                    : "Ce navigateur ne reçoit pas les notifications."}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    Les notifications n'arrivent que dans l'application installée sur l'écran d'accueil.
                  </p>
                  <button
                    type="button"
                    onClick={openInstallInvite}
                    className="mt-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-left text-base font-medium text-navy"
                  >
                    Installer l'application
                    <Chevron />
                  </button>
                </>
              )}
            </section>
      )}

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

      {titleTaps >= 5 && <ScreenDiagnosis />}
    </div>
      )}
    </SheetPages>
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
        <p className="text-[color:var(--muted)]">{error}</p>
      ) : emails === null ? (
        <p className="text-[color:var(--muted)]">Chargement…</p>
      ) : emails.length === 0 ? (
        <p className="rounded-2xl bg-white-smoke p-4 text-[color:var(--muted)]">Aucun contact exclu.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {emails.map((email) => (
            <li key={email} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white-smoke py-2 pl-4 pr-2">
              <span className="min-w-0 truncate">{email}</span>
              <TextButton onClick={() => void remove(email)} disabled={removing !== null} className="shrink-0">
                {removing === email ? "Retrait…" : "Retirer"}
              </TextButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The computer's way onto the phone: a QR code that opens the app there,
// signed in as the same person, on the install guide. The link inside is a
// sign-in, short-lived and good once (see functions/_lib/session.ts), hence
// the warning under it. The QR encoder is loaded here only: a computer's
// settings are the one place it is drawn.
function PhoneHandoff({ onBack, onUnauthorized }: { onBack: () => void; onUnauthorized: () => void }) {
  const [link, setLink] = useState<{ svg: string; until: number } | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const make = async () => {
    setError("");
    setLink(null);
    try {
      const [{ url, expiresIn }, { renderSVG }] = await Promise.all([createHandoff(), import("uqr")]);
      // Dark on light in both themes (--qr-* in index.css): scanned inverted,
      // a code fails on some cameras.
      const svg = renderSVG(url, { ecc: "M", border: 2, blackColor: cssVar("--qr-ink"), whiteColor: cssVar("--qr-paper") });
      const at = Date.now();
      setNow(at);
      setLink({ svg, until: at + expiresIn * 1000 });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return onUnauthorized();
      setError((cause as Error).message || "Le QR code n'a pas pu être créé.");
    }
  };

  useEffect(() => {
    void make();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expired = link !== null && now >= link.until;
  const left = link ? Math.max(0, Math.ceil((link.until - now) / 60000)) : 0;
  const svg = link?.svg ?? "";

  return (
    <div>
      <header className="mb-2">
        <TextButton onClick={onBack} className="-ml-3 flex items-center gap-1">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Réglages
        </TextButton>
        <h1 className="mt-1 font-serif text-2xl">Scannez avec votre téléphone</h1>
        <p className="mt-2 text-base text-[color:var(--muted)]">
          Visez ce code avec l'appareil photo. L'app s'ouvre, vous êtes déjà connecté, il ne reste qu'à l'installer.
        </p>
      </header>

      <div className="mt-5 flex justify-center">
        <div
          className={cn(
            "relative h-56 w-56 overflow-hidden rounded-2xl p-2 shadow-[0_0_0_1px_var(--hairline)]",
            // The code's own paper; the messages in its place sit on the page.
            svg && !expired ? "bg-[color:var(--qr-paper)]" : "bg-white",
          )}
        >
          {svg && !expired && (
            <span
              role="img"
              aria-label="QR code de connexion"
              className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
          {(!link || expired) && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
              {error ? (
                <p className="px-3 text-xs text-[color:var(--muted)]">{error}</p>
              ) : expired ? (
                <p className="px-3 text-[color:var(--muted)]">Ce code a expiré.</p>
              ) : (
                <Shimmer>Création du code…</Shimmer>
              )}
              {(error || expired) && (
                <TextButton onClick={() => void make()}>
                  Nouveau code
                </TextButton>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-[color:var(--muted)]">
        {link && !expired
          ? `Valable encore ${left} min. Il ouvre votre compte : ne le partagez pas.`
          : "Il ouvre votre compte : ne le partagez pas."}
      </p>
    </div>
  );
}

// Hidden, for a layout that went wrong on a phone that cannot be watched from
// a computer: the launch's measurements, ready to screenshot.
function ScreenDiagnosis() {
  const log = safeAreaLog();
  return (
    <section className="mt-6 rounded-2xl bg-white-smoke p-4">
      <h2 className="text-base font-medium">Diagnostic d'affichage</h2>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        {log ? `Lancement du ${new Date(log.launch).toLocaleString("fr-FR")}` : "Aucune mesure (app non installée ou pas un iPhone)."}
      </p>
      {log && (
        <pre className="mt-3 overflow-x-auto text-[11px] leading-snug">
          {"ms     page écran vue  env barre appliqué\n" +
            log.samples
              .map((x) => [x.at, x.inner, x.screen, x.viewport, x.reported, x.bar, x.applied].map((v) => String(v).padEnd(5)).join(" "))
              .join("\n")}
        </pre>
      )}
    </section>
  );
}
