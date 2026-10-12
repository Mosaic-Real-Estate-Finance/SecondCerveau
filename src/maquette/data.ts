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
  /** What the case shows, above the card. */
  label: string;
  title: string;
  when: string;
  organizer: string;
  summary: string;
  people: Person[];
  /** A colleague's recording already made the note: only people are left to add. */
  noteExists?: boolean;
  /** The report could not be processed. */
  failed?: string;
};

const SUMMARY =
  "Point sur le financement de l'opération : calendrier des appels de fonds, garanties demandées par la banque et prochaine visite du site.";

export const MEETINGS: Meeting[] = [
  {
    id: "one-unknown",
    label: "Une personne inconnue, deux contacts connus",
    title: "Financement — Résidence Les Tilleuls",
    when: "Mar. 14 oct. · 14h30",
    organizer: "Oscar Baron",
    summary: SUMMARY,
    people: [
      { name: "Marie Durand", email: "marie.durand@kandbaz.fr", known: false, company: "Kandbaz" },
      { name: "Jean Martin", email: "j.martin@ca-paris.fr", known: true },
      { name: "Sophie Leroy", email: "sophie@leroy-patrimoine.fr", known: true },
    ],
  },
  {
    id: "probable",
    label: "Plusieurs inconnus, dont un contact probable (même nom, autre adresse)",
    title: "Comité d'investissement Nexity",
    when: "Mer. 15 oct. · 10h00",
    organizer: "Philippe Bernieri",
    summary: SUMMARY,
    people: [
      {
        name: "Lucas Bernard",
        email: "lucas.bernard@gmail.com",
        known: false,
        candidate: { name: "Lucas Bernard", company: "Nexity" },
      },
      { name: "Camille Petit", email: "c.petit@nexity.fr", known: false, company: "Nexity" },
      { name: "Paul Girard", email: "paul.girard@nexity.fr", known: true },
    ],
  },
  {
    id: "all-unknown",
    label: "Personne n'est dans Notion",
    title: "Premier échange — Groupe Altarea",
    when: "Jeu. 16 oct. · 16h15",
    organizer: "Jean-Philippe Deltour",
    summary: SUMMARY,
    people: [
      { name: "Hugo Lambert", email: "h.lambert@altarea.com", known: false, company: "Altarea" },
      { name: "Inès Moreau", email: "ines.moreau@altarea.com", known: false, company: "Altarea" },
      { name: "Nadia Benali", email: "nadia@benali-conseil.fr", known: false },
    ],
  },
  {
    id: "note-exists",
    label: "La note existe déjà (enregistrée par un collègue) : il reste une personne",
    title: "Visite de chantier — Bordeaux Euratlantique",
    when: "Ven. 17 oct. · 09h00",
    organizer: "Oscar Baron",
    summary: SUMMARY,
    noteExists: true,
    people: [
      { name: "Thomas Roux", email: "thomas.roux@bouygues-immo.fr", known: false, company: "Bouygues Immobilier" },
      { name: "Claire Fontaine", email: "c.fontaine@bnpparibas.com", known: true },
    ],
  },
  {
    id: "failed",
    label: "Le rapport n'a pas pu être traité",
    title: "Point hebdo — Promoteurs",
    when: "Ven. 17 oct. · 11h30",
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

export const TYPES = ["Promoteur", "Banque", "Investisseur", "Notaire", "Conseil"];
