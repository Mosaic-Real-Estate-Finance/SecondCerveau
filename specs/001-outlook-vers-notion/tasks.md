---
description: "Liste de tâches — Complément Outlook vers Notion"
---

# Tasks: Complément Outlook vers Notion

**Input**: documents de conception dans `specs/001-outlook-vers-notion/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests** : aucune tâche de test automatisé n'est générée. La spécification ne demande pas de
TDD ; elle définit une grille de convergence manuelle dans les quatre clients Outlook, plus
quelques vérifications scriptables. Ces vérifications apparaissent comme tâches à la fin de
chaque phase de user story, pas avant l'implémentation.

**Organization** : regroupé par user story, pour que chacune soit implémentable et vérifiable
seule.

## Format: `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (fichiers différents, aucune dépendance en attente)
- **[Story]** : la user story de [spec.md](./spec.md) — US1 à US4
- Chemins exacts dans chaque description

## Path Conventions

Dépôt à deux fronts et un socle serveur, conformément à **Structure Decision** de
[plan.md](./plan.md) :

- PWA de dictée : `index.html`, `src/screens/`, `src/lib/`, `src/workers/` — **non touchés**
- Taskpane Outlook : `outlook.html`, `src/outlook/`, `public/outlook/`
- Socle serveur partagé : `functions/_lib/`
- Routes Outlook : `functions/api/outlook/`
- Routes de la dictée : `functions/api/` — **non touchées**, à une exception justifiée (T022)

---

## État d'avancement au 2026-10-03

**32 tâches sur 79.** Les quatre routes serveur sont écrites et éprouvées contre la vraie base
Notion. Il ne reste de prérequis externe que T003, l'application Entra, qui ne bloque que la
phase 7.

### Ce qui a été vérifié, pas supposé

Toutes les sondes ci-dessous ont écrit dans la base de production puis ont été archivées dans
la même exécution.

**Reconnaissance des contacts** — un contact dont `Email` vaut `a@…, b@…` est trouvé sur la
seconde adresse, en majuscules comme en minuscules. Et surtout : chercher `sonde.beta@…` ne
trouve **pas** un contact dont l'adresse est `zz.sonde.beta@…`. C'est la revérification
d'égalité exacte qui tient, après le filtre `contains` qui n'est qu'un dégrossissage.

**Cycle de vie d'une note** — `GET` sans note → `POST` → `POST` rejoué qui rend la même page
avec `duplicate: true` → `GET` qui retrouve la note et sa borne → `PATCH` avec une borne
périmée qui rend 409 → `PATCH` qui n'ajoute que le message nouveau → `PATCH` rejoué qui rend
`messagesAdded: 0`. Dans la page : `Source = Email`, `Statut IA = À traiter`, `ID client`,
`Dernier message`, `Date` du dernier message, `Interlocuteur`, `Auteur`, et
`Transcription brute` laissée vide.

**Fil long** — 60 messages donnent 60 callouts, sur plusieurs requêtes d'ajout, sans perte ni
doublon, et la borne finale est juste. Un message de 2 509 caractères arrive entier : envoyé en
deux éléments de rich text, Notion les recolle en un seul.

**Non-régression de la dictée** — `contacts.ts` a été refactoré sur la bibliothèque partagée,
donc ses deux chemins ont été repassés : la liste rend 236 contacts avec leurs sociétés
résolues, et une création écrit titre, Fonction, Type, `Téléphone FR`, `Téléphone CH` et le
lien Société, en laissant `Email` vide — la dictée n'en demande pas, et c'est inchangé.

**Authentification** — 401 sans identité sur les cinq points d'entrée, et 401 pour un Bearer
forgé accompagné d'un `x-user-email` valide.

**Certificat** — `curl` **sans `-k`** rend 200 sur `https://localhost:5173/outlook.html` et sur
l'IP du réseau : l'autorité est réellement approuvée par le système.

### Faites

T001, T002, T004, T005, T006, T007, T008, T009, T010, T010b, T011, T012, T013, T014, T015,
T016, T017, T018, T019, T020, T021, T022, T023, T024, T025, T026, T027, T028, T036, T040,
T041, T060 — plus, hors plan : `functions/_lib/contact.ts`, `scripts/outlook-manifest.mjs`,
`src/outlook/config.ts`, `.env.example`, et le mode `dev:outlook`.

### Décisions prises en cours de route

- **`functions/_lib/contact.ts`** : la création d'un contact est devenue une fonction partagée
  plutôt qu'une copie dans la route Outlook. Dupliquer la logique des colonnes téléphone, du
  lien société et du titre sans nom aurait voulu dire qu'un correctif d'un côté n'atteindrait
  pas l'autre — et l'endroit où cela dériverait est le CRM du client. `contacts.ts` passe de
  260 à 104 lignes et son comportement est inchangé, vérifié.
- **La route Outlook exige l'adresse** à la création d'un contact, là où celle de la dictée ne
  la demande pas. Un contact créé sans adresse serait invisible à toute reconnaissance
  ultérieure : le mail suivant de la même personne proposerait de la créer une seconde fois.
- **Le modèle par défaut est attendu, pas exigé** : cinq essais espacés de 400 ms, puis les
  blocs sont ajoutés quoi qu'il arrive et `templateTimedOut` le dit. Perdre l'ordre de quelques
  blocs est cosmétique ; perdre le mail ne l'est pas.
