import { useMemo, useState } from "react";
import { CountryPicker } from "@/components/country-picker";
import { PhoneNumberInput } from "@/components/phone-input";
import { COUNTRIES, fold, formatNational } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { Company } from "./api";
import { sameCompany } from "./company-match";
import type { PhoneLabel, SignaturePhone } from "./signature";

// The creation form for one unknown participant, inline in the panel.
//
// It is not `src/components/contact-form.tsx`. That one is a full-height
// screen with its own submit, bound to the dictation's route — which does not
// write the email column — and the panel needs something else: several drafts
// at once, one per unknown participant, in 320 px, submitted together with the
// note. Parameterising the dictation's form over its layout, its route and its
// multiplicity would have been a rewrite wearing the word "reuse", with the
// working form put at risk for nothing.
//
// What is shared is what travels well: the phone input, the country picker,
// and the field styles.
//
// What the sender's signature said (./signature) arrives prefilled and marked
// as such: the numbers, the company it names, the one it could be. All of it
// stays editable, and nothing is created unless the user asks.

export type DraftPhone = {
  country: string;
  number: string;
  /** What the signature called it; shown, never guessed. */
  label?: PhoneLabel;
  /** Read in the signature rather than typed. */
  read?: boolean;
};

/** What the signature said about the company. Shown, never sent. */
export type CompanyHint = {
  /** Preselected, because its name is written in the signature. */
  sureId: string | null;
  /** To confirm: close names, the website, the domain, or several at once. */
  maybe: Company[];
  /** A line with a legal form: the only name the creation is prefilled with. */
  name: string | null;
  address: string | null;
};

export type Draft = {
  name: string;
  email: string;
  role: string;
  phones: DraftPhone[];
  types: string[];
  companyId?: string;
  /** A company to create along with the contact (looked for again by the server first). */
  companyName?: string;
  companyAddress?: string;
  hint?: CompanyHint;
};

const blank = (): DraftPhone => ({ country: "FR", number: "" });

export const newDraft = (
  name: string,
  email: string,
  read: { phones?: DraftPhone[]; hint?: CompanyHint } = {},
): Draft => ({
  name,
  email,
  role: "",
  phones: read.phones?.length ? read.phones : [blank()],
  types: [],
  hint: read.hint,
  companyId: read.hint?.sureId ?? undefined,
});

/** A number read in a signature, in the form's terms; null when its country is not in the picker. */
export function draftPhone(phone: SignaturePhone): DraftPhone | null {
  // The first country with that code: the home countries come first, and +1
  // lands on the United States, which only decides the grouping.
  const country = COUNTRIES.find((one) => one.dial === phone.dial);
  if (!country) return null;
  return { country: country.code, number: formatNational(country.code, phone.national), label: phone.label, read: true };
}

export const LABEL_TEXT: Record<NonNullable<PhoneLabel>, string> = {
  mobile: "Mobile",
  direct: "Ligne directe",
  standard: "Standard",
  fixe: "Fixe",
};

/** A draft the panel may send. The two columns that make a contact findable again. */
export const draftReady = (draft: Draft) => Boolean(draft.name.trim() && draft.email.trim());

const input = "h-11 w-full rounded-xl bg-white px-3 text-midnight-blue outline-none";
const quiet = "shrink-0 text-2xs underline text-[color:var(--muted)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-2xs font-medium text-[color:var(--muted)]">{label}</span>
      {children}
    </div>
  );
}

