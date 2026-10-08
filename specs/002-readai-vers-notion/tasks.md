---

description: "Tâches de la feature 002 — Synchronisation Read AI vers Notion"
---

# Tasks: Synchronisation Read AI vers Notion

**Input**: `specs/002-readai-vers-notion/` — plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md

**Tests** : la spec ne demande pas de TDD. Le plan prévoit cependant `npm run test:readai`
sur les fonctions pures (signature, répartition, rapprochement, clé, blocs) : ces tâches sont
incluses parce que ces règles sont celles dont l'erreur est silencieuse.

**Organisation** : par user story. US1, US2, US3 sont P1 ; US3 passe avant US2 parce que
l'écran « À valider » exige une session.

## Format : `[ID] [P?] [Story] Description`

---

## Phase 1 : Setup

- [X] T001 Ajouter les variables du brief §13 à `.env.example`, commentées comme les existantes (`READAI_WEBHOOK_SECRET`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `SESSION_SECRET`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_FROM`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY`, `GENERIC_EMAIL_DOMAINS`, `NOTES_SOURCE_READAI`)
- [X] T002 [P] Étendre le type `Env` et ajouter `SOURCE.readai` (valeur `NOTES_SOURCE_READAI` ou `ReadAI`) dans `functions/_lib/notion.ts`
- [X] T003 [P] Déclarer `VITE_VAPID_PUBLIC_KEY` dans `src/vite-env.d.ts`
- [X] T004 [P] Écrire `scripts/check-readai-schema.mjs` (lecture seule, §12 du brief : `Source` select + option `ReadAI`, `Auteur` people, relation Notes → Contacts, `Date` date, `ID client` rich_text, type de `Contacts.Email`, relation `Société` et titre de Sociétés) et le script `check:readai` dans `package.json`

---

## Phase 2 : Fondations (bloquant)

- [X] T005 Créer `functions/_lib/redis.ts` : client `@upstash/redis` depuis `KV_REST_API_*` ou `UPSTASH_REDIS_REST_*`, `acquire(key, ttl, waitMs)` / `release(key, token)` (DEL seulement si le jeton est le sien), erreur `StorageUnavailable`
- [X] T006 [P] Créer `functions/_lib/background.ts` : `later(promise)` via `waitUntil` de `@vercel/functions`, avec capture d'erreur qui ne journalise jamais de contenu
- [X] T007 [P] Extraire `contactRelation()` et `propertyItems()` de `functions/api/outlook/notes.ts` vers `functions/_lib/notes-db.ts`, et les importer dans la route Outlook sans changer son comportement
- [X] T008 [P] Exporter `paragraph()` et `callout(title, children, icon?)` depuis `functions/_lib/thread.ts`, `blocksFor()` les utilisant toujours à l'identique
- [X] T009 Créer `scripts/test-readai.mjs` (transpilation comme `check-api.mjs`, puis `node:test`) et le script `test:readai` dans `package.json`
- [X] T010 Ajouter `api/readai/webhook.js`, `api/readai/[action].js`, `api/auth/[action].js` à `ROUTES` dans `scripts/check-api.mjs` ; `maxDuration` 300 pour `api/readai/webhook.ts` dans `vercel.json`

**Checkpoint** : `npm run typecheck` et `npm run check:api` verts.

---

## Phase 3 : User Story 1 — Une réunion connue arrive seule dans Notion (P1) 🎯 MVP

**Goal** : rapport signé → filtrage → rapprochement → note avec callouts Résumé et Transcription.

**Independent Test** : rapport dont tous les externes sont dans Contacts → note rattachée, auteurs, sans question.

