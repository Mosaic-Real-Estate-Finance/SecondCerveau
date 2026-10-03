import { useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { PrimaryButton, Screen } from "@/components/screen";
import { ApiError, openSession, type Session } from "@/lib/api";

export function AccessGate({ onValid }: { onValid: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);

  // transitions.dev 12, error state shake.
  const showError = (text: string) => {
    setMessage(text);
    const w = wrap.current, f = field.current;
    if (!w || !f) return;
    w.classList.add("is-error");
    f.classList.add("is-error");
    f.classList.remove("is-shaking");
    void f.offsetWidth;
    f.classList.add("is-shaking");
    setTimeout(() => f.classList.remove("is-shaking"), 300);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      onValid(await openSession(email));
    } catch (error) {
      showError(
        error instanceof ApiError && error.status === 401
          ? "Cette adresse n'a pas accès à l'application."
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen className="mx-auto max-w-[480px] justify-center">
      <Logo className="h-24 text-midnight-blue" />
      <h1 className="mt-12 font-serif text-2xl">Votre adresse</h1>
      <p className="mt-2 text-base text-[color:var(--muted)]">
        Elle identifie l'auteur des notes envoyées dans Notion. Elle est demandée une seule fois sur cet appareil.
      </p>
      <form onSubmit={submit} className="mt-8">
        <div ref={wrap} className="t-input-wrap">
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
                wrap.current?.classList.remove("is-error");
                field.current?.classList.remove("is-error");
              }}
              className="h-14 w-full bg-transparent px-4 text-base outline-none placeholder:text-[color:var(--muted)]"
            />
          </div>
          <p className="t-error-msg mt-2 text-xs" role="alert">
            {message}
          </p>
        </div>
        <PrimaryButton type="submit" disabled={busy || !email.trim()} className="mt-4">
          {busy ? "Vérification" : "Continuer"}
        </PrimaryButton>
      </form>
    </Screen>
  );
}
