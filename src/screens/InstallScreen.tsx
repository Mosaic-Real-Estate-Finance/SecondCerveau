import { useEffect, useRef, useState } from "react";
import { Symbol } from "@/components/logo";
import { Screen } from "@/components/screen";
import { STEPS_IOS, STEPS_MENU, STEPS_NATIVE, type Step } from "@/components/install-invite";
import { yourDevice } from "@/lib/standalone";
import { cssVar, useColorScheme } from "@/lib/theme";
import { useInstallPrompt } from "@/lib/use-install-prompt";
import { cn } from "@/lib/utils";

// The first screen of the app on a phone's browser. The app is used
// installed: signing in on the web first only meant signing in a second time
// in the installed app — the cookies are not shared on an iPhone — with a
// code that the rate limit kept away for a while. So the browser offers the
// install, nothing else; signing in happens once, in the installed app.
//
//   - iPhone, Safari: the animation of the steps, in the page, then the steps;
//   - Android, Chromium: the native install dialog from « Installer l'app »
//     once the browser offers it, the steps by the menu otherwise;
//   - a browser inside another app: where to open the link instead.
//
// A sign-in handed over by QR code still works: App signs the browser in,
// and on an iPhone the page's manifest carries the token into the installed
// app (index.html), which opens signed in.

type Anim = "loading" | "ready" | "failed";

export function InstallScreen() {
  const { canInstall, platform, promptInstall } = useInstallPrompt();
  const [installed, setInstalled] = useState(false);
  const ios = platform === "ios-safari";
  const inApp = platform === "ios-inapp" || platform === "android-inapp";
  const native = canInstall && !ios && !inApp;
  const steps: Step[] = ios ? STEPS_IOS : native ? STEPS_NATIVE : STEPS_MENU;

  const install = async () => {
    if ((await promptInstall()) === "accepted") setInstalled(true);
  };

  // Its own scroll: the document does not scroll (index.css), and on a small
  // phone the animation and the steps run past the bottom.
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <Screen className="mx-auto max-w-[480px] items-center text-center">
        <div aria-hidden className="h-[max(12px,4svh)] shrink-0" />
        <Symbol className="h-12 shrink-0 text-midnight-blue" />
        <h1 className="mt-6 text-balance font-serif text-2xl">
          {inApp
            ? platform === "ios-inapp"
              ? "Ouvrez ce lien dans Safari"
              : "Ouvrez ce lien dans votre navigateur"
            : installed
              ? "Mosaic est installée"
              : `Installez Mosaic sur ${yourDevice()}`}
        </h1>
        <p className="mt-2 text-balance text-base text-[color:var(--muted)]">
          {inApp
            ? `Ce navigateur intégré ne permet pas l'installation. Touchez le menu (••• ou ⋯) puis ${
                platform === "ios-inapp" ? "« Ouvrir dans Safari »" : "« Ouvrir dans le navigateur »"
              }.`
            : installed
              ? "Ouvrez-la depuis votre écran d'accueil et connectez-vous."
              : "L'app s'utilise depuis votre écran d'accueil\u00a0: vous vous y connecterez une seule fois."}
        </p>

        {!inApp && !installed && (
          <div className="mt-6 flex w-full flex-col overflow-hidden rounded-3xl bg-white-smoke text-left">
            {ios && <Animation />}
            <ol className="flex flex-col gap-2 p-5">
              {steps.map((step, index) => (
                <li key={step.text} className="flex items-center gap-3 text-base text-[color:var(--muted)]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-white)] text-xs font-semibold text-navy">
                    {index + 1}
                  </span>
                  <span>{step.text}</span>
                  {step.icon && <span className="flex shrink-0 items-center text-midnight-blue">{step.icon}</span>}
                </li>
              ))}
            </ol>
            {native && (
              <div className="px-5 pb-5">
                <button
                  type="button"
                  onClick={() => void install()}
                  className="flex h-14 w-full items-center justify-center rounded-2xl bg-navy px-6 text-base font-medium text-on-accent"
                >
                  Installer l'app
                </button>
              </div>
            )}
          </div>
        )}
      </Screen>
    </div>
  );
}

// The animation of the Safari steps, played in the page. Its frame must hold
// the animation and nothing else (the app itself, once, through a service
// worker that answered for it): checked on load, dropped otherwise.
function Animation() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<Anim>("loading");
  const scheme = useColorScheme();

  const check = () => {
    try {
      const doc = frame.current?.contentDocument;
      setState(doc?.getElementById("scene") && !doc.getElementById("root") ? "ready" : "failed");
    } catch {
      setState("failed");
    }
  };

  // Painted in the card's own colour, played from the start, again when the
  // theme turns.
  useEffect(() => {
    if (state !== "ready") return;
    frame.current?.contentWindow?.postMessage(
      { type: "pwa-anim:play", bg: cssVar("--color-white-smoke").replace("#", "") },
      location.origin,
    );
  }, [state, scheme]);

  if (state === "failed") return null;
  return (
    <iframe
      ref={frame}
      src="/pwa-install-animation.html#paused"
      title="Comment ajouter l'application à l'écran d'accueil depuis Safari"
      onLoad={check}
      scrolling="no"
      tabIndex={-1}
      aria-hidden
      loading="eager"
      className={cn(
        "block h-[340px] max-h-[42svh] w-full shrink-0 border-0 transition-opacity duration-300",
        state === "ready" ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
