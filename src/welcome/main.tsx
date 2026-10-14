import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import "@/styles/index.css";
import "./welcome.css";
import { Symbol } from "@/components/logo";
import { cn } from "@/lib/utils";
import { LogoQr } from "./logo-qr";

// /welcome: the clients' onboarding, apart from the app — no sign-in, no
// server, nothing read or written. Four steps: a word of welcome, the phone
// app (with Read AI), the Outlook add-in, then a meeting to book.
//
// Everything a step points at is set here, in one place.
const APP_URL = "https://mosaic.gouman.fr";
const MANIFEST_URL = "https://mosaic.gouman.fr/outlook/manifest.xml";
const ADMIN_URL = "https://admin.cloud.microsoft/#/Settings/IntegratedApps";
const BOOKING_URL = "https://calendar.notion.so/meet/gouman/m4a54ybp";
// Notion Calendar only lets notion.com frame its booking pages
// (frame-ancestors), so here the page opens in a new tab. A booking tool that
// allows embedding (Cal.com, Calendly…) goes here and shows in the page.
const BOOKING_EMBED: string | null = null;

// Tella embeds, without their autoplay parameter (set below), and the size of
// each recording: the frame takes the video's own proportions, so the player
// draws no bands around it.
type VideoSource = { id: string; width: number; height: number; title: string };
const VIDEO_APP: VideoSource = { id: "vid_cmv5tsxhm002t05kw486u5vvo", width: 1440, height: 1080, title: "Installer et utiliser l'application Mosaic" };
const VIDEO_OUTLOOK: VideoSource = { id: "vid_cmv8am3ab006q02l1ebwd3mil", width: 1920, height: 1200, title: "Installer le complément Outlook" };
const embed = (video: VideoSource, autoplay: boolean) =>
  `https://www.tella.tv/video/${video.id}/embed?b=0&title=0&a=${autoplay ? 1 : 0}&loop=0&t=0&muted=0&wt=0&o=1`;

const STEPS = [
  { id: "bienvenue", label: "Bienvenue" },
  { id: "application", label: "Application" },
  { id: "outlook", label: "Outlook" },
  { id: "rendez-vous", label: "Rendez-vous" },
] as const;

// Every step stays mounted, so a video loaded ahead of time is still there
// when its step comes. The change glides like a page — out to one side, in
// from the other, with a light blur — on the app's page easing.
const EASE = [0.22, 1, 0.36, 1] as const;

