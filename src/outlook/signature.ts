// What a sender's own signature says about them: their phone numbers, the
// company line, the postal address, the website.
//
// Read by rules, not by a model, and only from what is written: nothing here
// guesses a number or a company that is not on the page. The text is the
// sender's own part of each message (`uniqueBody`, then `unique()` cut the
// quotes), so a number found in a message belongs to the person who sent that
// message — never to everyone in the thread.
//
// The mail text is data from outside. It is matched against patterns and
// copied into form fields the user reviews; it is never interpreted.
//
// Pure, with no alias import, so scripts/test-outlook.mjs can run it under Node.

export type PhoneLabel = "mobile" | "direct" | "standard" | "fixe" | null;

export type SignaturePhone = {
  /** "+33123456789": the key two spellings of one number share. */
  e164: string;
  /** "+33" */
  dial: string;
  /** The subscriber digits, trunk zero dropped: "123456789". */
  national: string;
  /** What the signature called it, when it said. Never inferred from the digits. */
  label: PhoneLabel;
};

export type Signature = {
  phones: SignaturePhone[];
  /** Lines that may name the company: what is left once name, phones, mails, links and address are set aside. */
  lines: string[];
  /** A line carrying a legal form (SAS, Ltd, GmbH…): the only company name ever proposed for creation. */
  legalName: string | null;
  address: string | null;
  website: string | null;
};

// ---- The block -------------------------------------------------------------

/** The words a signature starts after. FR and EN, the desk's two languages. */
const SIGN_OFF =
  /^(?:bien\s+)?(?:cordialement|cdlt|amicalement|bien\s+[àa]\s+(?:vous|toi)|bonne\s+(?:journ[ée]e|soir[ée]e|fin\s+de\s+journ[ée]e)|salutations(?:\s+distingu[ée]es)?|best(?:\s+regards)?|kind\s+regards|warm\s+regards|regards|sincerely|merci(?:\s+(?:beaucoup|encore))?|thanks|thank\s+you)\b[\s,.!]*$/i;

/** How far up from the end a signature reaches when nothing marks its start. */
const TAIL = 10;
/** A signature longer than this is a message with a number in it. */
const MAX_LINES = 18;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * The lines of the signature: what follows the last sign-off, or the last few
 * lines when the sender wrote none.
 */
export function signatureBlock(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let start = -1;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    if (SIGN_OFF.test(lines[at])) {
      start = at + 1;
      break;
    }
  }
  const block = start >= 0 ? lines.slice(start) : lines.slice(-TAIL);
  return block.slice(0, MAX_LINES);
}

// ---- Phones ----------------------------------------------------------------

/** Dial codes, longest first so "+352" is not read as "+35". */
const DIALS = [
  "352", "377", "351", "353", "358", "354", "420", "421", "385", "386", "381", "372", "371", "370", "357", "356",
  "355", "387", "389", "382", "380", "373", "375", "972", "971", "966", "974", "965", "973", "968", "962", "961",
  "212", "213", "216", "218", "221", "225", "223", "226", "227", "228", "229", "224", "237", "241", "242", "243",
  "261", "230", "234", "233", "254", "598", "507", "852",
  "33", "41", "32", "49", "43", "39", "34", "31", "44", "45", "46", "47", "48", "36", "40", "30", "90", "20",
  "27", "52", "55", "54", "56", "57", "51", "86", "65", "81", "82", "91", "92", "66", "84", "62", "60", "63",
  "61", "64", "7", "1",
];

/** Subscriber lengths we can vouch for; anything else is kept only if plausible (7 to 12 digits). */
const LENGTHS: Record<string, number> = { "33": 9, "41": 9, "32": 9, "352": 9, "377": 8 };

// A run that starts like a phone number: "+33", "0033", or a French "0X".
// Separators are spaces, dots, dashes, and "(0)" after a country code.
const CANDIDATE = /(?:\+|00)\s?\d{1,3}(?:[\s.\-]?\(0\))?(?:[\s.\-]?\d){6,13}|\b0[1-9](?:[\s.\-]?\d{2}){4}\b/g;

