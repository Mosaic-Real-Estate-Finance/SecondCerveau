import { useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { PrimaryButton, Screen, TextButton } from "@/components/screen";
import { OtpInput, otpSuccessDuration, type OtpStatus } from "@/components/ui/otp-input";
import { ApiError, requestCode, verifyCode, type Session } from "@/lib/api";

// Two steps: the address, then the six digit code sent to it. The answer to
// the first step is the same whether the address is allowed or not — the
// screen never tells who is on the list.

export function AccessGate({ onValid }: { onValid: (session: Session) => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<OtpStatus>("idle");
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
    <Screen className="mx-auto max-w-[480px] justify-center">
      <Logo className="h-24 text-midnight-blue" />
      {step === "email" ? (
        <>
          <h1 className="mt-12 font-serif text-2xl">Votre adresse</h1>
          <p className="mt-2 text-base text-[color:var(--muted)]">
            Un code de connexion vous y sera envoyé. Il n'est demandé qu'une fois sur cet appareil.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-12 font-serif text-2xl">Votre code</h1>
          <p className="mt-2 text-base text-[color:var(--muted)]">
            Si {email.trim().toLowerCase()} a accès à l'application, un code à six chiffres vient d'y être envoyé. Il
            est valable 10 minutes.
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
                className="h-14 w-full bg-transparent px-4 text-base outline-none placeholder:text-[color:var(--muted)]"
              />
            </div>
          ) : (
            <OtpInput
              autoFocus
              value={code}
              status={status}
              role="group"
              aria-label="Code à six chiffres"
              className="flex justify-center"
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
    </Screen>
  );
}
