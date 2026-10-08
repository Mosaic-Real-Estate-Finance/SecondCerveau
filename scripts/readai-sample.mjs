// A signed meeting_end payload, to post on the webhook without Read AI.
//
//   node scripts/readai-sample.mjs --minutes 60 \
//     --participant "Arsène G <arsene@gouman.fr>" --participant "Oscar B <ob@mosaicfin.com>" \
//     [--title "Point dossier"] [--platform-id abc] [--session S1] > /tmp/body.json
//
// Prints the body on stdout and the curl to run on stderr. The signing key is
// READAI_WEBHOOK_SECRET from the environment, base64 as Read AI shows it.

import { createHmac, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const all = (name) => args.flatMap((arg, index) => (arg === `--${name}` ? [args[index + 1]] : []));

const minutes = Number(option("minutes", "60"));
const start = new Date(Date.now() - minutes * 60_000);
const people = all("participant").map((text) => {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(text);
  const name = (match ? match[1] : text).trim();
  const [first_name = "", ...rest] = name.split(" ");
  return { name, first_name, last_name: rest.join(" "), email: match ? match[2].trim() : null };
});
if (!people.length) {
  console.error("Au moins un --participant \"Nom <email>\" est attendu.");
  process.exit(2);
}

// One turn every five or six seconds: about 600 for an hour.
const blocks = [];
for (let at = 4_000, index = 0; at < minutes * 60_000; at += 5_000 + (index % 3) * 500, index++) {
  const speaker = people[index % people.length];
  blocks.push({
    start_time: String(start.getTime() + at),
    end_time: String(start.getTime() + at + 4_000),
    speaker: { name: speaker.name },
    words: `Intervention ${index + 1} de ${speaker.first_name || speaker.name}, texte d'essai.`,
  });
}

const body = JSON.stringify({
  session_id: option("session", randomUUID()),
  trigger: "meeting_end",
  title: option("title", "Réunion d'essai Read AI"),
  start_time: start.toISOString(),
  end_time: new Date().toISOString(),
  participants: people,
  owner: people[0],
  summary: "Résumé d'essai.\nDeuxième ligne du résumé.",
  action_items: [],
  key_questions: [],
  topics: [],
  chapter_summaries: [],
  transcript: { speaker_blocks: blocks, speakers: people.map(({ name }) => ({ name })) },
  report_url: "https://app.read.ai/analytics/meetings/test",
  platform: option("platform", "zoom"),
  platform_meeting_id: option("platform-id", null),
  request_id: randomUUID(),
});

process.stdout.write(body);
const secret = process.env.READAI_WEBHOOK_SECRET;
if (secret) {
  const signature = createHmac("sha256", Buffer.from(secret, "base64")).update(body).digest("hex");
  console.error(
    `\ncurl -X POST "$URL/api/readai/webhook" -H "Content-Type: application/json" -H "X-Read-Signature: ${signature}" --data-binary @<fichier>`,
  );
} else {
  console.error("\nREADAI_WEBHOOK_SECRET absent : payload non signé.");
}
