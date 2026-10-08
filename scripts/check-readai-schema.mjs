// Does the Notion schema hold what the Read AI sync writes?
//
// Read only: nothing is created, nothing is changed. It answers §12 of the
// brief of feature 002 against the real bases, with the token of .env.local
// (or of the environment), and must pass before a deployment. Column names
// that were assumed rather than read are a proven source of failure here —
// feature 001 lost a day to one.
//
//   npm run check:readai

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// .env.local first, the process environment over it: the same precedence as
// Vite's loadEnv, without loading Vite for it.
const env = {};
for (const file of [".env", ".env.local"]) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
Object.assign(env, Object.fromEntries(Object.entries(process.env).filter(([key]) => /^[A-Z0-9_]+$/.test(key))));

const need = ["NOTION_TOKEN", "NOTION_NOTES_DB", "NOTION_CONTACTS_DB"].filter((key) => !env[key]);
if (need.length) {
  console.log(`Variables manquantes : ${need.join(", ")} (.env.local ou environnement).`);
  process.exit(2);
}

const name = (key, fallback) => env[key]?.trim() || fallback;
const NOTES = {
  date: name("NOTES_PROP_DATE", "Date"),
  author: name("NOTES_PROP_AUTHOR", "Auteur"),
  clientId: name("NOTES_PROP_CLIENT_ID", "ID client"),
  source: name("NOTES_PROP_SOURCE", "Source"),
  aiStatus: name("NOTES_PROP_AI_STATUS", "Statut IA"),
  contact: env.NOTES_PROP_CONTACT?.trim() || "",
  readai: name("NOTES_SOURCE_READAI", "ReadAI"),
};
const CONTACTS = {
  email: name("CONTACTS_PROP_EMAIL", "Email"),
  company: name("CONTACTS_PROP_COMPANY_RELATION", "Société"),
  rollup: name("CONTACTS_PROP_COMPANY_ROLLUP", "Nom société"),
};

async function notion(path) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2026-03-11" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} → ${response.status} ${data.message ?? ""}`);
  return data;
}

async function source(databaseId) {
  const database = await notion(`/databases/${databaseId}`);
  const id = database.data_sources?.[0]?.id;
  if (!id) throw new Error(`La base ${databaseId} n'expose aucune source de données`);
  return { id, properties: (await notion(`/data_sources/${id}`)).properties };
}

let failures = 0;
const ok = (text) => console.log(`  ok     ${text}`);
const bad = (text) => {
  failures++;
  console.log(`  ÉCHEC  ${text}`);
};
const note = (text) => console.log(`  note   ${text}`);

try {
  const notes = await source(env.NOTION_NOTES_DB);
  const contacts = await source(env.NOTION_CONTACTS_DB);
  const n = notes.properties;
  const c = contacts.properties;

  console.log("Base Notes");
  const title = Object.values(n).find((property) => property.type === "title");
  title ? ok(`titre : « ${title.name} »`) : bad("aucune propriété titre");

  const source_ = n[NOTES.source];
  if (source_?.type !== "select") bad(`« ${NOTES.source} » : attendu select, trouvé ${source_?.type ?? "rien"}`);
  else {
    const options = source_.select.options.map((option) => option.name);
    options.includes(NOTES.readai)
      ? ok(`« ${NOTES.source} » select, option « ${NOTES.readai} » présente (${options.join(", ")})`)
      : bad(`« ${NOTES.source} » select sans l'option « ${NOTES.readai} » (${options.join(", ")}) — à ajouter dans Notion`);
  }

  n[NOTES.author]?.type === "people"
    ? ok(`« ${NOTES.author} » people — la limite à une personne ne se lit pas par l'API : à constater dans l'interface`)
    : bad(`« ${NOTES.author} » : attendu people, trouvé ${n[NOTES.author]?.type ?? "rien"}`);

  n[NOTES.date]?.type === "date"
    ? ok(`« ${NOTES.date} » date (une propriété date accepte toujours une heure)`)
    : bad(`« ${NOTES.date} » : attendu date, trouvé ${n[NOTES.date]?.type ?? "rien"}`);

  n[NOTES.clientId]?.type === "rich_text"
    ? ok(`« ${NOTES.clientId} » texte`)
    : bad(`« ${NOTES.clientId} » : attendu texte, trouvé ${n[NOTES.clientId]?.type ?? "rien"}`);

  const relation = NOTES.contact
    ? n[NOTES.contact]
    : Object.values(n).find(
        (property) => property.type === "relation" && property.relation?.data_source_id === contacts.id,
      );
  relation?.type === "relation" && relation.relation?.data_source_id === contacts.id
    ? ok(`relation vers Contacts : « ${relation.name} » — la limite de pages ne se lit pas par l'API (001 : constatée sans limite)`)
    : bad("aucune relation de Notes vers Contacts");

  n[NOTES.aiStatus]
    ? note(`« ${NOTES.aiStatus} » existe ; Read AI ne l'écrit pas`)
    : note(`« ${NOTES.aiStatus} » absente ; sans effet pour Read AI`);

  console.log("Base Contacts");
  const email = c[CONTACTS.email];
  email?.type === "email" || email?.type === "rich_text"
    ? ok(`« ${CONTACTS.email} » de type ${email.type} — plusieurs adresses séparées par des virgules (sonde 001 A-4)`)
    : bad(`« ${CONTACTS.email} » : attendu email ou texte, trouvé ${email?.type ?? "rien"}`);

  const company = c[CONTACTS.company];
  if (company?.type !== "relation") bad(`« ${CONTACTS.company} » : attendu relation, trouvé ${company?.type ?? "rien"}`);
  else {
    const companies = (await notion(`/data_sources/${company.relation.data_source_id}`)).properties;
    const companyTitle = Object.values(companies).find((property) => property.type === "title");
    companyTitle
      ? ok(`« ${CONTACTS.company} » relation → Sociétés, nom lu dans « ${companyTitle.name} »`)
      : bad("la base Sociétés n'a pas de titre");
  }
  c[CONTACTS.rollup]?.type === "rollup"
    ? note(`rollup « ${CONTACTS.rollup} » présent : le nom de société sera lu sans requête de plus`)
    : note(`rollup « ${CONTACTS.rollup} » absent : une requête sur Sociétés résout les noms (001 A-3, T076)`);
} catch (error) {
  bad(error.message);
}

console.log(failures ? `\n${failures} point(s) à corriger avant de déployer.` : "\nLe schéma porte tout ce que Read AI écrit.");
process.exit(failures ? 1 : 0);
