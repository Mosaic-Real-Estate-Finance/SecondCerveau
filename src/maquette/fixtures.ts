import type { Contact, PendingPerson, ReviewItem } from "@/lib/api";
import type { Note } from "@/lib/notes";

// Fictional notes and meetings, one per case the « Notifications » screen has
// to handle. Nothing here is real and nothing is sent anywhere.

/** A time of day, so many calendar days before today. */
function daysAgo(days: number, hours: number, minutes: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

const person = (fields: Partial<PendingPerson> & Pick<PendingPerson, "email" | "name">): PendingPerson => ({
  firstName: fields.name.split(" ")[0],
  lastName: fields.name.split(" ").slice(1).join(" "),
  companies: [],
  candidates: [],
  ...fields,
});

const meeting = (
  title: string,
  at: Date,
  owner: string,
  summary: string,
): ReviewItem["meeting"] => ({
  sessionId: title,
  title,
  start: at.toISOString(),
  end: null,
  owner: { name: owner, email: null },
  summary,
  reportUrl: null,
  turns: 12,
});

const item = (id: string, fields: Partial<ReviewItem> & Pick<ReviewItem, "meeting">): ReviewItem => ({
  id,
  key: id,
  kind: "new",
  status: "pending",
  createdAt: fields.meeting.start,
  authors: [],
  recognized: [],
  people: [],
  ...fields,
});

const SHORT =
  "Point sur le financement de l'opération : calendrier des appels de fonds, garanties demandées par la banque et prochaine visite du site.";

// Long enough to scroll under the summary's header.
const LONG = [
  "Le comité a passé en revue le dossier de financement de l'opération de 48 logements à Issy-les-Moulineaux, présenté par Nexity. Le prix de revient est arrêté à 14,2 M€, dont 3,1 M€ de foncier déjà acquis, pour un chiffre d'affaires prévisionnel de 17,8 M€.",
  "La banque confirme son accord de principe pour un crédit promoteur de 9,5 M€ sur 30 mois, sous réserve d'une pré-commercialisation de 40 % et d'une garantie financière d'achèvement. Lucas Bernard indique que la pré-commercialisation atteint 32 % à date.",
  "Camille Petit a présenté le calendrier des appels de fonds : 35 % à l'achèvement des fondations, 70 % à la mise hors d'eau, 95 % à l'achèvement.",
  "Points d'attention : le recours d'un riverain sur le permis de construire, purgé depuis trois semaines, et l'augmentation de 6 % du lot gros œuvre.",
  "Prochaines étapes : dossier technique sous huit jours, visite du site jeudi prochain, décision du comité à la séance du mois prochain.",
].join("\n\n");

export const items = (): ReviewItem[] => [
  // One unknown person, two known contacts.
  item("tilleuls", {
    meeting: meeting("Financement — Résidence Les Tilleuls", daysAgo(0, 14, 30), "Oscar Baron", SHORT),
    recognized: [
      { email: "j.martin@ca-paris.fr", id: "c-martin", name: "Jean Martin", company: "Crédit Agricole" },
      { email: "sophie@leroy-patrimoine.fr", id: "c-leroy", name: "Sophie Leroy", company: "Leroy Patrimoine" },
    ],
    people: [person({ email: "marie.durand@kandbaz.fr", name: "Marie Durand", companies: [{ id: "co-kandbaz", name: "Kandbaz" }] })],
  }),
  // Several unknowns, one of them already on a contact under this address.
  item("nexity", {
    meeting: meeting("Comité d'investissement Nexity", daysAgo(1, 10, 0), "Philippe Bernieri", LONG),
    recognized: [{ email: "paul.girard@nexity.fr", id: "c-girard", name: "Paul Girard", company: "Nexity" }],
    people: [
      person({
        email: "lucas.bernard@gmail.com",
        name: "Lucas Bernard",
        candidates: [{ id: "c-bernard", name: "Lucas Bernard", company: "Nexity" }],
      }),
      person({ email: "c.petit@nexity.fr", name: "Camille Petit", companies: [{ id: "co-nexity", name: "Nexity" }] }),
    ],
  }),
  // Nobody is in Notion.
  item("altarea", {
    meeting: meeting("Premier échange — Groupe Altarea", daysAgo(3, 16, 15), "Jean-Philippe Deltour", SHORT),
    people: [
      person({ email: "h.lambert@altarea.com", name: "Hugo Lambert", companies: [{ id: "co-altarea", name: "Altarea" }] }),
      person({ email: "ines.moreau@altarea.com", name: "Inès Moreau", companies: [{ id: "co-altarea", name: "Altarea" }] }),
      person({ email: "nadia@benali-conseil.fr", name: "Nadia Benali" }),
    ],
  }),
  // A colleague's recording already made the note: one person is left.
  item("euratlantique", {
    kind: "complete",
    noteUrl: "#",
    meeting: meeting("Visite de chantier — Bordeaux Euratlantique", daysAgo(12, 9, 0), "Oscar Baron", SHORT),
    recognized: [{ email: "c.fontaine@bnpparibas.com", id: "c-fontaine", name: "Claire Fontaine", company: "BNP Paribas" }],
    people: [
      person({
        email: "thomas.roux@bouygues-immo.fr",
        name: "Thomas Roux",
        companies: [{ id: "co-bouygues", name: "Bouygues Immobilier" }],
      }),
    ],
  }),
  // The report could not be processed.
  item("hebdo", {
    status: "error",
    stage: "process",
    error: "Notion n'a pas répondu",
    meeting: meeting("Point hebdo — Promoteurs", daysAgo(5, 11, 30), "Philippe Bernieri", ""),
  }),
];

const note = (id: string, fields: Partial<Note>): Note => ({
  id,
  createdAt: Date.now(),
  status: "transcribed",
  audio: new ArrayBuffer(0),
  mimeType: "audio/mp4",
  duration: 60,
  amplitudes: [],
  ...fields,
});

export const notes = (): Note[] => [
  note("sans-contact", {
    createdAt: Date.now() - 20 * 60_000,
    duration: 84,
    transcript:
      "Rappeler Sophie Leroy pour le dossier Bordeaux, elle attend la version signée du protocole avant vendredi. Lui envoyer aussi le planning des appels de fonds.",
  }),
  note("prete", {
    createdAt: daysAgo(2, 18, 5).getTime(),
    duration: 42,
    transcript: "Visite du site d'Issy avec la banque reportée à jeudi, prévenir Camille.",
    contact: { id: "c-martin", name: "Jean Martin", company: "Crédit Agricole" },
  }),
  note("envoi-echoue", {
    createdAt: daysAgo(4, 9, 40).getTime(),
    duration: 133,
    status: "send-failed",
    error: "Notion indisponible",
    transcript: "Compte rendu du rendez-vous avec Kandbaz : ils veulent une proposition avant la fin du mois.",
    contact: { id: "c-leroy", name: "Sophie Leroy", company: "Leroy Patrimoine" },
  }),
  note("transcription-echouee", {
    createdAt: daysAgo(9, 17, 20).getTime(),
    duration: 27,
    status: "transcription-failed",
    error: "connexion perdue pendant la transcription",
  }),
];

export const CONTACTS: Contact[] = [
  ["c-bernard", "Lucas Bernard", "Nexity"],
  ["c-martin", "Jean Martin", "Crédit Agricole"],
  ["c-leroy", "Sophie Leroy", "Leroy Patrimoine"],
  ["c-durand", "Marie-Anne Durand", "Crédit Agricole"],
  ["c-rousseau", "Thomas Rousseau", "Bouygues Immobilier"],
  ["c-petitjean", "Camille Petitjean", "Altarea"],
].map(([id, name, company]) => ({ id, name, company, role: "", types: [], phones: [], createdAt: "" }));

export const TYPES = ["Promoteur", "Banque", "Investisseur", "Notaire", "Conseil"];

export const COMPANIES = [
  { id: "co-kandbaz", name: "Kandbaz", type: "" },
  { id: "co-nexity", name: "Nexity", type: "" },
  { id: "co-altarea", name: "Altarea", type: "" },
  { id: "co-bouygues", name: "Bouygues Immobilier", type: "" },
];
