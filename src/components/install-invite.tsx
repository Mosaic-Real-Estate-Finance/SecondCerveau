import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  canPromptInstall,
  detectPlatform,
  installPrompt,
  isMobile,
  isStandalone,
  promptInstall,
  subscribeInstall,
  type Platform,
} from "@/lib/standalone";
import { cn } from "@/lib/utils";

// Shown once, a moment after the app opens on a signed in phone that is still
// running in a browser tab. The layout is the one the animation was built for:
// the phone is inset in the top of the sheet, edge to edge and running off the
// upper edge, with the steps listed underneath it.

const OPEN_DELAY_MS = 2200;
const CLOSE_MS = 320;
// The animation paints its own background so the panel reads as one surface.
const PANEL_BG = "ffffff";

// The two iOS glyphs the steps point at, from Apple's SF Symbols set:
// square.and.arrow.up and plus.app, the exact shapes of the Safari toolbar.
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 433.35 670.654"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M433.35 296.387L433.35 484.375C433.35 550.049 396.729 586.426 331.055 586.426L102.051 586.426C36.377 586.426 0 550.049 0 484.375L0 296.387C0 230.957 36.377 194.336 102.051 194.336L151.367 194.336L151.367 233.643L102.051 233.643C62.0117 233.643 39.3066 256.348 39.3066 296.387L39.3066 484.375C39.3066 524.658 62.0117 547.119 102.051 547.119L331.055 547.119C371.338 547.119 394.043 524.658 394.043 484.375L394.043 296.387C394.043 256.348 371.338 233.643 331.055 233.643L281.738 233.643L281.738 194.336L331.055 194.336C396.729 194.336 433.35 230.957 433.35 296.387Z" />
      <path d="M133.789 152.1C138.428 152.1 143.799 150.146 147.217 146.24L185.059 105.957L216.553 72.5098L248.291 105.957L285.889 146.24C289.307 150.146 294.434 152.1 299.072 152.1C309.326 152.1 316.895 145.02 316.895 135.01C316.895 129.639 314.941 125.732 311.279 122.07L230.713 44.4336C225.83 39.5508 221.68 38.0859 216.553 38.0859C211.67 38.0859 207.52 39.5508 202.393 44.4336L122.07 122.07C118.408 125.732 116.211 129.639 116.211 135.01C116.211 145.02 123.535 152.1 133.789 152.1ZM216.553 395.264C227.051 395.264 236.084 386.719 236.084 376.465L236.084 128.174L233.154 62.2559C232.666 53.4668 225.586 45.8984 216.553 45.8984C207.764 45.8984 200.684 53.4668 200.195 62.2559L197.266 128.174L197.266 376.465C197.266 386.719 206.055 395.264 216.553 395.264Z" />
    </svg>
  );
}

function PlusAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 450.195 449.951"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M132.812 449.951L317.139 449.951C360.107 449.951 393.555 437.5 415.527 415.527C438.232 393.066 450.195 359.619 450.195 316.895L450.195 133.057C450.195 90.332 438.232 56.8848 415.527 34.4238C393.311 12.207 360.107 0 317.139 0L132.812 0C90.0879 0 56.3965 12.4512 34.4238 34.4238C11.9629 56.8848 0 90.332 0 133.057L0 316.895C0 359.619 11.7188 393.066 34.4238 415.527C56.6406 437.744 90.0879 449.951 132.812 449.951ZM132.812 410.645C102.539 410.645 78.8574 402.1 63.4766 386.719C47.6074 371.094 39.3066 347.656 39.3066 316.895L39.3066 133.057C39.3066 102.295 47.6074 78.8574 63.4766 63.2324C78.6133 48.0957 102.539 39.3066 132.812 39.3066L317.139 39.3066C347.656 39.3066 371.094 47.8516 386.719 63.2324C402.588 78.8574 410.889 102.295 410.889 133.057L410.889 316.895C410.889 347.656 402.588 371.094 386.719 386.719C371.338 401.855 347.656 410.645 317.139 410.645Z" />
      <path d="M245.605 316.895L245.605 132.324C245.605 119.873 237.061 111.328 224.854 111.328C212.891 111.328 204.834 119.873 204.834 132.324L204.834 316.895C204.834 329.102 212.891 337.646 224.854 337.646C237.061 337.646 245.605 329.346 245.605 316.895ZM133.057 244.873L317.627 244.873C329.834 244.873 338.379 236.816 338.379 224.854C338.379 212.646 329.834 204.102 317.627 204.102L133.057 204.102C120.361 204.102 112.061 212.646 112.061 224.854C112.061 236.816 120.605 244.873 133.057 244.873Z" />
    </svg>
  );
}

const STEPS = [
  { text: "Touchez Partager", icon: <ShareIcon className="h-[18px] w-auto" /> },
  {
    text: "Touchez « Sur l'écran d'accueil »",
    icon: <PlusAppIcon className="h-[17px] w-[17px]" />,
  },
  { text: "« Ajouter »", icon: null },
];

