// Does Notion keep the files already in a Fichiers column when the column is
// rewritten with them plus a new one? (feature 003, research C-2)
//
// The enrichment of a note relies on it, and Notion's documentation does not
// say so in as many words: an update replaces the list, and the files already
// there come back as `type: "file"` with a signed URL whose round trip is not
// described. If the answer is no, the route still loses nothing — it falls
// back to writing the mark without the column and reports the new files as not
// imported — but every enrichment would then skip its attachments.
//
// Runs against the real notes base: one test page, two tiny text files, then
// the page goes to the trash.
//
//   node --env-file=.env.local scripts/check-attachments.mjs

const TOKEN = process.env.NOTION_TOKEN;
const NOTES = process.env.NOTION_NOTES_DB;
const COLUMN = process.env.NOTES_PROP_FILE || "Fichiers";
const VERSION = "2026-03-11";
const API = "https://api.notion.com/v1";

if (!TOKEN || !NOTES) {
  console.error("NOTION_TOKEN et NOTION_NOTES_DB sont nécessaires (node --env-file=.env.local …).");
  process.exit(1);
}

async function notion(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message ?? `Notion ${response.status}`), { status: response.status });
  return data;
}

async function uploadText(name, text) {
  const upload = await notion("/file_uploads", { method: "POST", body: { mode: "single_part", filename: name, content_type: "text/plain" } });
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), name);
  const response = await fetch(`${API}/file_uploads/${upload.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Notion-Version": VERSION },
    body: form,
  });
  if (!response.ok) throw new Error(`Envoi refusé (${response.status})`);
  return upload.id;
}

const database = await notion(`/databases/${NOTES}`);
const source = database.data_sources?.[0]?.id;
const schema = (await notion(`/data_sources/${source}`)).properties;
if (schema[COLUMN]?.type !== "files") {
  console.error(`La base n'a pas de colonne fichiers « ${COLUMN} » (type trouvé : ${schema[COLUMN]?.type ?? "aucune"}).`);
  process.exit(1);
}
const title = Object.values(schema).find((property) => property.type === "title")?.name;

let pageId = null;
try {
  const first = await uploadText("verification-1.txt", "Fichier de vérification 1, à supprimer.");
  const page = await notion("/pages", {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: source },
      properties: {
        [title]: { title: [{ type: "text", text: { content: "Vérification pièces jointes (à supprimer)" } }] },
        [COLUMN]: { files: [{ type: "file_upload", name: "verification-1.txt", file_upload: { id: first } }] },
      },
    },
  });
  pageId = page.id;

  const held = (await notion(`/pages/${pageId}`)).properties[COLUMN].files;
  console.log(`Après création : ${held.length} fichier (${held.map((file) => file.type).join(", ")}).`);

  const second = await uploadText("verification-2.txt", "Fichier de vérification 2, à supprimer.");
  const resent = held.map((file) =>
    file.type === "file"
      ? { name: file.name, type: "file", file: { url: file.file.url } }
      : { name: file.name, type: "external", external: { url: file.external.url } },
  );
  try {
    await notion(`/pages/${pageId}`, {
      method: "PATCH",
      body: {
        properties: {
          [COLUMN]: { files: [...resent, { type: "file_upload", name: "verification-2.txt", file_upload: { id: second } }] },
        },
      },
    });
  } catch (error) {
    console.log(`✗ Notion refuse le renvoi des fichiers existants (${error.status} : ${error.message}).`);
    console.log("  L'enrichissement utilisera le repli : marque écrite, nouveaux fichiers listés comme non importés.");
    process.exitCode = 2;
  }

  if (!process.exitCode) {
    const after = (await notion(`/pages/${pageId}`)).properties[COLUMN].files;
    const names = after.map((file) => file.name);
    if (after.length === 2 && names.includes("verification-1.txt") && names.includes("verification-2.txt")) {
      console.log("✓ 2 fichiers après renvoi : la conservation fonctionne.");
    } else {
      console.log(`✗ ${after.length} fichier(s) après renvoi : ${names.join(", ")}. La conservation ne fonctionne pas.`);
      process.exitCode = 2;
    }
  }
} finally {
  if (pageId) {
    await notion(`/pages/${pageId}`, { method: "PATCH", body: { in_trash: true } }).catch(() => {
      console.log(`Page de test à supprimer à la main : ${pageId}`);
    });
  }
}
