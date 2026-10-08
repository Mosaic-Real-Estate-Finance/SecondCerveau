import { useEffect, useMemo, useRef, useState } from "react";
import { CountryPicker } from "@/components/country-picker";
import { PhoneNumberInput } from "@/components/phone-input";
import { CircleButton, PrimaryButton, TextButton } from "@/components/screen";
import { Sheet } from "@/components/sheet";
import {
  createCompany,
  createContact,
  fetchCompanies,
  type Company,
  type CompanyRef,
  type Contact,
  type NewContact,
} from "@/lib/api";
import { dialOf, fold } from "@/lib/phone";
import { cn } from "@/lib/utils";

type Phone = { country: string; number: string };

// A chip, from the pasted style: rounded outline, filled when on, with a short
// pop on the way in. The colours are the Mosaic ones.
function Chip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  const [pop, setPop] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        onToggle();
        setPop(true);
        setTimeout(() => setPop(false), 160);
      }}
      className={cn("chip", on && "on", pop && "pop")}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-12 w-full rounded-2xl bg-white-smoke px-4 text-base text-midnight-blue outline-none placeholder:text-[color:var(--muted)]";

const plusIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const asCompany = (ref: CompanyRef): Company => ({ id: ref.id, name: ref.name, type: "" });

export function ContactForm({
  typeOptions = [],
  initialName,
  onCancel,
  onCreated,
  email,
  companyChoices = [],
  submit: deliver,
}: {
  typeOptions: string[];
  initialName: string;
  onCancel: () => void;
  onCreated: (contact: Contact) => void;
  /** Shown, not editable: the address the contact is created for (« À valider »). */
  email?: string;
  /** Companies suggested by the address's domain; the first is preselected. */
  companyChoices?: CompanyRef[];
  /** Where the contact goes. By default the dictation's own route. */
  submit?: (contact: NewContact) => Promise<Contact>;
}) {
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState("");
  const [phones, setPhones] = useState<Phone[]>([{ country: "FR", number: "" }]);
  const [types, setTypes] = useState<string[]>([]);
  const [company, setCompany] = useState<Company | null>(companyChoices[0] ? asCompany(companyChoices[0]) : null);
  const [companyQuery, setCompanyQuery] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyTypes, setCompanyTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    void fetchCompanies()
      .then(({ companies = [], typeOptions = [] }) => {
        setCompanies(companies);
        setCompanyTypes(typeOptions);
      })
      .catch(() => undefined);
  }, []);

  // Nothing is listed until something is typed: the point of the field is to
  // find one company, not to browse the base from inside a contact form.
  const matches = useMemo(() => {
    const needle = fold(companyQuery.trim());
    if (!needle) return [];
    return companies.filter((item) => fold(item.name).includes(needle)).slice(0, 6);
  }, [companies, companyQuery]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const draft: NewContact = {
        name: name.trim(),
        role: role.trim(),
        phones: phones
          .filter((phone) => phone.number.trim())
          .map((phone) => ({ ...phone, dial: dialOf(phone.country) })),
        types,
        companyId: company?.id,
      };
      onCreated(deliver ? await deliver(draft) : (await createContact(draft)).contact);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between pb-4">
        <h2 className="font-serif text-xl">Nouveau contact</h2>
        <TextButton onClick={onCancel} className="-mr-3">
          Annuler
        </TextButton>
      </div>

      {/* The one scroller of the panel: the header and the submit button stay
          put, and reaching the end does not drag the screen behind it. */}
      <div className="morph-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-4 px-1 pb-4">
        <Field label="Nom complet">
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoCapitalize="words"
            className={inputClass}
            placeholder="Prénom Nom"
          />
        </Field>

        {email && (
          <Field label="Email">
            <input value={email} readOnly className={cn(inputClass, "text-[color:var(--muted)]")} />
          </Field>
        )}

        <Field label="Fonction">
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className={inputClass}
            placeholder="Directeur financier"
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted)]">Téléphone</span>
          <div className="flex flex-col gap-2">
            {phones.map((phone, index) => (
              <div key={index} className="flex items-center gap-2">
                <CountryPicker
                  value={phone.country}
                  label={`Indicatif du numéro ${index + 1}`}
                  onChange={(code) =>
                    setPhones((list) => list.map((item, i) => (i === index ? { ...item, country: code } : item)))
                  }
                />
                <PhoneNumberInput
                  country={phone.country}
                  value={phone.number}
                  label={`Numéro ${index + 1}`}
                  className="flex-1"
                  onChange={(value) =>
                    setPhones((list) => list.map((item, i) => (i === index ? { ...item, number: value } : item)))
                  }
                />
                {phones.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Retirer le numéro ${index + 1}`}
                    onClick={() => setPhones((list) => list.filter((_, i) => i !== index))}
                    className="flex h-12 w-7 shrink-0 items-center justify-center text-[color:var(--muted)]"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M7 7l10 10M17 7L7 17" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <TextButton onClick={() => setPhones((list) => [...list, { country: "FR", number: "" }])} className="-ml-3 mt-1">
            Ajouter un numéro
          </TextButton>
        </div>

        {typeOptions.length > 0 && (
          <div>
            <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted)]">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {typeOptions.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  on={types.includes(option)}
                  onToggle={() =>
                    setTypes((list) => (list.includes(option) ? list.filter((x) => x !== option) : [...list, option]))
                  }
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted)]">Société</span>
          {companyChoices.length > 1 && (
            // Several companies share the domain (a holding and its
            // subsidiary): each is one tap away, and the user picks.
            <div className="mb-2 flex flex-wrap gap-1.5">
              {companyChoices.map((choice) => (
                <Chip
                  key={choice.id}
                  label={choice.name || "Société sans nom"}
                  on={company?.id === choice.id}
                  onToggle={() => setCompany(company?.id === choice.id ? null : asCompany(choice))}
                />
              ))}
            </div>
          )}
          {company ? (
            // Chosen: the rest of the base is out of the way.
            <div className="flex min-h-12 items-center justify-between gap-2 rounded-2xl bg-white-smoke px-4">
              <span className="truncate text-base">{company.name}</span>
              <TextButton onClick={() => setCompany(null)} className="-mr-3 shrink-0">
                Changer
              </TextButton>
            </div>
          ) : (
            <>
              {/* Two columns: the search, and the button that opens the
                  creation form in a sheet, the same way the contact one does. */}
              <div className="flex items-center gap-2">
                <input
                  value={companyQuery}
                  onChange={(event) => setCompanyQuery(event.target.value)}
                  className={cn(inputClass, "min-w-0 flex-1")}
                  placeholder="Rechercher une société"
                  aria-label="Rechercher une société"
                />
                <CircleButton
                  onClick={() => setCreatingCompany(true)}
                  aria-label="Créer une société"
                  aria-expanded={creatingCompany}
                >
                  {plusIcon}
                </CircleButton>
                {/* Over the contact sheet, as a second sheet. */}
                <Sheet
                  open={creatingCompany}
                  onClose={() => setCreatingCompany(false)}
                  label="Nouvelle société"
                  level={1}
                  full
                >
                  <CompanyForm
                    typeOptions={companyTypes}
                    initialName={companyQuery.trim()}
                    onCancel={() => setCreatingCompany(false)}
                    onCreated={(created) => {
                      setCreatingCompany(false);
                      setCompanies((list) => [created, ...list]);
                      setCompany(created);
                      setCompanyQuery("");
                    }}
                  />
                </Sheet>
              </div>
              {matches.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {matches.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setCompany(item)}
                        className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-base hover:bg-white-smoke"
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {error && (
          <p className="text-xs" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 pt-2">
        <PrimaryButton type="submit" disabled={busy || !name.trim()}>
          {busy ? "Création" : "Créer le contact"}
        </PrimaryButton>
      </div>
    </form>
  );
}

function CompanyForm({
  typeOptions = [],
  initialName,
  onCancel,
  onCreated,
}: {
  typeOptions: string[];
  initialName: string;
  onCancel: () => void;
  onCreated: (company: Company) => void;
}) {
  const [fields, setFields] = useState({
    name: initialName,
    description: "",
    site: "",
    type: "",
    address: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = async () => {
    if (!fields.name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      onCreated(await createCompany({ ...fields, name: fields.name.trim() }));
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  // A form inside a form: the button submits this one by hand, and Enter is
  // caught so it never reaches the contact form underneath.
  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex shrink-0 items-center justify-between pb-4">
        <h2 className="font-serif text-xl">Nouvelle société</h2>
        <TextButton onClick={onCancel} className="-mr-3">
          Annuler
        </TextButton>
      </div>

      <div className="morph-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-4 px-1 pb-4">
        <Field label="Désignation">
          <input ref={nameRef} value={fields.name} onChange={set("name")} className={inputClass} placeholder="Nom de la société" />
        </Field>
        <Field label="Description">
          <input value={fields.description} onChange={set("description")} className={inputClass} placeholder="Activité, spécialité" />
        </Field>
        <Field label="Site internet">
          <input
            value={fields.site}
            onChange={set("site")}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            className={inputClass}
            placeholder="exemple.fr"
          />
        </Field>
        <Field label="Adresse">
          <input value={fields.address} onChange={set("address")} className={inputClass} placeholder="Rue, code postal, ville" />
        </Field>
        {typeOptions.length > 0 && (
          <div>
            <span className="mb-1.5 block text-xs font-medium text-[color:var(--muted)]">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {typeOptions.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  on={fields.type === option}
                  onToggle={() =>
                    setFields((current) => ({ ...current, type: current.type === option ? "" : option }))
                  }
                />
              ))}
            </div>
          </div>
        )}
        {error && (
          <p className="text-xs" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 pt-2">
        <PrimaryButton onClick={submit} disabled={busy || !fields.name.trim()}>
          {busy ? "Création" : "Créer la société"}
        </PrimaryButton>
      </div>
    </div>
  );
}