const fromHash = () => {
  const index = STEPS.findIndex((step) => `#${step.id}` === location.hash);
  return index === -1 ? 0 : index;
};

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function Welcome() {
  const [step, setStep] = useState(fromHash);
  // The furthest step reached: the video of the step after it loads ahead.
  const [reached, setReached] = useState(step);
  const reduceMotion = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);

  const go = useCallback((to: number) => {
    if (to < 0 || to >= STEPS.length) return;
    setStep(to);
    setReached((at) => Math.max(at, to));
  }, []);

  // The step lives in the address, so a link can open on one and the
  // browser's back button walks the steps.
  useEffect(() => {
    const hash = step === 0 ? "" : `#${STEPS[step].id}`;
    if (location.hash !== hash) history.pushState(null, "", hash || location.pathname);
    top.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  }, [step, reduceMotion]);

  useEffect(() => {
    const onPop = () => go(fromHash());
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight") go(step + 1);
      if (event.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [go, step]);

  const next = step + 1 < STEPS.length ? STEPS[step + 1] : null;
  const pages = [
    <Intro key="0" />,
    <AppStep key="1" active={step === 1} load={reached >= 0} />,
    <OutlookStep key="2" active={step === 2} load={reached >= 1} />,
    <BookingStep key="3" />,
  ];

  return (
    <div
      ref={top}
      className="mx-auto flex min-h-full w-full max-w-[1040px] flex-col px-4 sm:px-8"
      style={{ paddingTop: "calc(var(--safe-top) + 20px)", paddingBottom: "calc(var(--safe-bottom) + 24px)" }}
    >
      <header className="flex items-center justify-between gap-4">
        <button type="button" onClick={() => go(0)} className="flex items-center gap-3" aria-label="Retour à l'accueil">
          <Symbol className="h-8 text-midnight-blue" />
          <span className="font-serif text-base">Mosaic</span>
        </button>
        <Progress step={step} onPick={go} />
      </header>

      <main className="relative flex flex-1 flex-col overflow-x-clip pt-10 sm:pt-14">
        {pages.map((page, index) => {
          const current = index === step;
          return (
            <motion.section
              key={index}
              initial={false}
              animate={
                current
                  ? { opacity: 1, x: 0, filter: "blur(0px)", visibility: "visible" }
                  : { opacity: 0, x: index < step ? -48 : 48, filter: "blur(6px)", transitionEnd: { visibility: "hidden" } }
              }
              transition={{ duration: reduceMotion ? 0 : current ? 0.5 : 0.26, delay: current && !reduceMotion ? 0.08 : 0, ease: EASE }}
              // The step on show sets the height; the others lie over it,
              // out of sight and out of reach.
              className={cn("flex flex-col", current ? "relative flex-1" : "pointer-events-none absolute inset-x-0 top-10 sm:top-14")}
              aria-hidden={!current}
              inert={!current}
              aria-labelledby={`titre-${STEPS[index].id}`}
            >
              {page}
            </motion.section>
          );
        })}
      </main>

      <nav className="mt-10 flex items-center justify-between gap-3" aria-label="Étapes">
        <button
          type="button"
          onClick={() => go(step - 1)}
          className={cn(
            "inline-flex h-12 items-center gap-1 rounded-full px-4 text-base font-medium text-navy transition-opacity",
            step === 0 && "pointer-events-none opacity-0",
          )}
          tabIndex={step === 0 ? -1 : 0}
        >
          <Chevron left />
          Précédent
        </button>
        {next && (
          <button
            type="button"
            onClick={() => go(step + 1)}
            className="welcome-next inline-flex h-12 items-center gap-2 rounded-full bg-navy pr-5 pl-6 text-base font-medium text-on-accent"
          >
            {step === 0 ? "Commencer" : step === STEPS.length - 2 ? "Terminé" : `Suivant : ${next.label}`}
            <Chevron />
          </button>
        )}
      </nav>
    </div>
  );
}

function Progress({ step, onPick }: { step: number; onPick: (to: number) => void }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progression">
      {STEPS.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onPick(index)}
            aria-label={`${index + 1}. ${item.label}`}
            aria-current={index === step ? "step" : undefined}
            className="group flex h-8 items-center px-0.5"
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                index === step ? "w-8 bg-navy" : index < step ? "w-3 bg-navy/60" : "w-3 bg-[color:var(--hairline)]",
              )}
            />
          </button>
        </li>
      ))}
    </ol>
  );
}

function Heading({ id, eyebrow, title, children }: { id: string; eyebrow?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-[640px]">
      {eyebrow && <div className="mb-3">{eyebrow}</div>}
      <h1 id={`titre-${id}`} className="font-serif text-2xl sm:text-[36px] sm:leading-[1.15]">
        {title}
      </h1>
      {children && <div className="mt-4 text-base text-[color:var(--muted)]">{children}</div>}
    </div>
  );
}

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="text-xs font-medium tracking-[0.08em] text-[color:var(--muted)] uppercase">{children}</p>
);

