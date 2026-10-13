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
const VIDEO_PWA =
  "https://www.tella.tv/video/vid_cmv5tsxhm002t05kw486u5vvo/embed?b=0&title=0&a=1&loop=0&t=0&muted=0&wt=0&o=1";
// The Outlook walkthrough is still to be recorded: null shows a placeholder.
const VIDEO_OUTLOOK: string | null = null;
const BOOKING_URL = "https://calendar.notion.so/meet/gouman/m4a54ybp";
// Notion Calendar only lets notion.com frame its booking pages
// (frame-ancestors), so here the page opens in a new tab. A booking tool that
// allows embedding (Cal.com, Calendly…) goes here and shows in the page.
const BOOKING_EMBED: string | null = null;

const STEPS = [
  { id: "bienvenue", label: "Bienvenue" },
  { id: "application", label: "Application" },
  { id: "outlook", label: "Outlook" },
  { id: "rendez-vous", label: "Rendez-vous" },
] as const;

// The step change glides like a page — out to one side, in from the other,
// with a light blur — on the app's page easing (as the sign-in screen does).
const EASE = [0.22, 1, 0.36, 1] as const;
const STEP = {
  enter: (dir: number) => ({ opacity: 0, x: 48 * dir, filter: "blur(6px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: -48 * dir, filter: "blur(6px)", transition: { duration: 0.26, ease: EASE } }),
};

const fromHash = () => {
  const index = STEPS.findIndex((step) => `#${step.id}` === location.hash);
  return index === -1 ? 0 : index;
};

function Welcome() {
  const [[step, dir], setStep] = useState<[number, number]>(() => [fromHash(), 1]);
  const reduceMotion = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);

  const go = useCallback((to: number) => {
    if (to < 0 || to >= STEPS.length) return;
    setStep(([from]) => (to === from ? [from, 1] : [to, to > from ? 1 : -1]));
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

  const last = step === STEPS.length - 1;

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

      <main className="relative flex flex-1 flex-col pt-10 sm:pt-14">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.section
            key={step}
            custom={dir}
            variants={STEP}
            initial={reduceMotion ? false : "enter"}
            animate="center"
            exit={reduceMotion ? undefined : "exit"}
            className="flex flex-1 flex-col"
            aria-labelledby={`titre-${STEPS[step].id}`}
          >
            {step === 0 && <Intro />}
            {step === 1 && <AppStep />}
            {step === 2 && <OutlookStep />}
            {step === 3 && <BookingStep />}
          </motion.section>
        </AnimatePresence>
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
        {!last && (
          <button
            type="button"
            onClick={() => go(step + 1)}
            className="welcome-next inline-flex h-12 items-center gap-2 rounded-full bg-navy pr-5 pl-6 text-base font-medium text-on-accent"
          >
            {step === 0 ? "Commencer" : `Suivant : ${STEPS[step + 1].label}`}
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

function Heading({ id, eyebrow, title, children }: { id: string; eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-[640px]">
      {eyebrow && <p className="mb-3 text-xs font-medium tracking-[0.08em] text-[color:var(--muted)] uppercase">{eyebrow}</p>}
      <h1 id={`titre-${id}`} className="font-serif text-2xl sm:text-[36px] sm:leading-[1.15]">
        {title}
      </h1>
      {children && <div className="mt-4 text-base text-[color:var(--muted)]">{children}</div>}
    </div>
  );
}

function Intro() {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <Symbol className="welcome-float h-16 text-midnight-blue sm:h-20" />
      <div className="mt-10">
        <Heading id="bienvenue" title="Bienvenue chez Mosaic">
          <p>
            Nous avons construit pour vous des outils qui envoient vos notes, vos réunions et vos échanges directement
            dans votre espace Notion, sans ressaisie.
          </p>
          <p className="mt-3">
            En quelques minutes, nous allons voir ensemble comment les installer et comment vous en servir au quotidien.
          </p>
        </Heading>
      </div>
      <ol className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          ["L'application", "Dictée vocale et réunions Read AI, depuis votre téléphone."],
          ["Outlook", "Classez un e-mail dans Notion en un clic."],
          ["Un rendez-vous", "Pour faire le point ensemble."],
        ].map(([title, text], index) => (
          <li key={title} className="rounded-2xl bg-white-smoke p-5">
            <span className="font-serif text-xl text-navy">{index + 1}</span>
            <p className="mt-2 text-base font-medium">{title}</p>
            <p className="mt-1 text-base text-[color:var(--muted)]">{text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AppStep() {
  return (
    <div>
      <Heading id="application" eyebrow="Étape 1 sur 3" title="L'application sur votre téléphone">
        <p>
          Dictez une note après un rendez-vous, validez les réunions enregistrées par Read AI : tout part dans Notion.
          La vidéo vous montre l'installation et l'usage, de bout en bout.
        </p>
      </Heading>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Video src={VIDEO_PWA} title="Installer et utiliser l'application Mosaic" />
        <div className="flex flex-col items-center rounded-3xl bg-white-smoke p-6 text-center">
          <LogoQr value={APP_URL} className="w-full max-w-[240px]" />
          <p className="mt-5 text-base font-medium">Scannez avec votre téléphone</p>
          <p className="mt-1 text-base text-[color:var(--muted)]">
            Ouvrez l'appareil photo et visez le code : la page de connexion s'ouvre.
          </p>
          <CopyField value={APP_URL} label="Copier le lien" className="mt-5 w-full" />
        </div>
      </div>
    </div>
  );
}

function OutlookStep() {
  return (
    <div>
      <Heading id="outlook" eyebrow="Étape 2 sur 3" title="Le complément Outlook">
        <p>
          Il ajoute un bouton « Save to Notion » à Outlook pour classer un e-mail et ses pièces jointes dans Notion,
          rattachés aux bons contacts. Un administrateur Microsoft 365 l'installe une fois pour toute l'équipe.
        </p>
      </Heading>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {VIDEO_OUTLOOK ? (
          <Video src={VIDEO_OUTLOOK} title="Installer le complément Outlook" />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center rounded-3xl bg-white-smoke p-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-white)] text-navy shadow-[0_0_0_1px_var(--hairline)]">
              <svg viewBox="0 0 24 24" className="ml-0.5 h-6 w-6" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" />
              </svg>
            </span>
            <p className="mt-4 text-base font-medium">Vidéo bientôt disponible</p>
            <p className="mt-1 text-base text-[color:var(--muted)]">En attendant, les étapes ci-contre suffisent.</p>
          </div>
        )}
        <ol className="flex flex-col gap-3">
          <Instruction n={1} title="Copiez l'adresse du manifeste">
            <CopyField value={MANIFEST_URL} label="Copier l'URL du manifeste" className="mt-3" />
          </Instruction>
          <Instruction n={2} title="Ouvrez le centre d'administration">
            <p className="mt-1 text-base text-[color:var(--muted)]">
              Paramètres › Applications intégrées, puis « Charger des applications personnalisées ».
            </p>
            <a
              href={ADMIN_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-navy px-4 text-base font-medium text-on-accent"
            >
              Ouvrir Microsoft 365 Admin
              <External />
            </a>
          </Instruction>
          <Instruction n={3} title="Collez l'adresse et déployez">
            <p className="mt-1 text-base text-[color:var(--muted)]">
              Choisissez « Fournir un lien vers le fichier manifeste », collez l'adresse, puis attribuez le complément
              aux utilisateurs concernés. Il apparaît dans Outlook sous quelques heures.
            </p>
          </Instruction>
        </ol>
      </div>
    </div>
  );
}

function BookingStep() {
  return (
    <div className="flex flex-1 flex-col">
      <Heading id="rendez-vous" eyebrow="Étape 3 sur 3" title="Prenons rendez-vous">
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

function Video({ src, title }: { src: string; title: string }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-3xl bg-white-smoke shadow-[0_0_0_1px_var(--hairline)]">
      <iframe
        src={src}
        title={title}
        className="block h-full w-full"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
      />
    </div>
  );
}

function Instruction({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="rounded-2xl bg-white-smoke p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-on-accent">
          {n}
        </span>
        <p className="text-base font-medium">{title}</p>
      </div>
      {children}
    </li>
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

function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async () => {
    setState((await copy(value)) ? "done" : "failed");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2200);
  };

  return (
    <div className={cn("flex items-center gap-2 rounded-2xl bg-[color:var(--color-white)] p-1.5 pl-4 shadow-[0_0_0_1px_var(--hairline)]", className)}>
      <span className="min-w-0 flex-1 truncate text-left text-xs text-[color:var(--muted)] select-all" title={value}>
        {value.replace(/^https:\/\//, "")}
      </span>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={label}
        className={cn(
          "relative inline-flex h-10 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-xl px-3.5 text-xs font-semibold transition-colors duration-300",
          state === "done" ? "bg-navy text-on-accent" : "bg-white-smoke text-navy",
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
            transition={{ duration: 0.22, ease: EASE }}
            className="inline-flex items-center gap-1.5"
          >
            {state === "done" ? (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                Copié
              </>
            ) : state === "failed" ? (
              "Sélectionnez le lien"
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
                  <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
                </svg>
                Copier
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
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