export function ParticipantForm({
  draft,
  onChange,
  companies,
  typeOptions,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  companies: Company[];
  typeOptions: string[];
}) {
  const [query, setQuery] = useState("");
  // The creation, opened on demand: name and address, both editable.
  const [creating, setCreating] = useState<{ name: string; address: string } | null>(null);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  // Nothing is listed until something is typed: the field is there to find one
  // company, not to browse the base from inside a panel 320 px wide.
  const matches = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle || draft.companyId) return [];
    return companies.filter((company) => fold(company.name).includes(needle)).slice(0, 4);
  }, [companies, query, draft.companyId]);

  const chosen = draft.companyId
    ? (companies.find((company) => company.id === draft.companyId)?.name ?? draft.companyName ?? "")
    : "";
  const fromSignature = Boolean(draft.companyId && draft.hint?.sureId === draft.companyId);
  const suggestions = (draft.hint?.maybe ?? []).filter((company) => company.id !== draft.companyId);
  const duplicate = creating ? sameCompany(creating.name, companies) : null;

  const setPhone = (index: number, patch: Partial<DraftPhone>) =>
    set({ phones: draft.phones.map((phone, at) => (at === index ? { ...phone, ...patch } : phone)) });
  const removePhone = (index: number) => {
    const rest = draft.phones.filter((_, at) => at !== index);
    set({ phones: rest.length ? rest : [blank()] });
  };

  const openCreation = (name: string) =>
    setCreating({ name: name || draft.hint?.name || "", address: draft.hint?.address ?? "" });

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-white-smoke/70 p-3">
      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-[color:var(--muted)]">Quel est le nom complet ?</span>
        <input
          className={input}
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Prénom Nom"
          autoComplete="off"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-[color:var(--muted)]">Adresse mail</span>
        <input
          className={input}
          type="email"
          value={draft.email}
          onChange={(event) => set({ email: event.target.value })}
          autoComplete="off"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-2xs font-medium text-[color:var(--muted)]">Fonction</span>
        <input
          className={input}
          value={draft.role}
          onChange={(event) => set({ role: event.target.value })}
          placeholder="Facultatif"
          autoComplete="off"
        />
      </label>

      <Field label={draft.phones.length > 1 ? "Téléphones" : "Téléphone"}>
        <div className="flex flex-col gap-2">
          {draft.phones.map((phone, index) => (
            <div key={index}>
              <div className="flex gap-2">
                <CountryPicker
                  value={phone.country}
                  onChange={(country) => setPhone(index, { country })}
                  label="Indicatif du pays"
                />
                <PhoneNumberInput
                  country={phone.country}
                  value={phone.number}
                  onChange={(number) => setPhone(index, { number })}
                  label="Numéro de téléphone"
                  className={cn(input, "flex-1")}
                />
                {(draft.phones.length > 1 || phone.number) && (
                  <button
                    type="button"
                    className="shrink-0 px-1 text-lg leading-none text-[color:var(--muted)]"
                    aria-label="Retirer ce numéro"
                    onClick={() => removePhone(index)}
                  >
                    ×
                  </button>
                )}
              </div>
              {phone.read && (
                <p className="mt-0.5 text-2xs text-[color:var(--muted)]">
                  {[phone.label && LABEL_TEXT[phone.label], "lu dans la signature"].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          ))}
          <button type="button" className={cn(quiet, "self-start")} onClick={() => set({ phones: [...draft.phones, blank()] })}>
            Ajouter un numéro
          </button>
        </div>
      </Field>

      <Field label="Société">
        {chosen ? (
          <div className="rounded-xl bg-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{chosen}</span>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setQuery("");
                  set({ companyId: undefined, companyName: undefined, companyAddress: undefined });
                }}
              >
                Changer
              </button>
            </div>
            {fromSignature && <p className="mt-0.5 text-2xs text-[color:var(--muted)]">Reconnue dans la signature</p>}
          </div>
        ) : draft.companyName ? (
          <div className="rounded-xl bg-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{draft.companyName}</span>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setCreating({ name: draft.companyName ?? "", address: draft.companyAddress ?? "" });
                  set({ companyName: undefined, companyAddress: undefined });
                }}
              >
                Modifier
              </button>
            </div>
            <p className="mt-0.5 text-2xs text-[color:var(--muted)]">
              {["Nouvelle société, créée à l'envoi", draft.companyAddress].filter(Boolean).join(" · ")}
            </p>
          </div>
        ) : creating ? (
          <div className="flex flex-col gap-2 rounded-xl bg-white p-2.5">
            <label className="block">
              <span className="mb-1 block text-2xs text-[color:var(--muted)]">Nom de la société</span>
              <input
                className={cn(input, "bg-white-smoke")}
                value={creating.name}
                onChange={(event) => setCreating({ ...creating, name: event.target.value })}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs text-[color:var(--muted)]">Adresse</span>
              <input
                className={cn(input, "bg-white-smoke")}
                value={creating.address}
                onChange={(event) => setCreating({ ...creating, address: event.target.value })}
                placeholder="Facultatif"
                autoComplete="off"
              />
            </label>
            {duplicate && (
              <div className="flex items-center justify-between gap-2 text-2xs">
                <span className="text-navy">« {duplicate.name} » existe déjà.</span>
                <button
                  type="button"
                  className={quiet}
                  onClick={() => {
                    setCreating(null);
                    set({ companyId: duplicate.id, companyName: duplicate.name, companyAddress: undefined });
                  }}
                >
                  La choisir
                </button>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" className={quiet} onClick={() => setCreating(null)}>
                Annuler
              </button>
              <button
                type="button"
                disabled={!creating.name.trim() || Boolean(duplicate)}
                className="rounded-full bg-navy px-3 py-1.5 text-2xs text-on-accent disabled:opacity-40"
                onClick={() => {
                  set({
                    companyId: undefined,
                    companyName: creating.name.trim(),
                    companyAddress: creating.address.trim() || undefined,
                  });
                  setCreating(null);
                }}
              >
                Créer à l'envoi
              </button>
            </div>
          </div>
        ) : (
          <>
            {suggestions.length > 0 && !query.trim() && (
              <div className="mb-2">
                <p className="mb-1 text-2xs text-[color:var(--muted)]">
                  {suggestions.length > 1 ? "Peut-être l'une de ces sociétés :" : "Peut-être cette société :"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((company) => (
                    <button
                      key={company.id}
                      type="button"
                      className="chip"
                      onClick={() => set({ companyId: company.id, companyName: company.name })}
                    >
                      {company.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <input
              className={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher dans le CRM"
              aria-label="Rechercher une société"
              autoComplete="off"
            />
            {query.trim() && (
              <ul className="mt-1 flex flex-col gap-1">
                {matches.map((company) => (
                  <li key={company.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded-lg bg-white px-3 py-2 text-left"
                      onClick={() => set({ companyId: company.id, companyName: company.name })}
                    >
                      {company.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className={cn(quiet, "mt-2 block text-navy")}
              onClick={() => openCreation(query.trim())}
            >
              {query.trim() && !matches.some((company) => fold(company.name) === fold(query.trim()))
                ? `Créer « ${query.trim()} »`
                : "Créer une société"}
            </button>
          </>
        )}
      </Field>

      {typeOptions.length > 0 && (
        <Field label="Type">
          <div className="flex flex-wrap gap-1.5">
            {typeOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={draft.types.includes(option)}
                className={cn("chip", draft.types.includes(option) && "on")}
                onClick={() =>
                  set({
                    types: draft.types.includes(option)
                      ? draft.types.filter((kept) => kept !== option)
                      : [...draft.types, option],
                  })
                }
              >
                {option}
              </button>
            ))}
          </div>
        </Field>
      )}

      {!draftReady(draft) && (
        <p className="text-2xs text-[color:var(--muted)]">Le nom et l'adresse mail sont nécessaires.</p>
      )}
    </div>
  );
}