- [X] T011 [P] [US1] `functions/_lib/readai/payload.ts` : `verifySignature(raw, header, secret)` (clé décodée en base64, HMAC-SHA256 hex, `timingSafeEqual`, longueurs différentes → faux), `parseMeeting(json)` vers `Meeting` (`data-model.md` §2 ; `speaker_blocks[].start_time` est une chaîne de ms ; temps relatif au `start_time`, ou au premier bloc s'il est illisible ou postérieur ; jamais négatif)
- [X] T012 [P] [US1] `functions/_lib/readai/participants.ts` : normalisation (`trim().toLowerCase()`, owner ajouté, dédoublonnage par email), répartition sans email / internes (`internalDomains`) / externes, auteurs = internes présents dans `users.ts`, retrait des exclus
- [X] T013 [P] [US1] `functions/_lib/readai/match.ts` : une requête Contacts (`or` de `contains` sur chaque email et sur `@domaine` des domaines non génériques), découpage par virgule et égalité stricte ; `recognized` / `ambiguous` / `unknown` avec sociétés suggérées (comparaison stricte de la partie après `@`, toutes les sociétés de tous les contacts du domaine) ; noms via `companyNames()` ; liste `GENERIC_DOMAINS` par défaut (gmail.com, googlemail.com, outlook.com/.fr, hotmail.com/.fr, live.com/.fr, msn.com, yahoo.com/.fr, icloud.com, me.com, mac.com, orange.fr, wanadoo.fr, free.fr, sfr.fr, neuf.fr, laposte.net, bbox.fr, aol.com, protonmail.com, proton.me, gmx.com/.fr) surchargeable par `GENERIC_EMAIL_DOMAINS`
- [X] T014 [P] [US1] `functions/_lib/readai/note.ts` : `findNoteByKey`, `createMeetingNote(meeting, key, authors, contactIds)` (idempotent par `ID client` ; sans modèle ; titre, `Date` ISO avec heure, `Source` = option `ReadAI` vérifiée dans le schéma sinon `ConfigError`, `Auteur`, relation, `ID client` ; jamais `Statut IA` ni `Transcription brute`), corps en deux callouts puis enfants par lots de 100 sur l'id du callout, 350 ms entre requêtes, page à la corbeille si le corps échoue ; `completeNote(noteId, authors, contactIds)` par union
- [X] T015 [P] [US1] `functions/_lib/readai/meeting-key.ts` : clé `readai:<platform>:<id>` ou `readai:session:<id>`, empreintes SHA-256, index `readai:recent` (purge à 3 jours), repli titre identique + début à moins de 10 min + un externe commun
- [X] T016 [US1] `functions/_lib/readai/process.ts` : orchestration d'un rapport sous verrou de réunion — issues `ignored` / `noted` / `queued` / `merged` / `error` ; pour US1 le chemin `noted`
- [X] T017 [US1] `functions/api/readai/webhook.ts` + `api/readai/webhook.ts` : corps brut, signature → 401, trigger ≠ `meeting_end` → 200, `SET NX readai:req:<request_id> EX 30j` (sinon SHA-256 du corps) → 200 doublon, 503 si Redis indisponible, puis `later(process)` et 200
- [X] T018 [US1] Route de dev `POST /api/readai/webhook` dans `vite.config.ts`
- [X] T019 [P] [US1] Tests `test:readai` : signature (clé base64, mauvaise signature, longueur), répartition, égalité stricte (`o@m.com` ne trouve pas `theo@m.com`), domaine générique sans suggestion, deux sociétés, horodatage `mm:ss` / `h:mm:ss`, découpage des blocs ≤ 100
- [X] T020 [P] [US1] `scripts/readai-sample.mjs` : payload `meeting_end` signé de N minutes, participants en arguments

**Checkpoint** : un rapport connu crée sa note (quickstart, lignes Webhook et Filtrage).

---

## Phase 4 : User Story 3 — Entrer dans la PWA avec un code (P1)

**Goal** : session par code email, `x-user-email` retiré.

**Independent Test** : 401 sur toutes les routes sans session ; code reçu → accès.

- [X] T021 [P] [US3] `functions/_lib/mail.ts` : `sendCode(email, code)` via nodemailer, `smtp.gmail.com:465`, email en français sobre (code, 10 minutes, « Mosaic Dictée »)
- [X] T022 [US3] `functions/_lib/session.ts` : codes (6 chiffres, HMAC avec `SESSION_SECRET`, `auth:code:<email>` TTL 600 s, 5 essais puis suppression, usage unique ; `auth:cool` 60 s, `auth:hour` ≤ 5 / h pour toute adresse), JWT HS256 90 j (`jose`), cookie `mosaic_session; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=7776000`, révocation `auth:revoked:<jti>` jusqu'à `exp`
- [X] T023 [US3] `functions/_lib/auth.ts` : `identify()` lit le Bearer Microsoft (inchangé) sinon le cookie ; `x-user-email` supprimé ; `AUTH_MESSAGES.session`
- [X] T024 [US3] `functions/api/auth.ts` + `api/auth/[action].ts` : `code` (réponse identique, envoi en arrière-plan), `verify`, `logout` ; `functions/api/session.ts` en GET et POST qui réémet le cookie ; `api/session.ts` exporte GET ; routes de dev dans `vite.config.ts`
- [X] T025 [US3] `src/lib/api.ts` : plus d'en-tête `x-user-email`, `requestCode`, `verifyCode`, `logout`, `fetchSession` ; la session locale ne garde que le prénom pour l'accueil
- [X] T026 [US3] `src/screens/AccessGate.tsx` : étape adresse puis étape code (6 chiffres, `autocomplete="one-time-code"`, renvoyer le code, changer d'adresse), messages 429
- [X] T027 [US3] `src/App.tsx` : au lancement, `GET /api/session` (glissement) ; 401 → écran d'accès

**Checkpoint** : quickstart, lignes Auth.

---

## Phase 5 : User Story 2 — Valider les inconnus avant d'écrire (P1)

**Goal** : file d'attente et écran « À valider ».

**Independent Test** : un connu + un inconnu → file ; création du contact → note avec les deux.

- [X] T028 [US2] `functions/_lib/readai/queue.ts` : `QueueItem` (`data-model.md` §3), création, fusion d'un second rapport (auteurs, reconnus, personnes nouvelles, contenu du premier gardé), `decide` sous verrou d'élément (409 « Déjà traité »), `attach` (adresse ajoutée à `Email` par virgule si absente), `create` (`createContact` avec l'email de la personne), `exclude` (`readai:excluded`), `close` (note créée ou complétée, élément et `readai:meeting:<clé>` supprimés ; aucun contact retenu → aucune note), `ignore`, liste des éléments sans transcription
- [X] T029 [US2] `functions/_lib/readai/process.ts` : chemin `queued` (personnes `unknown` et `ambiguous`), élément `complete` quand la note existe déjà
- [X] T030 [US2] `functions/api/readai/screen.ts` + `api/readai/[action].ts` : `GET items` (`?count=1`), `POST decide`, `POST ignore`, `POST excluded` (`remove`), toutes derrière `guard()` ; routes de dev
- [X] T031 [P] [US2] `src/lib/api.ts` : `fetchReview`, `fetchReviewCount`, `decide`, `ignoreCall`, `retryCall`, `removeExcluded` et leurs types
- [X] T032 [P] [US2] `src/screens/ContactScreen.tsx` : exporter `match`/`fold` de la recherche pour le sélecteur
- [X] T033 [P] [US2] `src/components/contact-form.tsx` : props facultatives `email` (affiché, non modifiable), `companyChoices` (sociétés suggérées en puces, la première présélectionnée), `submit` (soumission déléguée) — comportement par défaut inchangé pour la dictée
- [X] T034 [US2] `src/screens/ReviewScreen.tsx` : liste du plus récent au plus ancien (titre, date, organisateur, contacts reconnus, résumé repliable) ; par personne nom, email, suggestion, « Rattacher » (sélecteur dans `MorphPanel`, contacts de la société suggérée puis candidats en tête), « Créer » (`ContactForm` prérempli dans `MorphPanel`), « Pas nécessaire » ; « Ignorer cet appel » ; « Déjà traité » → rafraîchir ; section liste d'exclusion avec retrait
- [X] T035 [US2] `src/screens/RecordScreen.tsx` : accès discret « À valider » avec compteur ; `src/App.tsx` : page 4, lien profond `?valider=<id>` ; `src/styles/index.css` : glissement des pages 4 et 5

**Checkpoint** : quickstart, lignes Rapprochement et Décisions.

---

## Phase 6 : User Story 6 — Ne rien perdre (P2)

- [X] T036 [US6] `functions/_lib/readai/process.ts` : toute exception → élément `error`, `stage: "process"`, `Meeting` conservé, message court sans contenu
- [X] T037 [US6] `functions/_lib/readai/queue.ts` + `screen.ts` : `POST retry` (process rejoué, ou clôture rejouée avec les décisions existantes) ; échec de clôture → `error`, `stage: "close"`, 502 avec l'élément
- [X] T038 [US6] `src/screens/ReviewScreen.tsx` : badge erreur et « Réessayer »

---

## Phase 7 : User Story 4 — Une réunion, une seule note (P2)

- [X] T039 [US4] `functions/_lib/readai/process.ts` : verrou unique `readai:lock` (research C-3) attendu jusqu'à 240 s, relecture de l'état ; fusion dans l'élément en attente ; note existante → `completeNote` + élément `complete` pour les nouveaux inconnus (fusionné s'il existe déjà) ; enregistrement dans `readai:recent`
- [X] T040 [P] [US4] Tests `test:readai` du repli heuristique (même titre, 9 min et 11 min, externe commun ou non)

---

## Phase 8 : User Story 5 — Notifications (P2)

- [X] T041 [P] [US5] `functions/_lib/push.ts` : `web-push` + VAPID, `push:subs`, envoi à tous, suppression sur 404/410 ; messages « Réunion ajoutée — Titre » (+ contacts), « n personne(s) à valider — Titre », « Réunion non enregistrée — Titre »
- [X] T042 [US5] `process.ts` / `queue.ts` : notifier `noted`, `queued` (et fusion qui ajoute des personnes), `error` ; jamais `ignored`
- [X] T043 [US5] `screen.ts` : `POST push` / `DELETE push`
- [X] T044 [P] [US5] `public/push-sw.js` (`push`, `notificationclick` → URL de la note ou `/?valider=<id>`, focus d'une fenêtre existante) ; `vite.config.ts` : `workbox.importScripts: ["push-sw.js"]`, le reste inchangé
- [X] T045 [US5] `src/lib/push.ts` + `src/screens/SettingsScreen.tsx` (page 5) : « Recevoir les notifications » si installée (permission sur geste), sinon renvoi vers l'invitation d'installation ; « Se déconnecter » ; accès depuis l'accueil

---

## Phase 9 : Polish

- [X] T046 [P] `README.md` : notifications introduites, connexion par code, synchronisation Read AI, nouvelles routes et fichiers
- [X] T047 [P] Relecture des journaux : aucun `console.*` ne cite titre, résumé, transcription, nom ni email (principe VIII)
- [X] T048 `npm run typecheck`, `npm run check:api`, `npm run test:readai`, `npm run build`, recherche de secrets dans `dist/`
- [ ] T049 Dérouler `quickstart.md` §3 sur l'environnement de production (humain)

---

## Dependencies & Execution Order

- Setup → Fondations → US1 → US3 → US2 → US6 → US4 → US5 → Polish.
- US1 se teste sans US3 (webhook authentifié par signature, résultat visible dans Notion).
- US2 dépend de US1 (traitement) et de US3 (écran derrière session).
- US6, US4, US5 étendent `process.ts` et `queue.ts` : séquentielles sur ces fichiers.

### Parallèle

- T002, T003, T004 ; T006, T007, T008.
- US1 : T011 à T015 (fichiers distincts), puis T016 → T017.
- US2 : T031, T032, T033 pendant T028–T030.

## Implementation Strategy

MVP = Phases 1 à 3 : une réunion connue arrive dans Notion. Puis US3 avant de montrer quoi
que ce soit d'une réunion dans la PWA, puis US2, puis le reste.

---

## Phase 10: Convergence

- [X] T050 Corriger le commentaire de `src/outlook/api.ts` et documenter dans `README.md` qu'un complément Outlook sans Entra configuré (développement local) reçoit désormais 401, l'en-tête `x-user-email` n'étant plus lu, sans changer le comportement du complément per FR-034, Constitution IV (partial)
