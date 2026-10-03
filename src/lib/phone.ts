// Country dial codes, and the way each country groups the digits of a
// national number.
//
// The groups describe the SUBSCRIBER number, trunk zero excluded: a leading
// zero the user types is kept and joined to the first group, so a French
// number reads "6 12 34 56 78" typed bare and "06 12 34 56 78" typed with the
// zero, from one pattern.
//
// Names are resolved by the platform so they match the spelling of the
// language and never go stale; the ISO code is the fallback.

type Row = [code: string, dial: string, groups?: number[]];

const DEFAULT_GROUPS = [3, 3, 3, 3];

// The desk's own countries first, in the order it deals with them; the rest
// are sorted by name below.
const HOME: Row[] = [
  ["FR", "+33", [1, 2, 2, 2, 2]],
  ["CH", "+41", [2, 3, 2, 2]],
  ["BE", "+32", [3, 2, 2, 2]],
  ["LU", "+352", [3, 3, 3]],
  ["MC", "+377", [2, 2, 2, 2]],
];

const REST: Row[] = [
  ["DE", "+49", [3, 4, 4]],
  ["AT", "+43", [3, 4, 4]],
  ["IT", "+39", [3, 3, 4]],
  ["ES", "+34", [3, 3, 3]],
  ["PT", "+351", [3, 3, 3]],
  ["NL", "+31", [1, 4, 4]],
  ["GB", "+44", [4, 3, 3]],
  ["IE", "+353", [2, 3, 4]],
  ["DK", "+45", [2, 2, 2, 2]],
  ["SE", "+46", [2, 3, 2, 2]],
  ["NO", "+47", [3, 2, 3]],
  ["FI", "+358", [2, 3, 4]],
  ["IS", "+354", [3, 4]],
  ["PL", "+48", [3, 3, 3]],
  ["CZ", "+420", [3, 3, 3]],
  ["SK", "+421", [3, 3, 3]],
  ["HU", "+36", [2, 3, 4]],
  ["RO", "+40", [3, 3, 3]],
  ["BG", "+359", [3, 3, 3]],
  ["GR", "+30", [3, 3, 4]],
  ["HR", "+385", [2, 3, 4]],
  ["SI", "+386", [2, 3, 3]],
  ["RS", "+381", [2, 3, 4]],
  ["EE", "+372", [4, 4]],
  ["LV", "+371", [4, 4]],
  ["LT", "+370", [3, 2, 3]],
  ["CY", "+357", [2, 6]],
  ["MT", "+356", [4, 4]],
  ["AL", "+355", [2, 3, 4]],
  ["BA", "+387", [2, 3, 3]],
  ["MK", "+389", [2, 3, 3]],
  ["ME", "+382", [2, 3, 3]],
  ["UA", "+380", [2, 3, 2, 2]],
  ["MD", "+373", [2, 3, 3]],
  ["BY", "+375", [2, 3, 2, 2]],
  ["RU", "+7", [3, 3, 2, 2]],
  ["TR", "+90", [3, 3, 2, 2]],
  ["IL", "+972", [2, 3, 4]],
  ["AE", "+971", [2, 3, 4]],
  ["SA", "+966", [2, 3, 4]],
  ["QA", "+974", [4, 4]],
  ["KW", "+965", [4, 4]],
  ["BH", "+973", [4, 4]],
  ["OM", "+968", [4, 4]],
  ["JO", "+962", [1, 4, 4]],
  ["LB", "+961", [2, 3, 3]],
  ["EG", "+20", [2, 4, 4]],
  ["MA", "+212", [3, 3, 3]],
  ["DZ", "+213", [3, 2, 2, 2]],
  ["TN", "+216", [2, 3, 3]],
  ["LY", "+218", [2, 3, 4]],
  ["SN", "+221", [2, 3, 2, 2]],
  ["CI", "+225", [2, 2, 2, 2, 2]],
  ["ML", "+223", [2, 2, 2, 2]],
  ["BF", "+226", [2, 2, 2, 2]],
  ["NE", "+227", [2, 2, 2, 2]],
  ["TG", "+228", [2, 2, 2, 2]],
  ["BJ", "+229", [2, 2, 2, 2]],
  ["GN", "+224", [3, 2, 2, 2]],
  ["CM", "+237", [1, 2, 2, 2, 2]],
  ["GA", "+241", [1, 2, 2, 2]],
  ["CG", "+242", [2, 3, 4]],
  ["CD", "+243", [3, 3, 3]],
  ["MG", "+261", [2, 2, 3, 2]],
  ["MU", "+230", [4, 4]],
  ["ZA", "+27", [2, 3, 4]],
  ["NG", "+234", [3, 3, 4]],
  ["GH", "+233", [2, 3, 4]],
  ["KE", "+254", [3, 3, 3]],
  ["US", "+1", [3, 3, 4]],
  ["CA", "+1", [3, 3, 4]],
  ["MX", "+52", [2, 4, 4]],
  ["BR", "+55", [2, 5, 4]],
  ["AR", "+54", [2, 4, 4]],
  ["CL", "+56", [1, 4, 4]],
  ["CO", "+57", [3, 3, 4]],
  ["PE", "+51", [3, 3, 3]],
  ["UY", "+598", [2, 3, 3]],
  ["PA", "+507", [4, 4]],
  ["CN", "+86", [3, 4, 4]],
  ["HK", "+852", [4, 4]],
  ["SG", "+65", [4, 4]],
  ["JP", "+81", [2, 4, 4]],
  ["KR", "+82", [2, 4, 4]],
  ["IN", "+91", [5, 5]],
  ["PK", "+92", [3, 7]],
  ["TH", "+66", [1, 4, 4]],
  ["VN", "+84", [2, 4, 3]],
  ["ID", "+62", [3, 4, 4]],
  ["MY", "+60", [2, 4, 4]],
  ["PH", "+63", [3, 3, 4]],
  ["AU", "+61", [3, 3, 3]],
  ["NZ", "+64", [2, 3, 4]],
];