const LABELS: [RegExp, PhoneLabel][] = [
  [/\b(?:mobile|mob|portable|port(?=\.)|gsm|cell(?:ular)?|cellphone)\b|^m\s*[:.]?\s*(?=[+(\d])/i, "mobile"],
  [/\b(?:ligne\s+directe|direct(?:e)?|dir|ld)\b|^d\s*[:.]?\s*(?=[+(\d])/i, "direct"],
  [/\b(?:standard|accueil|switchboard|reception)\b|^s\s*[:.]?\s*(?=[+(\d])/i, "standard"],
  [/\b(?:t[ée]l[ée]phone|t[ée]l|tel|phone|office|bureau|fixe|landline)\b|^[tp]\s*[:.]?\s*(?=[+(\d])/i, "fixe"],
];

const FAX = /\bfax\b|^f\s*[:.]?\s*(?=[+(\d])/i;

/** Digits only, the leading + kept as such. */
function canonical(raw: string): { dial: string; national: string } | null {
  let digits = raw.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    // A national French number: 0 + nine digits.
    if (/^0[1-9]\d{8}$/.test(digits)) return { dial: "33", national: digits.slice(1) };
    return null;
  }
  const rest = digits.slice(1);
  const dial = DIALS.find((code) => rest.startsWith(code));
  if (!dial) return null;
  let national = rest.slice(dial.length);
  // "+33 06…" written by hand: the trunk zero has no place after the code.
  if (national.startsWith("0") && (LENGTHS[dial] ?? 0) + 1 === national.length) national = national.slice(1);
  const expected = LENGTHS[dial];
  if (expected ? national.length !== expected : national.length < 7 || national.length > 12) return null;
  return { dial, national };
}

/**
 * Every phone number written in the lines, once each.
 *
 * A fax is not a number to call: a line labelled fax is skipped. A French
 * 01–05 is kept like any other, and is never called a switchboard unless the
 * signature says so.
 */
export function phonesIn(lines: string[]): SignaturePhone[] {
  const found = new Map<string, SignaturePhone>();
  const labelOf = (text: string) => LABELS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  for (const line of lines) {
    const matches = [...line.matchAll(CANDIDATE)];
    let from = 0;
    for (const match of matches) {
      // What is written just before this number names it: "Mobile 06… / Fixe 01…"
      // labels each one. A line with one number may name it anywhere.
      const before = line.slice(from, match.index).replace(/^[\s/|,;·•-]+/, "").trim();
      from = (match.index ?? 0) + match[0].length;
      if (FAX.test(before) || (matches.length === 1 && FAX.test(line) && !labelOf(before))) continue;
      const label = labelOf(before) ?? (matches.length === 1 ? labelOf(line) : null);
      const number = canonical(match[0]);
      if (!number) continue;
      const e164 = `+${number.dial}${number.national}`;
      const held = found.get(e164);
      if (held) {
        if (!held.label && label) held.label = label;
        continue;
      }
      found.set(e164, { e164, dial: `+${number.dial}`, national: number.national, label });
    }
  }
  return [...found.values()];
}

/** The key two spellings of one stored number share, or null when it is not a number we can read. */
export function phoneKey(raw: string, defaultDial = "33"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const number = canonical(trimmed) ?? (/^[1-9]\d{8}$/.test(trimmed.replace(/\D/g, "")) ? { dial: defaultDial, national: trimmed.replace(/\D/g, "") } : null);
  return number ? `+${number.dial}${number.national}` : null;
}

// ---- Address, website, legal name -------------------------------------------

const STREET = /^\d{1,4}\s*(?:bis|ter)?\s*,?\s*(?:rue|avenue|av\.?|boulevard|bd|place|pl\.?|quai|all[ée]e|chemin|ch\.|route|rte|impasse|cours|square|rond-point|esplanade|parvis|passage|voie|street|st\.?|road|rd\.?)\b/i;
const POSTCODE_FR = /\b\d{5}\s+[A-ZÀ-ÖØ-Þ][\p{L}'’\- ]+/u;
const POSTCODE_CH = /\b(?:CH-)?\d{4}\s+[A-ZÀ-ÖØ-Þ][\p{L}'’\- ]+/u;

const URL = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:\/\S*)?/i;
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i;

/** Legal forms, as whole words: they make a line a company name, not a role. */
export const LEGAL_FORMS = [
  "sas", "sasu", "sa", "sarl", "eurl", "snc", "sci", "scs", "sca", "se", "sel", "selarl", "scp", "gie",
  "ltd", "limited", "llc", "llp", "lp", "inc", "corp", "plc", "gmbh", "ag", "sarl", "sàrl", "bv", "nv", "spa", "srl",
];
const LEGAL = new RegExp(`(?:^|[\\s,(])(?:${LEGAL_FORMS.map((form) => form.replace(/\./g, "\\.")).join("|")}|s\\.a\\.s\\.?|s\\.a\\.r\\.l\\.?|s\\.a\\.)(?=$|[\\s,).])`, "i");

/** The postal address: a street line and the postcode line, or one line holding both. */
export function addressIn(lines: string[]): string | null {
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    const french = POSTCODE_FR.test(line);
    const swiss = !french && POSTCODE_CH.test(line);
    if (!french && !swiss) continue;
    if (STREET.test(line)) return line.replace(/\s+/g, " ");
    const previous = lines[at - 1];
    if (previous && STREET.test(previous)) return `${previous}, ${line}`.replace(/\s+/g, " ");
    // A Swiss four-digit code alone could be a year or anything else.
    if (french) return line.replace(/\s+/g, " ");
  }
  return null;
}

const isPhoneLine = (line: string) => phonesIn([line]).length > 0 && line.replace(CANDIDATE, "").replace(/[^\p{L}]/gu, "").length < 14;

/**
 * Reads one sender's signature. `name` is the sender's display name: lines
 * that are just the person are set aside, so a company is never read off a
 * person's own name.
 */
export function readSignature(text: string, name = ""): Signature {
  const block = signatureBlock(text);
  const phones = phonesIn(block);
  const address = addressIn(block);
  const nameKey = fold(name).replace(/[^\p{L}]/gu, "");
  const nameTokens = fold(name).split(/[^\p{L}]+/u).filter((token) => token.length > 1);

  let website: string | null = null;
  const lines: string[] = [];
  for (const line of block) {
    if (SIGN_OFF.test(line)) continue;
    if (EMAIL.test(line)) continue;
    const url = line.match(URL);
    if (url && /^(?:https?:\/\/|www\.)/i.test(line.trim()) && !line.includes(" ")) {
      website ??= url[1].toLowerCase();
      continue;
    }
    if (isPhoneLine(line)) continue;
    if (address && address.includes(line)) continue;
    const key = fold(line).replace(/[^\p{L}]/gu, "");
    if (nameKey && key === nameKey) continue;
    // The person's name in any order: "DUPONT Jean".
    const words = fold(line).split(/[^\p{L}]+/u).filter(Boolean);
    if (nameTokens.length && words.length === nameTokens.length && nameTokens.every((token) => words.includes(token))) continue;
    lines.push(line);
  }

  const legalName = lines.find((line) => LEGAL.test(line) && line.length <= 80) ?? null;
  return { phones, lines, legalName, address, website };
}

// ---- The whole thread --------------------------------------------------------

type MessageLike = { from: { name: string; address: string }; text: string };

/**
 * One signature per external sender, gathered over every message they wrote
 * in the thread — not only the last one, since a signature can be cut short in
 * a quick reply. A number repeated in every message is kept once; the first
 * label given to it wins, a later one fills a missing label.
 */
export function signaturesOf(messages: MessageLike[], addresses: string[]): Map<string, Signature> {
  const wanted = new Set(addresses.map((address) => address.trim().toLowerCase()));
  const out = new Map<string, Signature>();
  for (const message of messages) {
    const address = message.from.address.trim().toLowerCase();
    if (!wanted.has(address)) continue;
    const read = readSignature(message.text, message.from.name);
    const held = out.get(address);
    if (!held) {
      out.set(address, read);
      continue;
    }
    for (const phone of read.phones) {
      const same = held.phones.find((one) => one.e164 === phone.e164);
      if (!same) held.phones.push(phone);
      else if (!same.label && phone.label) same.label = phone.label;
    }
    for (const line of read.lines) if (!held.lines.includes(line)) held.lines.push(line);
    held.legalName ??= read.legalName;
    held.address ??= read.address;
    held.website ??= read.website;
  }
  return out;
}