- **`dev:outlook` est un mode séparé de `dev:mobile`**, et pas un remplacement. Outlook sur le
  web charge le taskpane dans une iframe, où aucun avertissement de certificat n'est
  contournable ; le téléphone, lui, a déjà accepté le certificat auto-signé, et un certificat
  non approuvé dans une PWA autonome échoue en écran blanc plutôt qu'en question.

### Pièges rencontrés

1. Le service worker de la dictée **précachait `outlook.html`** et les icônes du complément :
   `navigateFallbackDenylist` ne couvre que le repli de navigation, jamais un succès de
   précache. D'où T010b.
2. Retirer les en-têtes d'isolation du taskpane dans un middleware **postérieur** ne marche
   pas : Vite applique `server.headers` avant les middlewares de plugin. Le middleware agit des
   deux côtés et reste étroit.
3. Le pont de développement ne peut pas construire une requête **GET avec un corps** et rend
   500 avant d'atteindre la route. C'est un artefact du harnais de test, pas de la route.

### Reste

- **T003** : l'application Entra, puis `ENTRA_API_CLIENT_ID` et `ENTRA_TENANT_IDS`.
- **Phase 3** : brancher le panneau sur les routes (T029, T030, T035, T037, T038, T042, T043).
- **Phases 6 à 11** : cas limites, authentification NAA, migration Vercel, production.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose** : prérequis humains, puis le squelette du second front.

**T001 est levée** : Théo a constaté dans l'interface Notion, le 2026-10-03, que la relation
n'est pas limitée à une page. T002 a suivi par l'API, et le schéma relu le confirme. Il ne
reste de prérequis humain que T003, l'application Entra, et seulement pour la phase 7.

- [X] T001 Constater dans l'interface Notion que la relation `Interlocuteur` de la base Notes n'est pas limitée à une page — procédure dans `specs/001-outlook-vers-notion/quickstart.md` §0.1 (hors code, Théo) **BLOQUANTE**
- [X] T002 Créer dans la base Notes les quatre propriétés manquantes : `ID client` (texte), `Source` (sélection, options exactement `Dictée` et `Email`), `Dernier message` (texte), `Statut IA` (sélection, options exactement `À traiter` et `Traité`) — tableau de référence dans `specs/001-outlook-vers-notion/data-model.md` §2 (hors code, Théo)
- [ ] T003 [P] Enregistrer l'application Microsoft Entra : SPA, redirection NAA `brk-multihub://<domaine>`, API exposée avec un scope pour le backend, permission déléguée `Mail.Read`, consentement administrateur — `specs/001-outlook-vers-notion/quickstart.md` §0.4 (hors code, Théo ; requise seulement à partir de la phase 7)
- [X] T004 Renseigner dans `.env.local` les sept variables nouvelles ou vides : `NOTES_PROP_CLIENT_ID=ID client`, `NOTES_PROP_SOURCE=Source`, `NOTES_PROP_AI_STATUS=Statut IA`, `NOTES_PROP_LAST_MESSAGE=Dernier message`, `CONTACTS_PROP_EMAIL=Email`, `INTERNAL_DOMAINS=mosaicfin.com`, et créer `.env.example` qui les liste toutes avec `NOTION_TOKEN` marqué comme secret (dépend de T002)
- [X] T005 Installer les dépendances dans `package.json` : `jose` (fait). `@azure/msal-browser` arrive avec T049 ; `@types/office-js` n'est pas nécessaire — `src/outlook/office.ts` déclare la surface d'Office qu'il utilise, qui est petite
- [X] T006 Créer `outlook.html` à la racine, entrée du taskpane, qui charge `https://appsforoffice.microsoft.com/lib/1/hosted/office.js` par balise `<script>` puis `src/outlook/main.tsx` — office.js n'est jamais bundlé (research E-3)
- [X] T007 Déclarer les deux entrées dans `vite.config.ts` via `build.rollupOptions.input` : `index.html` et `outlook.html`
- [X] T008 Ajouter dans `public/_headers` un bloc `/outlook*` qui supprime les deux en-têtes d'isolation par le préfixe `! ` : `! Cross-Origin-Embedder-Policy` et `! Cross-Origin-Opener-Policy` — COEP bloquerait office.js, COOP casserait la fenêtre d'authentification (research E-1)
- [X] T009 Ajouter dans `vite.config.ts` un middleware qui retire ces deux mêmes en-têtes pour toute requête dont le chemin commence par `/outlook`, en développement **et** en prévisualisation. Les retirer dans un middleware postérieur ne marche pas : `server.headers` est appliqué avant les middlewares de plugin. Le middleware fait donc les deux — `removeHeader` pour ce qui est déjà posé, et un `setHeader` neutralisé pour ce qui le serait ensuite — et ne touche jamais qu'une requête `/outlook`
- [X] T010 Ajouter `/^\/outlook/` à `workbox.navigateFallbackDenylist` dans `vite.config.ts` — sans cela le service worker de la dictée, de portée `/`, répond l'application de dictée sur `/outlook` (research E-2)
- [X] T010b Sortir le taskpane du précache du service worker : `globIgnores` gagne `outlook.html`, `outlook/**` et `assets/outlook-*.js`, et une règle `NetworkOnly` sur `/outlook` passe avant la règle de navigation. **Découvert en inspectant le build, pas prévu au plan** : la denylist ne gouverne que le repli de navigation, jamais un succès de précache, donc `outlook.html` était servi depuis le cache de la dictée — le complément aurait tourné sur une version périmée sans moyen de s'en apercevoir. Précache passé de 55 à 48 entrées
- [X] T011 [P] Créer `public/outlook/manifest.xml`, manifeste « add-in only » : surface `MessageReadCommandSurface`, un bouton ouvrant le taskpane libellé « Vers Notion », `SupportsPinning` activé, `AppDomains` limité au domaine de déploiement. Ne pas y déclarer `NestedAppAuth` : ce jeu d'exigences n'est pas déclarable dans un manifeste et se teste à l'exécution (research B-2)
- [X] T012 [P] Produire `public/outlook/icon-16.png`, `icon-32.png`, `icon-64.png`, `icon-80.png`, `icon-128.png` depuis `src/assets/mosaic-symbole.svg`