export function InstallInvite() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const frame = useRef<HTMLIFrameElement>(null);
  const installable = useSyncExternalStore(
    subscribeInstall,
    canPromptInstall,
    () => false,
  );
  const ios = platform === "ios-safari";
  const inApp = platform === "ios-inapp" || platform === "android-inapp";

  useEffect(() => {
    if (isStandalone() || !isMobile() || installPrompt.dismissed()) return;
    // Mounted at once but closed, so the animation is loaded and paused by the
    // time the sheet slides up; opened after the app has had a moment.
    setPlatform(detectPlatform());
    setMounted(true);
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const close = useCallback(() => {
    installPrompt.dismiss();
    setOpen(false);
    window.setTimeout(() => setMounted(false), CLOSE_MS);
  }, []);

  // The animation loops forever, so it only runs while the sheet is open.
  useEffect(() => {
    if (!loaded) return;
    frame.current?.contentWindow?.postMessage(
      { type: open ? "pwa-anim:play" : "pwa-anim:pause", bg: PANEL_BG },
      location.origin,
    );
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!mounted) return null;

  const install = async () => {
    if (await promptInstall()) close();
  };

  return (
    <div
      className={cn("fixed inset-0 z-50", !open && "pointer-events-none")}
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
      // Loaded before it is shown: invisible, and out of the reading order.
      aria-hidden={!open}
      inert={!open}
    >
      <button
        type="button"
        aria-label="Fermer"
        onClick={close}
        className={cn(
          "absolute inset-0 bg-midnight-blue/30 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] max-w-[480px] flex-col overflow-hidden rounded-t-3xl bg-white p-5 transition-transform duration-300",
          open ? "translate-y-0" : "translate-y-full",
        )}
        style={{
          paddingBottom: "calc(var(--safe-bottom) + 20px)",
          transitionTimingFunction: "var(--page-slide-ease)",
        }}
      >
        {ios && (
          // Inset: the animation takes the top of the sheet, edge to edge, so
          // the phone runs off the upper edge with no frame around it.
          <div className="-mx-5 -mt-5 mb-4 shrink-0 overflow-hidden rounded-t-3xl">
            <iframe
              ref={frame}
              src="/pwa-install-animation.html#paused"
              title="Comment ajouter l'application à l'écran d'accueil depuis Safari"
              onLoad={() => setLoaded(true)}
              scrolling="no"
              tabIndex={-1}
              aria-hidden
              loading="eager"
              className={cn(
                "block h-[420px] w-full border-0 transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0",
              )}
              style={{ maxHeight: "40dvh" }}
            />
          </div>
        )}

        <button
          type="button"
          onClick={close}
          aria-label="Fermer"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-midnight-blue/10 text-midnight-blue"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        {/* The only part that may be scrolled: on a short phone the steps give
            way rather than the button, which stays within reach. */}
        <div className="min-h-0 overflow-y-auto">
          {/* On a phone the title holds one line: its size follows the width of
            the sheet, and the cross sits on the animation, not beside it. */}
          <h2
            id="install-title"
            className={cn(
              "font-serif",
              ios
                ? "whitespace-nowrap text-[min(23px,calc((min(100vw,480px)-40px)*0.052))] leading-tight"
                : "pr-10 text-xl leading-tight",
            )}
          >
            {inApp
              ? "Ouvrez ce lien dans Safari"
              : "Installez Dictée sur votre iPhone"}
          </h2>

          {inApp ? (
            <p className="mt-3 text-base text-[color:var(--muted)]">
              Ce navigateur intégré ne permet pas l'ajout à l'écran d'accueil.
              Touchez le menu (••• ou ⋯) puis
              {platform === "ios-inapp"
                ? " « Ouvrir dans Safari »."
                : " « Ouvrir dans le navigateur »."}
            </p>
          ) : (
            <>
              <p className="mt-2 text-base text-[color:var(--muted)]">
                Dictez une note en un geste, hors ligne.
              </p>
              {ios ? (
                <ol className="mt-4 flex flex-col gap-2">
                  {STEPS.map((step, index) => (
                    <li
                      key={step.text}
                      className="flex items-center gap-3 text-base text-[color:var(--muted)]"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white-smoke text-xs font-semibold text-navy">
                        {index + 1}
                      </span>
                      <span>{step.text}</span>
                      {step.icon && (
                        <span className="flex shrink-0 items-center text-midnight-blue">
                          {step.icon}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-base text-[color:var(--muted)]">
                  {installable
                    ? "Ajoutez Dictée à votre écran d'accueil : elle s'ouvre comme une app et démarre plus vite."
                    : "Utilisez le menu de votre navigateur puis « Installer l'application » ou « Ajouter à l'écran d'accueil »."}
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex shrink-0 flex-col gap-2">
          {installable && !ios && !inApp && (
            <button
              type="button"
              onClick={install}
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-navy px-6 text-base font-medium text-white"
            >
              Installer l'app
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className={cn(
              "flex h-12 w-full items-center justify-center rounded-2xl px-6 text-base font-medium",
              installable && !ios && !inApp
                ? "border border-midnight-blue/15 text-midnight-blue"
                : "bg-navy text-white",
            )}
          >
            J'ai compris
          </button>
        </div>
      </div>
    </div>
  );
}