export type Country = { code: string; dial: string; name: string; groups: number[] };

// Intl.DisplayNames is the platform's own list, so the spelling matches the
// rest of iOS; a browser without it falls back to the ISO code.
const names = (() => {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" });
  } catch {
    return null;
  }
})();

const toCountry = ([code, dial, groups]: Row): Country => ({
  code,
  dial,
  name: names?.of(code) ?? code,
  groups: groups ?? DEFAULT_GROUPS,
});

export const COUNTRIES: Country[] = [
  ...HOME.map(toCountry),
  ...REST.map(toCountry).sort((a, b) => a.name.localeCompare(b.name, "fr")),
];

const byCode = new Map(COUNTRIES.map((country) => [country.code, country]));

export const countryOf = (code: string) => byCode.get(code) ?? COUNTRIES[0];
export const dialOf = (code: string) => countryOf(code).dial;

// 🇫🇷 from "FR": the two regional indicator letters. A platform without the
// flags shows the two letters instead, which still reads.
export const flagOf = (code: string) =>
  String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));

// ---- Formatting -----------------------------------------------------------

export const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * Groups the digits of a national number for one country.
 *
 * A number pasted in international form is brought back to national form
 * first, so "+33 6 12 34 56 78" and "0033612345678" both come out as
 * "6 12 34 56 78" under France.
 */
export function formatNational(code: string, value: string): string {
  const country = countryOf(code);
  let digits = digitsOf(value);
  if (!digits) return "";

  // 00 33 … and 33 … , when what follows is the length of a subscriber number.
  const prefix = country.dial.slice(1);
  const total = country.groups.reduce((sum, size) => sum + size, 0);
  if (digits.startsWith(`00${prefix}`)) digits = digits.slice(2 + prefix.length);
  else if (digits.startsWith(prefix) && digits.length === prefix.length + total) digits = digits.slice(prefix.length);

  const trunk = digits.startsWith("0");
  const body = trunk ? digits.slice(1) : digits;
  if (!body) return "0";

  const parts: string[] = [];
  let at = 0;
  for (const size of country.groups) {
    if (at >= body.length) break;
    parts.push(body.slice(at, at + size));
    at += size;
  }
  // Longer than the pattern (a number we have no rule for): keep chunking at
  // the size of its last group rather than running the rest together.
  const last = country.groups[country.groups.length - 1];
  while (at < body.length) {
    parts.push(body.slice(at, at + last));
    at += last;
  }
  if (trunk) parts[0] = `0${parts[0]}`;
  return parts.join(" ");
}

/**
 * Where the caret belongs after reformatting: the same number of digits from
 * the start as before, so editing in the middle of a number does not throw
 * the caret to the end.
 */
export function caretAfter(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let at = 0; at < formatted.length; at++) {
    if (/\d/.test(formatted[at])) {
      seen++;
      if (seen === digitsBefore) return at + 1;
    }
  }
  return formatted.length;
}

// Accent and case insensitive, so "coree" finds "Corée".
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Matches on the country name or on the dial code, with or without its +. */
export function matchCountry(country: Country, query: string): boolean {
  const needle = query.trim();
  if (!needle) return true;
  if (fold(country.name).includes(fold(needle))) return true;
  const digits = digitsOf(needle);
  return digits.length > 0 && country.dial.slice(1).startsWith(digits);
}