**Checkpoint** : `npm run build` produit deux pages ; `curl -D-` confirme que `/outlook.html`
ne porte pas les en-têtes d'isolation et que `/` les porte toujours.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose** : le socle commun à toutes les user stories — propriétés, authentification,
conversion des messages en blocs, et la coquille du panneau.

**⚠️ CRITICAL** : aucune user story ne peut commencer avant la fin de cette phase.

- [X] T013 Étendre `props()` et le type `Env` dans `functions/_lib/notion.ts` avec quatre entrées : `noteSource` (`NOTES_PROP_SOURCE`, défaut `"Source"`), `noteAiStatus` (`NOTES_PROP_AI_STATUS`, défaut `"Statut IA"`), `noteLastMessage` (`NOTES_PROP_LAST_MESSAGE`, défaut `"Dernier message"`), `contactEmail` (`CONTACTS_PROP_EMAIL`, défaut `"Email"`), plus `ENTRA_API_CLIENT_ID`, `ENTRA_TENANT_IDS`, `INTERNAL_DOMAINS`
- [X] T014 Créer `functions/_lib/auth.ts` exportant `identify(request, env): Promise<User | null>` selon `specs/001-outlook-vers-notion/contracts/auth.md` : chemin Bearer vérifié par `jose` (signature JWKS, `iss`, `aud` = `ENTRA_API_CLIENT_ID`, `exp`, `nbf`, `tid` ∈ `ENTRA_TENANT_IDS`), email pris dans `preferred_username` puis `upn` puis `email`, puis `findUser`. Un Bearer présent mais invalide **n'est jamais rattrapé** par le repli : sinon un faux Bearer accompagné d'un `x-user-email` contournerait toute la vérification
- [X] T015 Rendre `guard()` asynchrone dans `functions/_lib/notion.ts` et le faire appeler `identify()`, en gardant sa signature de retour `{ user } | Response` et ses messages d'erreur actuels pour le chemin `x-user-email` (dépend de T014)
- [X] T016 Ajouter `await` devant les appels à `guard()` dans `functions/api/contacts.ts`, `functions/api/companies.ts`, `functions/api/notes.ts`, `functions/api/files.ts` et `functions/api/session.ts` — changement purement mécanique, aucun comportement modifié (dépend de T015)
- [X] T017 [P] Créer `functions/_lib/thread.ts` : `blocksFor(messages)` rend, par message, un `callout` « Échange du D MMMM YYYY » (mois en français, en toutes lettres) dont les enfants sont un `divider` puis les paragraphes du contenu, et un dernier paragraphe « Pièces jointes : … » seulement s'il y a des noms. Contraintes à respecter littéralement : 2 000 caractères maximum par élément de rich text, 100 blocs maximum par requête, deux niveaux d'imbrication maximum par requête. Réutiliser le découpage de `richText()` de `functions/api/notes.ts` en l'extrayant ici (research D-1, data-model §3)
- [X] T018 [P] Créer `src/outlook/office.ts` : `ready()` attend `Office.onReady`, `supportsNaa()` renvoie `Office.context.requirements.isSetSupported("NestedAppAuth", "1.1")`, `readItem()` rend `{ itemId, conversationId, subject, from, to, cc }`, et `onItemChanged(cb)` s'abonne à `Office.EventType.ItemChanged`
- [X] T019 [P] Créer `src/outlook/participants.ts` : `split(participants, internalDomains, users)` sépare internes et externes, et `dedupe(matched)` fusionne deux adresses pointant la même page Notion en **une** entrée de relation — le dédoublonnage se fait sur l'identifiant de page, jamais sur l'adresse (data-model §1, invariant)
- [X] T020 [P] Créer `src/outlook/graph.ts` : `fetchThread(token, conversationId)` appelle `GET /me/messages?$filter=conversationId eq '…'` avec l'en-tête `Prefer: outlook.body-content-type="text"`, suit `@odata.nextLink` jusqu'au bout, lit `uniqueBody` et **trie côté client** sur `receivedDateTime` — Graph refuse `$orderby` combiné à ce `$filter` (research C-2)
- [X] T021 Créer `src/outlook/api.ts`, client typé des quatre routes `/api/outlook/*`, avec les formes de requête et de réponse de `specs/001-outlook-vers-notion/contracts/`, et une classe d'erreur portant le statut HTTP et le drapeau `retry`
- [X] T022 Ajouter dans `functions/api/notes.ts` l'écriture `Source` = `Dictée`, conditionnée à la présence de la propriété dans le schéma lu, comme toutes les autres écritures de cette route. **Unique modification d'une route de la dictée** ; justifiée dans **Complexity Tracking** de [plan.md](./plan.md) : sans elle, SC-005 est invérifiable et le prompt Notion AI ne peut pas distinguer les deux sources (dépend de T002, T013)
- [X] T023 Créer `src/outlook/main.tsx` et `src/outlook/Panel.tsx` : coquille du panneau, environ 320 px, une colonne, sans défilement horizontal, DA Mosaic avec Lora, **fond clair imposé même si Outlook est en thème sombre**, et la machine à états des dix états de `data-model.md` §5 câblée mais encore vide (dépend de T018)

