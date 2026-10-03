import { useMemo, useState } from "react";
import { CountryPicker } from "@/components/country-picker";
import { PhoneNumberInput } from "@/components/phone-input";
import { fold } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { Company } from "./api";

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

export type Draft = {
  name: string;
  email: string;
  role: string;
  phone: { country: string; number: string };
  types: string[];
  companyId?: string;
  companyName?: string;
};

export const newDraft = (name: string, email: string): Draft => ({
  name,
  email,
  role: "",
  phone: { country: "FR", number: "" },
  types: [],
});

/** A draft the panel may send. The two columns that make a contact findable again. */
export const draftReady = (draft: Draft) => Boolean(draft.name.trim() && draft.email.trim());

const input = "h-11 w-full rounded-xl bg-white px-3 text-sm text-midnight-blue outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-medium text-[color:var(--muted)]">{label}</span>
      {children}
    </label>
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
  const [query, setQuery] = useState(draft.companyName ?? "");
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

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl bg-white-smoke/70 p-3">
      <Field label="Nom complet">
        <input
          className={input}
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Prénom Nom"
          autoComplete="off"
        />
      </Field>

      <Field label="Adresse mail">
        <input
          className={input}
          type="email"
          value={draft.email}
          onChange={(event) => set({ email: event.target.value })}
          autoComplete="off"
        />
      </Field>

      <Field label="Fonction">
        <input
          className={input}
          value={draft.role}
          onChange={(event) => set({ role: event.target.value })}
          placeholder="Facultatif"
          autoComplete="off"
        />
      </Field>

      <Field label="Téléphone">
        <div className="flex gap-2">
          <CountryPicker
            value={draft.phone.country}
            onChange={(country) => set({ phone: { ...draft.phone, country } })}
            label="Indicatif du pays"
          />
          <PhoneNumberInput
            country={draft.phone.country}
            value={draft.phone.number}
            onChange={(number) => set({ phone: { ...draft.phone, number } })}
            label="Numéro de téléphone"
            className={cn(input, "flex-1")}
          />
        </div>
      </Field>

      <Field label="Société">
        {chosen ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5">
            <span className="truncate text-sm">{chosen}</span>
            <button
              type="button"
              className="shrink-0 text-2xs underline text-[color:var(--muted)]"
              onClick={() => {
                setQuery("");
                set({ companyId: undefined, companyName: undefined });
              }}
            >
              Changer
            </button>
          </div>
        ) : (
          <>
            <input
              className={input}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                set({ companyId: undefined, companyName: undefined });
              }}
              placeholder="Rechercher ou créer"
              autoComplete="off"
            />
            {query.trim() && (
              <ul className="mt-1 flex flex-col gap-1">
                {matches.map((company) => (
                  <li key={company.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded-lg bg-white px-3 py-2 text-left text-sm"
                      onClick={() => set({ companyId: company.id, companyName: company.name })}
                    >
                      {company.name}
                    </button>
                  </li>
                ))}
                {!matches.some((company) => fold(company.name) === fold(query.trim())) && (
                  <li>
                    <button
                      type="button"
                      className="w-full truncate rounded-lg bg-white px-3 py-2 text-left text-sm text-navy"
                      onClick={() => set({ companyId: undefined, companyName: query.trim() })}
                    >
                      Créer « {query.trim()} »
                    </button>
                  </li>
                )}
              </ul>
            )}
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
