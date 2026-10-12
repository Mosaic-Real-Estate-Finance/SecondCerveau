// Fictional meetings, one per case the « Notifications » screen has to handle.
// Nothing here is real and nothing is sent anywhere.

export type Person = {
  name: string;
  email: string;
  /** In Notion already, under this address. */
  known: boolean;
  /** Guessed from the address, for a new contact. */
  company?: string;
  /** Someone of the same name already in Notion, under another address. */
  candidate?: { name: string; company: string };
};

export type Meeting = {
  id: string;
  title: string;
  /** When the meeting started. */
  at: Date;
  organizer: string;
  /** The summary Read AI wrote, as it sends it: paragraphs apart by a blank line. */
  summary: string;
  people: Person[];
  /** A colleague's recording already made the note: only people are left to add. */
  noteExists?: boolean;
  /** The report could not be processed. */
  failed?: string;
};

/** A time of day, so many calendar days before today. */
function daysAgo(days: number, hours: number, minutes: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

const SHORT =
  "Point sur le financement de l'opération : calendrier des appels de fonds, garanties demandées par la banque et prochaine visite du site.";

// Long enough to scroll under the summary's header.
const LONG = [
  "Le comité a passé en revue le dossier de financement de l'opération de 48 logements à Issy-les-Moulineaux, présenté par Nexity. Le prix de revient est arrêté à 14,2 M€, dont 3,1 M€ de foncier déjà acquis, pour un chiffre d'affaires prévisionnel de 17,8 M€.",
  "La banque confirme son accord de principe pour un crédit promoteur de 9,5 M€ sur 30 mois, sous réserve d'une pré-commercialisation de 40 % et d'une garantie financière d'achèvement. Lucas Bernard indique que la pré-commercialisation atteint 32 % à date, avec une dizaine de réservations attendues d'ici la fin du mois.",
  "Camille Petit a présenté le calendrier des appels de fonds : 35 % à l'achèvement des fondations, 70 % à la mise hors d'eau, 95 % à l'achèvement. Le premier appel est prévu pour la fin du premier trimestre.",
  "Points d'attention soulevés : le recours d'un riverain sur le permis de construire, purgé depuis trois semaines, et l'augmentation de 6 % du lot gros œuvre après la renégociation avec l'entreprise générale.",
  "Prochaines étapes : envoi du dossier technique complet par Nexity sous huit jours, visite du site jeudi prochain, et décision définitive du comité à la séance du mois prochain. Paul Girard se charge de la note de synthèse pour le comité.",
].join("\n\n");

export const MEETINGS: Meeting[] = [
  // One unknown person, two known contacts.
  {
    id: "one-unknown",
    title: "Financement — Résidence Les Tilleuls",
    at: daysAgo(0, 14, 30),
    organizer: "Oscar Baron",
    summary: SHORT,
    people: [
      {
        name: "Marie Durand",
        email: "marie.durand@kandbaz.fr",
        known: false,
        company: "Kandbaz",
      },
      { name: "Jean Martin", email: "j.martin@ca-paris.fr", known: true },
      {
        name: "Sophie Leroy",
        email: "sophie@leroy-patrimoine.fr",
        known: true,
      },
    ],
  },
  // Several unknowns, one of them probably a contact (same name, other address).
  {
    id: "probable",
    title: "Comité d'investissement Nexity",
    at: daysAgo(1, 10, 0),
    organizer: "Philippe Bernieri",
    summary: LONG,
    people: [
      {
        name: "Lucas Bernard",
        email: "lucas.bernard@gmail.com",
        known: false,
        candidate: { name: "Lucas Bernard", company: "Nexity" },
      },
      {
        name: "Camille Petit",
        email: "c.petit@nexity.fr",
        known: false,
        company: "Nexity",
      },
      { name: "Paul Girard", email: "paul.girard@nexity.fr", known: true },
    ],
  },
  // Nobody is in Notion.
  {
    id: "all-unknown",
    title: "Premier échange — Groupe Altarea",
    at: daysAgo(3, 16, 15),
    organizer: "Jean-Philippe Deltour",
    summary: SHORT,
    people: [
      {
        name: "Hugo Lambert",
        email: "h.lambert@altarea.com",
        known: false,
        company: "Altarea",
      },
      {
        name: "Inès Moreau",
        email: "ines.moreau@altarea.com",
        known: false,
        company: "Altarea",
      },
      { name: "Nadia Benali", email: "nadia@benali-conseil.fr", known: false },
    ],
  },
  // A colleague's recording already made the note: one person is left.
  {
    id: "note-exists",
    title: "Visite de chantier — Bordeaux Euratlantique",
    at: daysAgo(12, 9, 0),
    organizer: "Oscar Baron",
    summary: SHORT,
    noteExists: true,
    people: [
      {
        name: "Thomas Roux",
        email: "thomas.roux@bouygues-immo.fr",
        known: false,
        company: "Bouygues Immobilier",
      },
      {
        name: "Claire Fontaine",
        email: "c.fontaine@bnpparibas.com",
        known: true,
      },
    ],
  },
  // The report could not be processed.
  {
    id: "failed",
    title: "Point hebdo — Promoteurs",
    at: daysAgo(5, 11, 30),
    organizer: "Philippe Bernieri",
    summary: "",
    failed: "Notion n'a pas répondu à temps.",
    people: [],
  },
];

/** The contacts of the « existing contact » picker. */
export const CONTACTS = [
  { name: "Lucas Bernard", company: "Nexity" },
  { name: "Marie-Anne Durand", company: "Crédit Agricole" },
  { name: "Thomas Rousseau", company: "Bouygues Immobilier" },
  { name: "Camille Petitjean", company: "Altarea" },
  { name: "Hugo Lambert-Roy", company: "Icade" },
  { name: "Inès Morel", company: "Kaufman & Broad" },
];

export const TYPES = [
  "Promoteur",
  "Banque",
  "Investisseur",
  "Notaire",
  "Conseil",
];