**Checkpoint** : le parcours complet de la dictée passe sur l'iPhone, inchangé, et le taskpane
affiche le sujet du mail ouvert dans Outlook sur le web.

---

## Phase 3: User Story 1 - Classer un échange en deux clics (Priority: P1) 🎯 MVP

**Goal** : un mail dont les participants sont connus devient une note unique dans Notes,
liée à ces contacts, avec le fil entier dans le corps de la page.

**Independent Test** : ouvrir un mail d'un contact connu, cliquer sur le bouton, cliquer sur
« Créer la note », ouvrir le lien renvoyé — la note existe, elle est liée au contact, et elle
contient tous les messages du fil du plus ancien au plus récent.

- [X] T024 [P] [US1] Implémenter `POST /api/outlook/contacts/match` dans `functions/api/outlook/contacts/match.ts` selon `specs/001-outlook-vers-notion/contracts/outlook-contacts-match.md` : **une seule** requête Notion par filtre composé `or` de `Email.contains`, puis découpage des valeurs sur les virgules et **revérification d'égalité exacte en minuscules** — `contains` est une sous-chaîne, donc `o@m.com` trouverait `theo@m.com` (research D-3). Limites : 1 à 100 adresses, 400 au-delà ; adresses en doublon fusionnées ; deux contacts sur la même adresse → le premier est retenu et l'adresse est listée dans `ambiguous`
- [X] T025 [P] [US1] Implémenter `GET /api/outlook/notes?conversationId=` dans `functions/api/outlook/notes.ts` : filtre sur `ID client`, rend `{ note: { id, url, lastMessageId } }` ou `{ note: null }`, et `lastMessageId: null` si `Dernier message` est vide — une note antérieure à cette feature fait alors traiter tous les messages comme nouveaux, un doublon visible valant mieux qu'un message perdu
- [X] T026 [US1] Implémenter `POST /api/outlook/notes` dans `functions/api/outlook/notes.ts` : déduplication sur `ID client` avant toute écriture (réponse `200` + `duplicate: true`, rien d'écrit), création de la page depuis le modèle par défaut avec `Interlocuteur`, `Date` (date du dernier message), `Auteur`, `Source` = `Email`, `ID client`, `Statut IA` = `À traiter`, sans toucher `Transcription brute`. `contactIds` vide → 400 « Aucun interlocuteur à rattacher » ; `messages` vide → 400 (dépend de T017, T021)
- [X] T027 [US1] Ajouter dans `functions/api/outlook/notes.ts` l'attente du modèle par défaut : interroger les enfants de la page par essais espacés et plafonnés avant d'ajouter les blocs, parce que Notion applique le modèle après la création et interdit `children` à la création. Au dépassement du plafond, **ajouter quand même** et renvoyer `templateTimedOut: true` — perdre l'ordre est acceptable, perdre le mail ne l'est pas (research D-2, principe VI)
- [X] T028 [US1] Ajouter dans `functions/api/outlook/notes.ts` l'ajout des blocs par lots de 100 via `PATCH /v1/blocks/{id}/children`, puis l'écriture de `Dernier message` **après** l'ajout, et jamais avant (data-model §4)
- [ ] T029 [US1] Câbler dans `src/outlook/Panel.tsx` les états `chargement`, `nouvelle conversation`, `envoi` et `succès` : nombre de messages et période couverte, liste des participants externes cochés, bouton « Créer la note », puis confirmation avec lien « Ouvrir dans Notion » et la mention que la réécriture par l'IA prend quelques secondes (dépend de T023, T021)
- [ ] T030 [US1] Câbler dans `src/outlook/Panel.tsx` la présélection : tout contact reconnu est coché avec son nom et sa société, et chaque ligne reste décochable ; le bouton d'envoi est désactivé si aucune ligne n'est cochée (dépend de T024, T019)
- [ ] T031 [US1] Vérifier le test indépendant d'US1 dans Outlook sur le web selon `specs/001-outlook-vers-notion/quickstart.md` §3, et contrôler dans Notion : `Source` = `Email`, `Statut IA` = `À traiter`, un callout par message, ordre chronologique
- [ ] T032 [P] [US1] Vérifier l'idempotence : vingt `POST` de la même conversation laissent une seule page (SC-002) — script dans `specs/001-outlook-vers-notion/quickstart.md` §4
- [ ] T033 [P] [US1] Vérifier qu'un message de 10 000 caractères arrive entier dans Notion, découpé en paragraphes, et qu'un mail HTML chargé (signature, tableau) reste lisible
- [ ] T034 [P] [US1] Vérifier que dix adresses en entrée de `/contacts/match` coûtent exactement une requête Notion, et qu'une recherche de `b@x.fr` ne trouve pas un contact dont `Email` vaut `ab@x.fr`

**Checkpoint** : US1 est livrable seule. C'est le MVP.

---

## Phase 4: User Story 2 - Interlocuteur inconnu (Priority: P2)

**Goal** : un participant absent de Contacts est créé depuis le panneau, avec son email, et
lié à la note.

**Independent Test** : ouvrir un mail d'une adresse absente de Contacts, remplir le
formulaire proposé, envoyer — le contact existe dans Contacts avec son email, et la note lui
est liée.

- [ ] T035 [P] [US2] Ajouter un champ `email` à `src/components/contact-form.tsx`, préremplissable et requis quand le formulaire est utilisé par le panneau, optionnel pour la PWA de dictée qui n'en passe pas — aucun changement de comportement pour l'écran de dictée
- [X] T036 [US2] Implémenter `POST /api/outlook/contacts` dans `functions/api/outlook/contacts/index.ts` selon `specs/001-outlook-vers-notion/contracts/outlook-contacts.md` : reprend la logique de `functions/api/contacts.ts` **sans la modifier**, et ajoute l'écriture de `Email` (FR-014). Le titre est ciblé par son type `title`, jamais par son nom, qui est vide dans ce schéma (research A-5). `Email` absente du schéma → 500 nommant la colonne, jamais un abandon silencieux
- [ ] T037 [US2] Câbler dans `src/outlook/Panel.tsx` l'état `participant inconnu` : ligne marquée « Nouveau contact », dépliable en formulaire, nom et email préremplis, décochable pour ignorer une newsletter ou un assistant automatique ; le bouton d'envoi est désactivé tant qu'un formulaire coché est incomplet (dépend de T035)
- [ ] T038 [US2] Enchaîner dans `src/outlook/Panel.tsx` la création des contacts **avant** la note, en série, en conservant chaque identifiant obtenu dans l'état du panneau : la route de création n'est pas idempotente et un « Réessayer » ne doit jamais recréer un contact déjà créé (data-model §4)
- [ ] T039 [US2] Vérifier le test indépendant d'US2 selon `specs/001-outlook-vers-notion/quickstart.md` §3, y compris les deux cas négatifs : décocher l'inconnu laisse l'envoi possible, et un formulaire coché au nom vide désactive le bouton

**Checkpoint** : US1 et US2 fonctionnent indépendamment.

---

## Phase 5: User Story 3 - Reprendre une conversation déjà classée (Priority: P2)

**Goal** : un fil déjà classé est reconnu, et seuls les messages nouveaux sont ajoutés.

**Independent Test** : classer un fil, recevoir une réponse, rouvrir le panneau — il annonce
la note existante et le nombre de nouveaux messages ; après envoi, la note contient l'ancien
et le nouveau, une seule fois chacun.

- [X] T040 [US3] Implémenter `PATCH /api/outlook/notes` dans `functions/api/outlook/notes.ts` selon `specs/001-outlook-vers-notion/contracts/outlook-notes.md` : revérifier `sinceMessageId` contre `Dernier message` de la page et répondre `409` avec la vraie valeur s'ils diffèrent, puis ne garder que les messages postérieurs à la borne (FR-008)
- [X] T041 [US3] Compléter dans `functions/api/outlook/notes.ts` les propriétés à l'enrichissement : `Interlocuteur` par **union** des contacts existants et nouveaux, jamais par remplacement ; `Auteur` par **ajout** de l'utilisateur courant à la liste existante s'il n'y est pas (FR-005, clarification de session) ; `Date` à la date du dernier message ; `Statut IA` remis à `À traiter` ; `Dernier message` mis à jour après l'ajout des blocs (dépend de T040)
- [ ] T042 [US3] Câbler dans `src/outlook/Panel.tsx` les états `note existante` — « Note existante, N nouveaux messages », lien vers la note, bouton « Enrichir la note » — et `note à jour` — lien vers la note, **aucun** bouton d'envoi (dépend de T025)
- [ ] T043 [US3] Traiter le `409` dans `src/outlook/Panel.tsx` en rechargeant l'état du fil plutôt qu'en écrivant par-dessus, avec un message disant que la note a été enrichie entre-temps
- [ ] T044 [US3] Vérifier le test indépendant d'US3 selon `specs/001-outlook-vers-notion/quickstart.md` §3, et qu'un `PATCH` rejoué rend `messagesAdded: 0` sans aucun bloc en double

**Checkpoint** : US1, US2 et US3 fonctionnent indépendamment.

---

## Phase 6: User Story 4 - Ne rien perdre quand ça échoue (Priority: P3)

**Goal** : un échec est visible, la saisie est intacte, et « Réessayer » aboutit sans
doublon.

**Independent Test** : couper le réseau au moment de l'envoi — un message en français
apparaît, le formulaire de contact en cours est intact, et « Réessayer » aboutit une fois le
réseau revenu.

- [ ] T045 [US4] Câbler l'état `erreur` dans `src/outlook/Panel.tsx` : message en français distinguant le réseau de Notion, **toute** la saisie conservée, bouton « Réessayer » (FR, US4 scénarios 1 et 2)
- [ ] T046 [US4] Faire reprendre « Réessayer » à l'étape qui a échoué, et non au début : les contacts déjà créés et la note déjà créée ne sont jamais recréés (dépend de T038, T045)
- [ ] T047 [US4] Traiter le cas « page créée, blocs en échec » : la réponse `502` porte `noteUrl`, et le panneau propose d'ouvrir la note partielle au lieu de laisser croire que rien n'a eu lieu ou de réessayer en aveugle — l'état incertain est montré, jamais tu (principe VI, data-model §4)
- [ ] T048 [US4] Vérifier le test indépendant d'US4 selon `specs/001-outlook-vers-notion/quickstart.md` §3, et confirmer qu'aucun doublon n'est créé — ni contact, ni note

**Checkpoint** : les quatre user stories passent dans Outlook sur le web.

---

## Phase 7: Authentification Microsoft (transversale, FR-004)

**Purpose** : remplacer l'identité déclarative par une identité prouvée. Isolée de la phase 2
parce qu'elle dépend de T003, un prérequis externe, et que les phases 3 à 6 se développent
sans elle grâce au repli `x-user-email`.

- [ ] T049 Créer `src/outlook/auth.ts` : `createNestablePublicClientApplication` de `@azure/msal-browser`, un jeton d'accès pour le scope de l'API exposée et un second pour Graph `Mail.Read`. Demander toujours **au moins un scope de ressource**, sans quoi MSAL ne rend aucun jeton d'accès. Ne jamais faire voyager l'ID token : le backend valide un jeton d'accès (research B-3). **Aucun repli sur `Office.auth.getAccessToken`** : les jetons Exchange hérités sont éteints depuis octobre 2025 (research B-1) (dépend de T003)
- [ ] T050 Brancher le `Authorization: Bearer` dans `src/outlook/api.ts` et le jeton Graph dans `src/outlook/graph.ts` (dépend de T049)
- [ ] T051 Câbler l'état `incompatible` dans `src/outlook/Panel.tsx` : si `supportsNaa()` est faux, afficher un message en français nommant la version d'Outlook requise et ne rien tenter — Outlook Windows abonnement 2409 build 18025.20000, perpétuel retail 2501 build 18429.20132, volume/LTSC 2408 build 17932.20222 (research B-2) (dépend de T018)
- [ ] T052 Vérifier la grille d'authentification de `specs/001-outlook-vers-notion/quickstart.md` §4 : 401 sans en-tête sur chacune des quatre routes, 401 avec un Bearer forgé, 401 avec un Bearer valide d'un autre tenant, et la dictée toujours fonctionnelle avec son seul `x-user-email`

**Checkpoint** : aucune route n'est accessible sans identité prouvée ou sans l'adresse de la
liste, et la dictée est intacte.

---

## Phase 8: Cas limites et finition de l'interface

**Purpose** : les huit cas limites de [spec.md](./spec.md) et les règles transverses du
panneau.

- [ ] T053 [P] Câbler l'état `protégé` dans `src/outlook/Panel.tsx` : corps illisible (mail chiffré ou protégé) → message disant que le contenu n'est pas lisible par le complément, et aucun envoi
- [ ] T054 [P] Câbler l'état `aucun externe` dans `src/outlook/Panel.tsx` : tous les participants internes → **envoi refusé**, avec l'explication qu'il n'y a aucun interlocuteur externe à rattacher (clarification de session)
- [ ] T055 Traiter le changement de mail panneau épinglé dans `src/outlook/Panel.tsx` : `onItemChanged` réinitialise l'état, et si un brouillon de contact est en cours, une confirmation est demandée avant de le perdre (dépend de T018, T037)
- [ ] T056 Traiter les fils de plus de 50 messages dans `src/outlook/Panel.tsx` : traitement par lots avec progression affichée, sans perte de message
- [ ] T057 [P] Lister les noms de pièces jointes sous le message concerné, sans jamais télécharger les fichiers (FR-010) — dans `functions/_lib/thread.ts` et `src/outlook/graph.ts`
- [ ] T058 [P] Annoncer dans `src/outlook/Panel.tsx` la fenêtre de consentement Microsoft au premier usage, au lieu de laisser l'utilisateur face à une popup inexpliquée
- [ ] T059 Vérifier le panneau à 320 px dans les quatre clients : une colonne, aucun défilement horizontal, fond clair même en thème sombre Outlook (FR-011)

---

## Phase 9: Migration Cloudflare Pages → Vercel

**Purpose** : la décision de plateforme du brief, confirmée le 2026-10-03 — Vercel, plan
gratuit. **La feature ne l'exige pas** : les trois motifs techniques avancés tiennent sur Pages
(research E-1). Elle reste placée ici parce que c'est l'élément le plus risqué du lot : il
touche une application en service dont la dictée dépend d'en-têtes d'isolation exacts, et le
MVP n'a aucune raison d'en dépendre.

- [X] T060 Décider du maintien sur Cloudflare Pages ou du passage à Vercel (hors code, Théo). **Tranché le 2026-10-03 : passage à Vercel, sur le plan gratuit — le projet n'a pas d'usage commercial. T061 à T065 sont donc à faire**
- [ ] T061 Convertir les handlers `onRequestGet` / `onRequestPost` / `onRequestPatch` de `functions/api/**` en fonctions Vercel exportant `GET` / `POST` / `PATCH(request)`, et remplacer `env` par `process.env` dans `functions/_lib/notion.ts` et `functions/_lib/auth.ts` (dépend de T060)
- [ ] T062 Remplacer `public/_headers` par la clé `headers` de `vercel.json`, aux mêmes valeurs : COOP `same-origin` et COEP `require-corp` sur la PWA, **ni l'un ni l'autre** sur `/outlook*` et `outlook.html` (dépend de T060)
- [ ] T063 Remplacer le pont `pagesFunctions()` de `vite.config.ts` par `vercel dev`, et mettre à jour les scripts de `package.json` (dépend de T060)
- [ ] T064 Transférer les variables d'environnement sur Vercel, `NOTION_TOKEN` en secret, et vérifier que `.env.example` les décrit toutes (dépend de T060)
- [ ] T065 Exécuter la grille de non-régression de la dictée de `specs/001-outlook-vers-notion/quickstart.md` §5 **depuis la PWA installée sur l'iPhone**, pas depuis Safari : dictée de 15 s, envoi, `Source` = `Dictée`, et vérification que `/` porte toujours les deux en-têtes d'isolation. Un échec ici arrête la phase (dépend de T061, T062, T063, T064)

---

## Phase 10: Production Mosaic et déploiement

- [ ] T066 Ajouter le tenant Mosaic à `ENTRA_TENANT_IDS` et obtenir le consentement administrateur Mosaic sur `Mail.Read` et sur le scope de l'API exposée (hors code, admin Mosaic ; dépend de T052)
- [ ] T067 Vérifier avec l'administrateur Mosaic que l'octroi d'accès conditionnel « approved client app » n'est plus en place : il est retiré depuis mars 2026 et **MSAL NAA ne le supporte pas**, il provoque des erreurs de connexion même avec une exception (research B-4)
- [ ] T068 Ajouter dans `functions/_lib/users.ts` chaque collaborateur Mosaic concerné, avec son identifiant d'utilisateur Notion — un jeton Microsoft valide d'une adresse absente de cette liste est rejeté en 401
- [ ] T069 [P] Rédiger la note de prérequis destinée au client : actions à mener, permissions demandées et pourquoi, puisque le consentement administrateur porte sur l'accès aux mails
- [ ] T070 Exécuter la grille de convergence complète de [spec.md](./spec.md) dans les quatre clients : Outlook classique Windows, nouvel Outlook Windows, Outlook Mac, Outlook sur le web (dépend de T059, T052)
- [ ] T071 Mettre le complément en pilote, en sideload, chez un collaborateur (dépend de T070)
- [ ] T072 Déployer de façon centralisée depuis le centre d'administration Microsoft 365, rubrique des applications intégrées, ciblé sur les utilisateurs concernés — Microsoft annonce jusqu'à 24 heures de propagation (dépend de T071)

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T073 Adapter dans Notion le prompt de l'IA des notes de source `Email` pour qu'il lise **le corps de la page** et non `Transcription brute`, en laissant intact celui des notes de source `Dictée` (hors code, Théo)
- [ ] T074 [P] Vérifier qu'aucun secret n'est présent dans le bundle de production : `npm run build` puis recherche de motif dans `dist/` (SC-003, principe I)
- [ ] T075 [P] Vérifier qu'aucune journalisation ne touche le contenu d'un mail : relecture de `functions/api/outlook/` et `functions/_lib/thread.ts`, aucun appel à `console` portant sur un corps de message (FR-009, principe VIII)
- [ ] T076 [P] Corriger dans `.env.local`, `.env.example` et `functions/_lib/notion.ts` la valeur par défaut de `CONTACTS_PROP_COMPANY_ROLLUP` : `Nom société` ne désigne aucune propriété du schéma réel de Contacts, et le code tombe sur son repli à chaque appel (research A-3)
- [ ] T077 [P] Corriger dans `README.md` l'affirmation « un appel par société », fausse puisque la propriété de rollup visée n'existe pas, et y documenter le second front, ses routes et ses variables d'environnement
- [ ] T078 Exécuter l'intégralité de `specs/001-outlook-vers-notion/quickstart.md` sur une installation neuve, pour vérifier que le document suffit à faire tourner la feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** — T001 bloque tout. T003 n'est requise qu'en phase 7.
- **Phase 2 (Foundational)** — dépend de la phase 1 ; **bloque toutes les user stories**.
- **Phases 3 à 6 (user stories)** — dépendent de la phase 2. Ordre de priorité P1 → P2 → P2 → P3,
  ou en parallèle si l'équipe le permet.
- **Phase 7 (authentification)** — dépend de T003 et de la phase 2 ; indépendante des phases 3 à 6,
  qui tournent sur le repli `x-user-email`.
- **Phase 8 (cas limites)** — dépend des user stories qu'elle complète.
- **Phase 9 (migration)** — dépend des phases 3 à 7. Décidée : elle se fait, sur le plan gratuit.
- **Phase 10 (production)** — dépend de la phase 7 et de la phase 8.
- **Phase 11 (polish)** — à la fin, sauf T074 à T077 qui peuvent se faire à tout moment.

### User Story Dependencies

- **US1 (P1)** — aucune dépendance sur une autre story. C'est le MVP.
- **US2 (P2)** — indépendante d'US1 pour l'implémentation ; se vérifie seule.
- **US3 (P2)** — réutilise la route de création d'US1 (T025, T026) mais se vérifie seule.
- **US4 (P3)** — s'appuie sur les chemins d'envoi d'US1 et US2 ; se vérifie seule.

### Parallel Opportunities

- Phase 1 : T003, T011 et T012 en parallèle du reste.
- Phase 2 : T017, T018, T019 et T020 sont quatre fichiers neufs sans dépendance mutuelle.
- Phase 3 : T024 et T025 en parallèle ; T032, T033 et T034 sont trois vérifications indépendantes.
- Phase 8 : T053, T054, T057 et T058 touchent des endroits distincts.
- Phase 11 : T074 à T077 en parallèle.

---

## Parallel Example: Phase 2

```bash
# Quatre fichiers neufs, aucune dépendance mutuelle :
Task: "Créer functions/_lib/thread.ts — messages vers blocs Notion"
Task: "Créer src/outlook/office.ts — Office.onReady, isSetSupported, ItemChanged"
Task: "Créer src/outlook/participants.ts — interne/externe et dédoublonnage"
Task: "Créer src/outlook/graph.ts — récupération du fil, uniqueBody texte, tri client"
```

---

## Implementation Strategy

### MVP d'abord (US1 seule)

1. Phase 1, **en commençant par T001** : sans ce constat, le reste peut être à refaire.
2. Phase 2 entière.
3. Phase 3.
4. **S'arrêter et valider** : US1 dans Outlook sur le web, et la dictée intacte sur l'iPhone.
5. Démontrer.

### Livraison incrémentale

Phase 1 + 2 → socle · + US1 → MVP démontrable · + US2 → les inconnus · + US3 → plus de
doublons · + US4 → la confiance · + phase 7 → identité prouvée · + phase 8 → les cas limites ·
+ phase 10 → production. La phase 9 s'insère, ou non, avant la phase 10.

### Ce qui arrête une phase

- La dictée en régression : `Source` absente, microphone muet sur iPhone, ou en-têtes
  d'isolation perdus sur `/`. La dictée est en service ; elle passe avant le calendrier.
- Une propriété Notion attendue et absente : l'erreur nomme la colonne, et la phase attend.

---

## Correspondance avec la section « Tâches » du brief

Le brief demande explicitement de comparer cette liste à la sienne. Les sept phases du brief
sont toutes couvertes :

| Phase du brief | Tâches ici |
| --- | --- |
| 0 — Prérequis hors code | T001, T002, T003 (l'audit du dépôt est fait : [research.md](./research.md) §A) |
| 1 — Squelette | T006, T007, T011, T012, T023, T071 pour le sideload |
| 2 — Migration et backend | T013 à T022, T024 à T028, T036, T040, T041, T073 ; la migration est déplacée en phase 9 |
| 3 — Panneau fonctionnel | T029, T030, T037, T038, T042, T043, T045, T046, T055, T059 |
| 4 — Authentification | T014 à T016, T049 à T052 |
| 5 — Production | T066, T067, T068 |
| 6 — Déploiement | T071, T072 |

### Ce que le brief ne liste pas, et qui est ici

Neuf éléments nécessaires que la liste du brief omet. Trois sont des exigences de la
spécification, six sont des conséquences de l'audit.

1. **T022 — `Source` = `Dictée`** dans la route de la dictée. Sans elle, SC-005 est
   invérifiable. Le brief mentionne la règle dans sa section Schéma, pas dans ses tâches.
2. **T010 — denylist `/outlook` du service worker.** Le brief la cite dans « Pièges de
   configuration », sans tâche. Sans elle, le panneau sert l'application de dictée.
3. **T008 et T009 — exclusion de COOP/COEP sur `/outlook`.** Même constat : un piège signalé,
   jamais planifié.
4. **T051 — état « version d'Outlook trop ancienne ».** Le jeu `NestedAppAuth 1.1` n'est pas
   déclarable dans un manifeste ; sans cet état, l'utilisateur d'un Outlook ancien voit un
   panneau cassé sans explication.
5. **T007 — seconde entrée Vite.** Le brief décrit `outlook.html` dans l'arborescence sans
   tâche de configuration du build.
6. **T035 — champ Email de `contact-form.tsx`.** Implicite dans le brief, et c'est tout
   FR-014.
7. **T004 — variables d'environnement et `.env.example`.** Le brief les liste, sans tâche.
8. **T076 et T077 — `Nom société` et le README.** Écarts révélés par l'audit (research A-3).
9. **Les vérifications de non-régression en fin de phase** (T065 surtout). Le brief a une
   grille de convergence globale, mais aucune barrière intermédiaire ; la dictée est en
   service et mérite d'être protégée phase par phase.

### Les deux écarts d'ordre, assumés

- **La migration Vercel passe en phase 9**, pas en phase 2 : la feature ne l'exige pas
  (research E-1), et la mettre en tête placerait l'élément le plus risqué sur le chemin
  critique du MVP.
- **La phase 0 du brief annonce « relation Contacts passée en multiple »** comme une action
  faisable. L'API ne permet ni de le constater ni de le changer : T001 est une vérification
  dans l'interface, et son résultat peut invalider une hypothèse de la spécification.
