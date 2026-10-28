// Which company of the CRM a signature points at.
//
// The CRM is searched first, and only with what the signature itself says: the
// lines left once the person's name, phones and address are set aside, the
// website, the domain of the sender's address. Never the person's name.
//
// Two levels of confidence, and only the first acts on its own:
//   - "sure": one company, and one only, whose name is written in the
//     signature (case, accents, spacing, punctuation and legal form aside).
//     It is preselected; the user can still change it.
//   - "maybe": everything else — a name one or two letters off, a website or
//     a domain that reads like the name, or several companies at once. Shown as
//     suggestions to confirm, never chosen.
// Nothing is ever merged and nothing is ever created here.
//
// Pure, with no alias import, so scripts/test-outlook.mjs can run it under Node.

// With its extension: the test harness runs this file under Node, which does
// not guess one. Vite resolves it to the .ts all the same.
import { LEGAL_FORMS, type Signature } from "./signature.js";

export type CompanyLike = { id: string; name: string };

export type CompanyGuess<T extends CompanyLike = CompanyLike> = {
  /** Preselected: exactly one company is named outright. */
  sure: T | null;
  /** To confirm by a tap. Never more than four. */
  maybe: T[];
};

/** Lower case, no accents, letters and digits only: "Société Générale, S.A." → "societegeneralesa". */
export const companyKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const words = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .split(/[^a-z0-9&]+/)
    .filter(Boolean);

const LEGAL = new Set(LEGAL_FORMS.map((form) => companyKey(form)));

/** The name without its legal form: "Foncière Lumen SAS" and "FONCIERE LUMEN" share "foncierelumen". */
export const coreKey = (name: string) =>
  words(name)
    .filter((word) => !LEGAL.has(companyKey(word)))
    .join("");

/** Free mail providers: their domain says nothing about anyone's company. Same list as functions/_lib/readai/match.ts. */
const GENERIC = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net", "bbox.fr", "gmx.fr", "gmx.com", "neuf.fr",
]);

/** "mail.lumen-partners.co.uk" → "lumenpartners"; null for a free mail provider. */
export function domainLabel(domainOrUrl: string): string | null {
  const host = domainOrUrl
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  if (!host || GENERIC.has(host)) return null;
  const parts = host.split(".");
  // Drop the public suffix: one part, or two for "co.uk", "com.au"…
  const suffix = parts.length > 2 && /^(?:co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]) ? 2 : 1;
  const label = parts.slice(0, -suffix).pop();
  return label ? companyKey(label) : null;
}

/** Edits between two short strings (Damerau, adjacent swaps count once). */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }
  return rows[a.length][b.length];
}

/** One letter off for a short name, two for a long one; nothing under five letters. */
const close = (a: string, b: string) => {
  if (a.length < 5 || b.length < 5) return false;
  return distance(a, b) <= (Math.min(a.length, b.length) >= 9 ? 2 : 1);
};

/** Whether `needle` appears in `line` as whole words, in order. */
function namedIn(line: string, company: CompanyLike) {
  const core = words(company.name).filter((word) => !LEGAL.has(companyKey(word)));
  if (!core.length) return false;
  const coreJoined = core.join("");
  // Too short to be told apart from an ordinary word ("Axa" is fine, "Le" is not).
  if (coreJoined.length < 3) return false;
  const lineWords = words(line);
  for (let at = 0; at + core.length <= lineWords.length; at += 1) {
    if (core.every((word, offset) => lineWords[at + offset] === word)) return true;
  }
  // Written without its spaces or with other punctuation: "Lumen-Partners".
  return coreJoined.length >= 4 && lineWords.some((word) => companyKey(word) === coreJoined);
}

/**
 * The companies a signature points at, from what it says and nothing else.
 * `email` is the sender's address: its domain is a hint, never proof.
 */
export function guessCompany<T extends CompanyLike>(
  signature: Pick<Signature, "lines" | "website">,
  email: string,
  companies: T[],
): CompanyGuess<T> {
  const named = new Set<T>();
  const hinted = new Set<T>();

  for (const line of signature.lines) {
    const lineKey = companyKey(line);
    const lineCore = coreKey(line);
    for (const company of companies) {
      const key = companyKey(company.name);
      const core = coreKey(company.name);
      if (!key) continue;
      if (lineKey === key || (core && lineCore === core) || namedIn(line, company)) named.add(company);
      else if (core && lineCore && close(lineCore, core)) hinted.add(company);
    }
  }

  const labels = [signature.website, email.split("@")[1]]
    .map((value) => (value ? domainLabel(value) : null))
    .filter((label): label is string => !!label && label.length >= 3);
  for (const label of labels) {
    for (const company of companies) {
      const core = coreKey(company.name);
      if (!core) continue;
      if (core === label || companyKey(company.name) === label || close(core, label)) hinted.add(company);
    }
  }

  const sure = named.size === 1 ? [...named][0] : null;
  const maybe = [...(sure ? [] : named), ...[...hinted].filter((company) => !named.has(company))].slice(0, 4);
  return { sure, maybe };
}

/**
 * The company a new name would duplicate, if any: same name once case,
 * accents, punctuation and legal form are set aside. Used before creating one.
 */
export function sameCompany<T extends CompanyLike>(name: string, companies: T[]): T | null {
  const key = companyKey(name);
  const core = coreKey(name);
  if (!key) return null;
  return companies.find((company) => companyKey(company.name) === key || (core && coreKey(company.name) === core)) ?? null;
}
