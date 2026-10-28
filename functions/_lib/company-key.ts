// The key two spellings of one company name share: case, accents, spacing,
// punctuation and legal form set aside. "Foncière Lumen SAS", "FONCIERE
// LUMEN" and "Foncière-Lumen" are one company.
//
// Mirrored by src/outlook/company-match.ts, which cannot import this file
// (the panel and the functions are built apart). This copy decides whether a
// company is created; that one only decides what the panel suggests.

const LEGAL_FORMS = new Set([
  "sas", "sasu", "sa", "sarl", "eurl", "snc", "sci", "scs", "sca", "se", "sel", "selarl", "scp", "gie",
  "ltd", "limited", "llc", "llp", "lp", "inc", "corp", "plc", "gmbh", "ag", "bv", "nv", "spa", "srl",
]);

const fold = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const companyKey = (name: string) => fold(name).replace(/[^a-z0-9]/g, "");

export const coreKey = (name: string) =>
  fold(name)
    .replace(/[.]/g, "")
    .split(/[^a-z0-9&]+/)
    .filter((word) => word && !LEGAL_FORMS.has(word.replace(/[^a-z0-9]/g, "")))
    .join("")
    .replace(/[^a-z0-9]/g, "");

/** The id of the company this name would duplicate, if any. */
export function sameCompany(name: string, companies: Map<string, string>): { id: string; name: string } | null {
  const key = companyKey(name);
  const core = coreKey(name);
  if (!key) return null;
  for (const [id, held] of companies) {
    if (companyKey(held) === key || (core && coreKey(held) === core)) return { id, name: held };
  }
  return null;
}
