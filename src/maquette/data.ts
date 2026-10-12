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

export type Line = { speaker: string; at: string; text: string };

export type Meeting = {
  id: string;
  title: string;
  when: string;
  organizer: string;
  transcript: Line[];
  people: Person[];
  /** A colleague's recording already made the note: only people are left to add. */
  noteExists?: boolean;
  /** The report could not be processed. */
  failed?: string;
};

const TRANSCRIPT: Line[] = [
  { speaker: "Oscar Baron", at: "00:00", text: "Merci à tous d'être là. L'idée aujourd'hui, c'est de caler le calendrier des appels de fonds avant la fin du mois." },
  { speaker: "Marie Durand", at: "00:42", text: "De notre côté, le premier appel peut partir dès la signature de l'acte, le second à la mise hors d'eau." },
  { speaker: "Jean Martin", at: "01:15", text: "La banque demandera une garantie d'achèvement, et une caution personnelle du promoteur au-delà de huit millions." },
  { speaker: "Oscar Baron", at: "02:03", text: "Entendu. On peut prévoir la visite du site la semaine prochaine pour avancer sur les garanties\u00a0?" },
  { speaker: "Sophie Leroy", at: "02:31", text: "Jeudi matin me va. J'enverrai le dossier technique la veille pour que chacun puisse le lire avant." },
];

export const MEETINGS: Meeting[] = [
  // One unknown person, two known contacts.
  {
    id: "one-unknown",
    title: "Financement — Résidence Les Tilleuls",
    when: "Mar. 14 oct. · 14h30",
    organizer: "Oscar Baron",
    transcript: TRANSCRIPT,
    people: [
      { name: "Marie Durand", email: "marie.durand@kandbaz.fr", known: false, company: "Kandbaz" },
      { name: "Jean Martin", email: "j.martin@ca-paris.fr", known: true },
      { name: "Sophie Leroy", email: "sophie@leroy-patrimoine.fr", known: true },
    ],
  },
  // Several unknowns, one of them probably a contact (same name, other address).
  {
    id: "probable",
    title: "Comité d'investissement Nexity",
    when: "Mer. 15 oct. · 10h00",
    organizer: "Philippe Bernieri",
    transcript: TRANSCRIPT,
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
  // Nobody is in Notion.
  {
    id: "all-unknown",
    title: "Premier échange — Groupe Altarea",
    when: "Jeu. 16 oct. · 16h15",
    organizer: "Jean-Philippe Deltour",
    transcript: TRANSCRIPT,
    people: [
      { name: "Hugo Lambert", email: "h.lambert@altarea.com", known: false, company: "Altarea" },
      { name: "Inès Moreau", email: "ines.moreau@altarea.com", known: false, company: "Altarea" },
      { name: "Nadia Benali", email: "nadia@benali-conseil.fr", known: false },
    ],
  },
  // A colleague's recording already made the note: one person is left.
  {
    id: "note-exists",
    title: "Visite de chantier — Bordeaux Euratlantique",
    when: "Ven. 17 oct. · 09h00",
    organizer: "Oscar Baron",
    transcript: TRANSCRIPT,
    noteExists: true,
    people: [
      { name: "Thomas Roux", email: "thomas.roux@bouygues-immo.fr", known: false, company: "Bouygues Immobilier" },
      { name: "Claire Fontaine", email: "c.fontaine@bnpparibas.com", known: true },
    ],
  },
  // The report could not be processed.
  {
    id: "failed",
    title: "Point hebdo — Promoteurs",
    when: "Ven. 17 oct. · 11h30",
    organizer: "Philippe Bernieri",
    transcript: [],
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
