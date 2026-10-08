import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Symbol } from "@/components/logo";
import { PrimaryButton, Screen, TextButton } from "@/components/screen";
import { OtpInput, otpSuccessDuration, type OtpStatus } from "@/components/ui/otp-input";
import { ApiError, requestCode, verifyCode, type Session } from "@/lib/api";

// Two steps: the address, then the six digit code sent to it. The answer to
// the first step is the same whether the address is allowed or not — the
// screen never tells who is on the list.

// The step change glides like a page: out to one side, in from the other,
// with a light blur, on the app's page easing. Forward goes left, back goes
// right.
const EASE = [0.22, 1, 0.36, 1] as const;
const STEP = {
  enter: (dir: number) => ({ opacity: 0, x: 32 * dir, filter: "blur(4px)" }),
  center: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: 0.42, ease: EASE },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: -32 * dir,
    filter: "blur(4px)",
    transition: { duration: 0.24, ease: EASE },
  }),
};

export function AccessGate({ onValid }: { onValid: (session: Session) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<OtpStatus>("idle");
  const reduceMotion = useReducedMotion();
  const dir = step === "code" ? 1 : -1;
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);

  const clearError = () => {
    setMessage("");
    setStatus("idle");
    wrap.current?.classList.remove("is-error");
    field.current?.classList.remove("is-error");
  };

  // transitions.dev 12, error state shake. The code slots shake on their own.
  const showError = (text: string) => {
    setMessage(text);
    wrap.current?.classList.add("is-error");
    const f = field.current;
    if (!f) return;
    f.classList.add("is-error");
    f.classList.remove("is-shaking");
    void f.offsetWidth;
    f.classList.add("is-shaking");
    setTimeout(() => f.classList.remove("is-shaking"), 300);
  };

  const sendCode = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      await requestCode(email);
      clearError();
      setCode("");
      setStep("code");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    try {
      const session = await verifyCode(email, value);
      // The ring draws around every slot before the app takes over.
      setStatus("success");
      await new Promise((resolve) => setTimeout(resolve, otpSuccessDuration()));
      onValid(session);
    } catch (error) {
      setStatus("error");
      showError(
        error instanceof ApiError && error.status === 401 ? "Code incorrect ou expiré." : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void (step === "email" ? sendCode() : check());
  };

  return (
    <Screen className="relative mx-auto max-w-[480px] justify-center">
      <motion.div className="mx-auto" layout={!reduceMotion} transition={{ duration: 0.42, ease: EASE }}>
        <Symbol className="mx-auto h-16 text-midnight-blue" />
      </motion.div>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={step}
          layout={!reduceMotion}
          custom={dir}
          variants={STEP}
          initial={reduceMotion ? false : "enter"}
          animate="center"
          exit={reduceMotion ? undefined : "exit"}
        >
          {step === "email" ? (
            <h1 className="mt-12 text-center font-serif text-2xl">Qui se connecte ?</h1>
          ) : (
            <>
              <h1 className="mt-12 font-serif text-2xl">Quel est votre code de connexion ?</h1>
              <p className="mt-2 text-base text-[color:var(--muted)]">
                Si {email.trim().toLowerCase()} est autorisé, un code valable 10 minutes a été envoyé par mail.
              </p>
            </>
          )}
          <form onSubmit={submit} className="mt-8">
            <div ref={wrap} className="t-input-wrap">
              {step === "email" ? (
                <div
                  ref={field}
                  className="t-input rounded-2xl border-2 border-transparent bg-white-smoke [&.is-error]:border-midnight-blue"
                >
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    aria-label="Adresse e-mail professionnelle"
                    placeholder="prenom@mosaicfin.com"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      clearError();
                    }}
                    className="h-14 w-full rounded-2xl bg-transparent px-4 text-base outline-none placeholder:text-[color:var(--muted)]"
                  />
                </div>
              ) : (
                <OtpInput
                  autoFocus
                  value={code}
                  status={status}
                  role="group"
                  aria-label="Code à six chiffres"
                  fluid
                  onChange={(digits) => {
                    setCode(digits);
                    clearError();
                  }}
                  // iOS fills the code from the mail in one go: check it at once.
                  onComplete={(digits) => void check(digits)}
                />
              )}
              <p className={`t-error-msg mt-2 text-xs ${step === "code" ? "text-center" : ""}`} role="alert">
                {message}
              </p>
            </div>
            <PrimaryButton
              type="submit"
              disabled={busy || (step === "email" ? !email.trim() : code.length !== 6)}
              className="mt-4"
            >
              {step === "email" ? (busy ? "Envoi" : "Recevoir un code") : busy ? "Vérification" : "Se connecter"}
            </PrimaryButton>
          </form>
          {step === "code" && (
            <div className="mt-2 flex justify-between">
              <TextButton
                onClick={() => {
                  clearError();
                  setStep("email");
                }}
                className="-ml-3"
              >
                Changer d'adresse
              </TextButton>
              <TextButton onClick={() => void sendCode()} disabled={busy} className="-mr-3">
                Renvoyer le code
              </TextButton>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Screen>
  );
}
