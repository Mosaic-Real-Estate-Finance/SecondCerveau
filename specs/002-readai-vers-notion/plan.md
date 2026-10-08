# Implementation Plan: Synchronisation Read AI vers Notion

**Branch**: `claude/elegant-mccarthy-li6574` | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-readai-vers-notion/spec.md`, brief
« Synchronisation Read AI → Notion (feature 002) », et les constats de
[research.md](./research.md).

## Summary

Un troisième outil dans le dépôt : Read AI pousse le rapport de chaque réunion terminée vers
`/api/readai/webhook`. Le serveur vérifie la signature, répond aussitôt, puis filtre les
participants, rapproche les externes de Contacts en une requête, et soit crée la note, soit met
l'appel en file d'attente dans Redis. La PWA gagne un écran « À valider » pour trancher les
inconnus, des notifications Web Push, et une vraie connexion par code email qui remplace
`x-user-email`.

Quatre choix structurent la réalisation :

1. **Accepter d'abord, traiter ensuite.** Signature et dédoublonnage en quelques dizaines de
   millisecondes, `200`, puis `waitUntil`. Un échec après coup devient un élément « erreur »
   visible, jamais un 5xx que Read AI compterait vers l'arrêt du webhook (research B-2).
2. **Notion reste la vérité de ce qui est validé.** Redis ne tient que l'état opérationnel
   (constitution 2.0.0, II) ; « la note existe-t-elle ? » se demande à Notion par `ID client`.
3. **Onze fonctions, pas dix-neuf.** Le plan Hobby plafonne à 12 fonctions par déploiement :
   une route dynamique par outil regroupe les actions (research E-1).
4. **Réutiliser plutôt que réécrire** : `createContact`, `companyNames`, le motif `or` +
   égalité stricte de `match.ts`, `richText`/`batches` de `thread.ts`, `ContactForm`,
   `MorphPanel`, `SearchField`.

## Technical Context

**Language/Version** : TypeScript 7, ES2022/ES2023, React 19, Node 22 (fonctions Vercel).

**Primary Dependencies** : existantes (Vite 8, `vite-plugin-pwa`, `jose`, Tailwind v4) ·
nouvelles : `@upstash/redis` 1.39.0, `@vercel/functions` 3.9.9 (`waitUntil`), `web-push`
3.6.7, `nodemailer` 10.0.10. Versions de plus de deux semaines.

**Storage** : Notion (vérité) · Upstash Redis via la Vercel Marketplace (état opérationnel,
`data-model.md` §3).

**Testing** : `npm run test:readai` — tests unitaires des fonctions pures (signature,
répartition, rapprochement strict, suggestions de domaine, clé et repli heuristique, blocs et
horodatage) sur la sortie transpilée, à la manière de `check:api`. `npm run check:readai` pour
le schéma Notion. La grille du brief §15 en manuel (`quickstart.md`).

**Target Platform** : Vercel (fonctions Node), PWA iOS 16.4+ installée pour les notifications.

**Project Type** : application web à trois outils et un socle serveur partagé.

**Performance Goals** : réponse au webhook < 2 s quelle que soit la taille du rapport ;
rapprochement en 1 requête Contacts (+ 1 pour les noms de sociétés) ; écriture du corps à
≈ 3 req/s.

**Constraints** : ≤ 12 fonctions Vercel ; aucun contenu de réunion, nom ni email dans les
journaux ; comportement de cache du service worker inchangé ; COOP/COEP intacts sur `/`.

**Scale/Scope** : 4 utilisateurs, quelques réunions externes par jour, transcriptions jusqu'à
quelques heures.

## Constitution Check

*GATE : passé avant la phase 0, revérifié après la phase 1.* Constitution **2.0.0**.

| Principe | Comment le plan le tient | Statut |
| --- | --- | --- |
| **I. Aucun secret côté client** | Secrets serveur : `NOTION_TOKEN`, `READAI_WEBHOOK_SECRET`, `KV_REST_API_TOKEN`, `SESSION_SECRET`, `SMTP_APP_PASSWORD`, `VAPID_PRIVATE_KEY`. Seule la clé VAPID **publique** passe en `VITE_`. Recherche de motifs dans `dist/` au quickstart. | ✅ |
| **II. Notion est la source de vérité** | Redis ne porte que la liste autorisée par II ; l'appel en attente ne garde que les champs de `Meeting` ; supprimé à la clôture ; « note créée » se lit dans Notion. | ✅ |
| **III. Une seule base Notes** | Notes, `Source = ReadAI`. | ✅ |
| **IV. Toute route est authentifiée** | Webhook : HMAC à temps constant. PWA : cookie de session signé, révocable. Complément : jeton Microsoft inchangé. `x-user-email` n'est plus lu par `identify()`. | ✅ |
| **V. Écritures idempotentes** | `request_id` (30 j), verrou unique `readai:lock` (research C-3), `ID client` = clé de réunion vérifiée avant création ; contact créé une fois par décision (`decision.contactId`), sous verrou d'élément. | ✅ |
| **VI. Aucune perte silencieuse** | Tout échec après acceptation → élément `error` + notification + « Réessayer » ; page sans corps mise à la corbeille. | ✅ |
| **VII. Sobriété API** | 1 requête Contacts par rapport, 1 pour les sociétés si besoin, lots de 100 blocs espacés de 350 ms, 429 réessayé. | ✅ |
| **VIII. Minimisation** | Journaux : identifiants techniques et issues seulement. Notifications : titre, compte, noms des contacts rattachés (pas de contenu). Index de repli en empreintes SHA-256. | ✅ |
| Contraintes produit | Routes `/api/readai/*` ; `functions/_lib` partagé ; écran dans le front de la PWA ; seule modification transverse : l'authentification (IV). | ✅ |
| Workflow | Schéma Notion : lecture du 2026-10-03 + `check:readai` avant déploiement (clarification 2026-10-08, research A-0). | ⚠️ justifié |

**Verdict** : aucune violation non justifiée. L'écart du workflow (vérification en direct
reportée au script) est tracé en Complexité.

## Project Structure

### Documentation (this feature)

```text
specs/002-readai-vers-notion/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/ webhook.md · readai-screen.md · auth.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
api/readai/webhook.ts               nouveau — vercel(onRequestPost)
api/readai/[action].ts              nouveau — GET, POST, DELETE de l'écran
api/auth/[action].ts                nouveau — code, verify, logout
api/session.ts                      + GET

functions/_lib/
├── auth.ts                         x-user-email retiré ; cookie de session
├── session.ts                      nouveau — JWT, cookie, révocation, codes
├── redis.ts                        nouveau — client, verrous
├── mail.ts                         nouveau — SMTP Gmail
├── push.ts                         nouveau — web-push, abonnements
├── background.ts                   nouveau — waitUntil
├── notes-db.ts                     nouveau — contactRelation, propertyItems (extraits d'Outlook)
├── thread.ts                       + paragraph, callout exportés
├── notion.ts                       Env étendu, SOURCE.readai
└── readai/
    ├── payload.ts                  signature, parse, normalisation
    ├── participants.ts             répartition, exclusion
    ├── match.ts                    rapprochement + suggestions (1 requête)
    ├── meeting-key.ts              clé, empreintes, repli heuristique
    ├── note.ts                     création / complément de la note
    ├── queue.ts                    éléments, décisions, clôture
    └── process.ts                  orchestration d'un rapport

functions/api/readai/webhook.ts     nouveau
functions/api/readai/screen.ts      nouveau — items, decide, ignore, retry, excluded, push
functions/api/auth.ts               nouveau — code, verify, logout
functions/api/session.ts            GET + POST, réémet le cookie
functions/api/outlook/notes.ts      importe notes-db (sans changement de comportement)

src/lib/api.ts                      plus d'x-user-email ; auth, readai, push
src/lib/push.ts                     nouveau — abonnement côté client
src/screens/AccessGate.tsx          deux étapes : adresse, puis code
src/screens/ReviewScreen.tsx        nouveau — « À valider »
src/screens/SettingsScreen.tsx      nouveau — notifications, déconnexion
src/screens/RecordScreen.tsx        + accès « À valider » avec compteur, accès réglages
src/screens/ContactScreen.tsx       exporte la recherche (match/fold) pour le sélecteur
src/components/contact-form.tsx     + email, sociétés suggérées, soumission déléguée
src/App.tsx                         pages 4 et 5, lien profond ?valider=<id>
src/styles/index.css                glissement des pages 4 et 5
public/push-sw.js                   nouveau — push, notificationclick
vite.config.ts                      workbox.importScripts ; routes de dev
vercel.json                         maxDuration du webhook
scripts/check-api.mjs               + 3 routes
scripts/check-readai-schema.mjs     nouveau — §12 en lecture
scripts/test-readai.mjs             nouveau — tests des fonctions pures
scripts/readai-sample.mjs           nouveau — payload signé de test
.env.example · README.md            variables, notifications, connexion
```

**Structure Decision** : la logique Read AI vit dans `functions/_lib/readai/`, découpée en
modules purs testables (payload, participants, clé, blocs) et en modules qui parlent à Notion
ou Redis. Les routes ne font que de la plomberie. Le front réutilise la coquille de pages de la
PWA plutôt qu'une seconde entrée Vite : l'écran est un outil des mêmes utilisateurs, sur le
même téléphone.

## Phasage

| # | Phase | Fin de phase vérifiable |
| --- | --- | --- |
| 0 | Prérequis | Upstash, secrets, option `ReadAI`, `check:readai` vert |
| 1 | Socle | Redis, session, `guard()` sur cookie, `check:api` à 11 routes |
| 2 | Authentification PWA (US3) | Connexion par code, 401 partout sans session |
| 3 | Webhook et chemin direct (US1) | Rapport connu → note avec callouts |
| 4 | File et écran (US2, US6) | Inconnu → file → décision → note |
| 5 | Dédoublonnage (US4) | Deux rapports → une note |
| 6 | Notifications (US5) | Notification reçue sur iPhone |
| 7 | Documentation, convergence | README, `.env.example`, grille §15 |

## Complexity Tracking

| Écart | Pourquoi nécessaire | Alternative plus simple, et pourquoi écartée |
| --- | --- | --- |
| **Schéma Notion non relu en direct avant le code** (workflow de la constitution) | Aucun jeton Notion de Mosaic dans l'environnement de développement ; arbitré avec Théo le 2026-10-08. | *S'arrêter avant le code* : retarde toute la feature pour trois points dont deux sont déjà établis par la lecture du 2026-10-03. **Atténuation** : relecture du schéma à l'exécution, refus explicite si une colonne manque, `check:readai` bloquant avant déploiement. |
| **L'authentification de la dictée change** (constitution, contraintes produit : une modification destinée à un outil ne modifie pas une route d'un autre) | Exigé par l'amendement IV : l'écran montre des réunions clients et le dépôt est public. | *Une session réservée aux routes Read AI* : laisserait `/api/contacts` et `/api/notes` ouvertes à quiconque connaît une adresse. |
| **Routes dynamiques `[action]`** au lieu d'un fichier par route | Plafond de 12 fonctions du plan Hobby. | *Passer en Pro* : décision de coût, hors de mon arbitrage ; *Edge Middleware* : un second runtime pour rien. |
| **Pages créées sans le modèle par défaut** | Le brief exige deux callouts et rien d'autre. | *Appliquer le modèle* : ajoute son contenu au corps. |