function Intro() {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <Heading
        id="bienvenue"
        eyebrow={
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white-smoke px-3 text-xs font-medium text-navy">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            Temps estimé : 15 min
          </span>
        }
        title="La solution pour enrichir votre CRM est prête"
      >
        <p>
          Dans les prochaines pages, vous retrouverez un guide détaillé pour installer les différentes solutions et
          commencer à en profiter.
        </p>
      </Heading>
      <ol className="mt-10 grid gap-3 sm:grid-cols-2">
        {[
          ["L'application", "Dictée vocale et réunions Read AI, depuis votre téléphone."],
          ["Outlook", "Classez un e-mail dans Notion en un clic."],
        ].map(([title, text], index) => (
          <li key={title} className="rounded-2xl bg-white-smoke p-5">
            <p className="flex items-baseline gap-2.5 text-base font-medium">
              <span className="font-serif text-xl text-navy">{index + 1}</span>
              {title}
            </p>
            <p className="mt-1 text-base text-[color:var(--muted)]">{text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AppStep({ active, load }: { active: boolean; load: boolean }) {
  // The QR code is for a computer's screen (a mouse, a wide window); on a
  // phone or a tablet, a button that opens the app there.
  const desktop = useMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)");
  return (
    <div>
      <Heading id="application" eyebrow={<Eyebrow>Étape 1 sur 2</Eyebrow>} title="L'application sur votre téléphone" />
      <div className={cn("mt-8 grid items-start gap-6", desktop && "lg:grid-cols-[minmax(0,1fr)_260px]")}>
        <Video video={VIDEO_APP} active={active} load={load} />
        {desktop ? (
          <div className="flex flex-col items-center gap-4">
            {/* Dark on light in both themes: scanned inverted, a code fails on some cameras. */}
            <div className="w-full max-w-[260px] rounded-3xl bg-[color:var(--qr-paper)] p-5 shadow-[0_0_0_1px_var(--hairline)]">
              <LogoQr value={APP_URL} className="w-full" />
            </div>
            <CopyButton value={APP_URL} label="Copier le lien" className="w-full max-w-[260px]" />
          </div>
        ) : (
          <LinkButton href={APP_URL}>Ouvrir l'application</LinkButton>
        )}
      </div>
    </div>
  );
}

function OutlookStep({ active, load }: { active: boolean; load: boolean }) {
  return (
    <div>
      <Heading id="outlook" eyebrow={<Eyebrow>Étape 2 sur 2</Eyebrow>} title="Le complément Outlook" />
      <div className="mt-8">
        <Video video={VIDEO_OUTLOOK} active={active} load={load} />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <CopyButton value={MANIFEST_URL} label="Copier l'URL du manifeste" />
        <LinkButton href={ADMIN_URL}>Ouvrir Microsoft 365 Admin</LinkButton>
      </div>
    </div>
  );
}

function BookingStep() {
  return (
    <div className="flex flex-1 flex-col">
      <Heading id="rendez-vous" title="Prenons rendez-vous">
        <p>Choisissez un créneau : nous vérifierons ensemble que tout fonctionne et répondrons à vos questions.</p>
      </Heading>
      {BOOKING_EMBED ? (
        <div className="mt-8 overflow-hidden rounded-3xl bg-white shadow-[0_0_0_1px_var(--hairline)]">
          <iframe src={BOOKING_EMBED} title="Prendre rendez-vous" className="block h-[720px] w-full" loading="lazy" />
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center rounded-3xl bg-white-smoke px-6 py-12 text-center sm:py-16">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy text-on-accent">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
              <path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" />
            </svg>
          </span>
          <p className="mt-6 font-serif text-xl">Notre agenda</p>
          <p className="mt-2 max-w-[420px] text-base text-[color:var(--muted)]">
            Les créneaux disponibles s'ouvrent dans un nouvel onglet. La réservation prend moins d'une minute.
          </p>
          <a
            href={BOOKING_URL}
            target="_blank"
            rel="noreferrer"
            className="welcome-next mt-8 inline-flex h-14 items-center gap-2 rounded-2xl bg-navy px-7 text-base font-medium text-on-accent"
          >
            Choisir un créneau
            <External />
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * A Tella player, mounted as soon as `load` holds — a step ahead of its own —
 * and kept, so it is ready when its step comes. Loaded on show it plays at
 * once; loaded ahead it waits for a click, since a hidden player that starts
 * on its own would be heard over the step on show. Leaving the step reloads
 * it (from the cache): the player has no pause to call from outside, and a
 * video still playing out of sight would be heard too.
 */
function Video({ video, active, load }: { video: VideoSource; active: boolean; load: boolean }) {
  const [src, setSrc] = useState<string | null>(() => (load ? embed(video, active) : null));
  const [generation, setGeneration] = useState(0);
  const shown = useRef(active);
  useEffect(() => {
    if (load && src === null) setSrc(embed(video, active));
  }, [load, src, video, active]);
  useEffect(() => {
    if (active) shown.current = true;
    else if (shown.current) {
      shown.current = false;
      setSrc(embed(video, false));
      setGeneration((n) => n + 1);
    }
  }, [active, video]);

  return (
    <div
      className="w-full overflow-hidden rounded-3xl bg-white-smoke shadow-[0_0_0_1px_var(--hairline)]"
      style={{ aspectRatio: `${video.width} / ${video.height}` }}
    >
      {src && (
        <iframe
          key={`${generation}-${src}`}
          src={src}
          title={video.title}
          className="block h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
          allowFullScreen
        />
      )}
    </div>
  );
}

const BUTTON =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-medium transition-colors duration-300";

function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn(BUTTON, "welcome-next bg-navy text-on-accent")}>
      {children}
      <External />
    </a>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page the clipboard API refuses: the selection way.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}

function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    setState((await copy(value)) ? "done" : "failed");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={value}
      className={cn(
        BUTTON,
        "overflow-hidden",
        state === "done" ? "bg-navy text-on-accent" : "bg-white-smoke text-navy",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 10, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(2px)" }}
          transition={{ duration: 0.22, ease: EASE }}
          className="inline-flex items-center gap-2"
        >
          {state === "done" ? (
            <>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              Copié
            </>
          ) : state === "failed" ? (
            "Copie impossible"
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
                <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
              </svg>
              {label}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

function External() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 5h5v5M19 5l-8 8M17 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>,
);
