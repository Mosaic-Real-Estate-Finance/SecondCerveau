# Phase 0 — Recherche et décisions

**Feature** : Synchronisation Read AI vers Notion · **Date** : 2026-10-08

Les constats marqués **vérifié** l'ont été contre la source citée ; ceux marqués **à confirmer**
attendent une lecture en direct que cette session ne pouvait pas faire (voir A-0).

---

## A. Schéma Notion (§12 du brief)

### A-0. Pas de lecture en direct dans cette session — **constaté**

Le conteneur de développement n'a ni `.env.local` ni `NOTION_TOKEN`, et le connecteur Notion
disponible ouvre le workspace personnel de Théo, pas celui de Mosaic. Décision prise avec Théo
(clarification du 2026-10-08) :

- le schéma de référence est celui lu en direct le **2026-10-03** (feature 001, research
  A-1 à A-5) ;
- le code relit le schéma à l'exécution (`schemaOf`) et refuse proprement si une colonne
  manque ou n'a pas le type attendu, comme le font déjà les routes 001 ;
- `npm run check:readai` (`scripts/check-readai-schema.mjs`) fait **en lecture seule** chaque
  vérification du §12 avec le `NOTION_TOKEN` de `.env.local`. Il DOIT passer avant le
  déploiement ; il est inscrit dans `quickstart.md` et dans la grille de convergence.

### A-1. Ce qui est établi par la lecture du 2026-10-03

| Propriété | Base | Type | Constat 001 | Pour cette feature |
| --- | --- | --- | --- | --- |
| titre (`Sujet`) | Notes | title | vérifié | ciblé par son type, pas par son nom |
| `Date` | Notes | date | vérifié | une propriété `date` de Notion accepte toujours une heure : `start` est écrit en ISO complet |
| `Auteur` | Notes | people | vérifié | plusieurs personnes écrites déjà par l'enrichissement Outlook (PATCH 001) |
| `Interlocuteur` | Notes | relation → Contacts | vérifié, sans limite de pages (constaté dans l'interface) | relation contacts, trouvée par sa cible |
| `ID client` | Notes | rich_text | créée et vérifiée | clé de réunion |
| `Source` | Notes | select (`Dictée`, `Email`) | créée et vérifiée | option `ReadAI` **à confirmer** |
| `Statut IA` | Notes | select | créée | jamais écrite (brief §7) |
| `Email` | Contacts | email | vérifié, accepte « a, b » et `contains` trouve la seconde | adresses ajoutées par virgule |
| `Société` | Contacts | relation → Sociétés | vérifié | nom lu par `companyNames()`, une requête |
| `Nom société` | Contacts | — | **absente** (A-3 de 001, T076) | repli `companyNames()` |

### A-2. Ce qui reste à confirmer en direct

| Point | Risque si faux | Garde-fou dans le code |
| --- | --- | --- |
| L'option `ReadAI` existe dans `Source` | L'API créerait l'option en silence | Le code lit les options du schéma ; absente, la création échoue avec « L'option ReadAI manque dans Source » et l'appel passe en erreur, réessayable une fois l'option ajoutée |
| `Auteur` non limité à une personne dans l'interface | Notion refuserait plusieurs auteurs | Erreur Notion visible, appel en erreur ; le réglage n'est pas exposé par l'API, il se constate dans l'interface |
| L'heure de `Date` affichée | Cosmétique | Aucun |

---

## B. Read AI

Sources : *Getting Started with Webhooks* (article 16352415827219), lu le 2026-10-08 par
l'API du centre d'aide (la page HTML répond 403 aux robots).

### B-1. Signature — **vérifié contre l'exemple JavaScript officiel**

```js
const keyBytes = Buffer.from(signingKey, 'base64');
const digest = crypto.createHmac('sha256', keyBytes).update(body, 'utf8').digest('hex');
crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(headerSig.toLowerCase()))
```

- **Décision** : la clé est **décodée en base64**, le HMAC-SHA256 est calculé sur les octets
  bruts du corps, le résultat hexadécimal est comparé en temps constant à l'en-tête
  `X-Read-Signature` mis en minuscules. Longueurs différentes → refus sans comparer.
- **À confirmer** sur une vraie requête de test (« Send test request ») : prévu au quickstart.
- Une clé de signature absente de l'environnement → 401 : refuser vaut mieux qu'accepter
  n'importe quoi.

### B-2. Réessais — la doc se contredit, on n'en dépend pas

Le corps de l'article dit « After 25 tries » ; la FAQ dit « up to 5 times (for a total of 6
attempts) » ; 25 échecs **consécutifs** arrêtent le webhook. Décision : répondre 200 dès
que la signature et le dédoublonnage sont faits, traiter ensuite. La seule réponse ≥ 300
possible après une signature valide est une indisponibilité du stockage (503) : sans lui, on ne
peut ni dédoublonner ni conserver l'appel, et un réessai de Read AI vaut mieux qu'une perte.

### B-3. Forme du payload — **vérifié** (exemple officiel)

- `transcript.speaker_blocks[].start_time` est une **chaîne** de millisecondes Unix.
- `meeting_start` ne porte ni `participants`, ni `summary`, ni `transcript`.
- `platform` vaut le nom de l'app Read pour un enregistrement fait depuis l'app ; dans ce cas
  `platform_meeting_id` peut manquer.
- `request_id` est unique par requête ; absent (requête de test ancienne), on prend le SHA-256
  du corps.

### B-4. Horodatage relatif de la transcription

`(début du bloc − start_time de la réunion)`, en `mm:ss` (ou `h:mm:ss` au-delà d'une heure).
Si `start_time` est illisible ou postérieur au premier bloc, la référence devient le premier
bloc. Un horodatage négatif n'apparaît jamais.

---

## C. Une réunion, une seule note

### C-1. Clé de réunion

- `platform_meeting_id` présent : `readai:<platform>:<platform_meeting_id>`.
- Sinon : `readai:session:<session_id>`.

### C-2. Repli heuristique — **décision**

Deux rapports sont la même réunion s'ils ont le même titre (comparé après `trim` et
minuscules), des débuts à moins de 10 minutes et au moins un externe en commun.

- Le repli est consulté **chaque fois que la clé exacte est inconnue**, pas seulement quand
  `platform_meeting_id` manque : le cas réel est un collaborateur qui enregistre par le robot
  Zoom (avec identifiant) et un autre par l'app Read sur son téléphone (sans). Les deux ordres
  d'arrivée doivent converger.
- Il porte sur un index court des réunions vues depuis 3 jours (`readai:recent`). L'index ne
  contient **que des empreintes** : SHA-256 du titre normalisé et des emails externes, le
  début en millisecondes, la clé. Aucun titre ni email en clair (principe VIII).
- Une réunion récurrente au même titre ne peut pas être confondue : ses occurrences sont à des
  jours d'écart.
- **Alternative écartée** : rapprocher par la seule fenêtre de temps — deux réunions
  successives dans la même salle virtuelle partageraient leurs notes.

### C-3. Verrou — **un seul, pas un par clé** (écart assumé au brief §6)

Le brief demande un verrou Redis par clé de réunion. À l'implémentation, il ne suffit pas : le
repli de C-2 peut **réunir deux clés**. Un rapport du robot Zoom (`readai:zoom:…`) et un rapport
de l'app Read (`readai:session:…`) arrivés ensemble prennent chacun le verrou de leur clé, se
trouvent l'un l'autre par l'index, et chacun attend la clé de l'autre : interblocage jusqu'au
TTL, puis deux erreurs.

- **Décision** : un verrou unique `readai:lock` (`SET NX EX 280`, libéré par script seulement
  par son détenteur), pris pour tout ce qui lit puis écrit l'état d'une réunion : traitement
  d'un rapport, décision, clôture, ignorer, réessayer. Un second rapport attend jusqu'à 240 s
  (sondage toutes les 500 ms), une décision jusqu'à 30 s, puis 409 « réessayez ».
- **Pourquoi c'est acceptable** : quelques réunions par jour, un traitement de quelques
  secondes (dizaine de secondes pour une transcription de plusieurs heures). Le verrou
  sérialise aussi les décisions concurrentes sur une même personne, ce qui garantit qu'aucun
  contact n'est créé deux fois (brief §8.4).
- **Vérifié** par `npm run sim:readai` : deux rapports de la même réunion lancés en parallèle
  donnent `queued` + `merged`, un seul élément, trois auteurs ; deux créations simultanées du
  même contact en donnent une, l'autre reçoit « Déjà traité ».

### C-4. Note déjà créée

L'état « note créée » n'est **pas** tenu dans Redis : Notion est la vérité (principe II). Le
traitement interroge Notes par `ID client = clé` — une requête, déjà faite par la création
pour l'idempotence.

---

## D. Stockage

### D-1. Upstash Redis via la Vercel Marketplace

- Client `@upstash/redis` (REST, sans connexion persistante : adapté aux fonctions).
- Variables : l'intégration injecte `KV_REST_API_URL` / `KV_REST_API_TOKEN`, les projets
  récents `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Les deux noms sont lus.
- Coût : environ 15 commandes par rapport traité, 2 par appel API de la PWA (session +
  révocation). Très en dessous des 500 000 / mois.

### D-2. Clés

Voir `data-model.md`, section Redis.

---

## E. Hébergement Vercel

### E-1. Plafond de 12 fonctions sur le plan Hobby — **à respecter**

Le plan Hobby refuse un déploiement de plus de 12 fonctions (« No more than 12 Serverless
Functions can be added to a Deployment on the Hobby plan », signalé sur le forum Vercel en mars
2026 ; la page officielle dit « Framework-dependent »). Le dépôt en a 8.

- **Décision** : 3 fichiers de plus, soit 11.
  - `api/readai/webhook.ts` — à part, parce qu'il lit le corps brut et a besoin d'une durée
    longue ;
  - `api/readai/[action].ts` — une route dynamique pour toutes les actions de l'écran
    (`items`, `decide`, `ignore`, `retry`, `excluded`, `push`) ;
  - `api/auth/[action].ts` — `code`, `verify`, `logout`.
  - `/api/session` existant reçoit le `GET` qui relit et prolonge la session.
- **Alternative écartée** : un fichier par action (19 fonctions), refusé au déploiement.

### E-2. `waitUntil`

`waitUntil` de `@vercel/functions` prolonge la fonction après la réponse, jusqu'à sa
`maxDuration`. `vercel.json` fixe `maxDuration: 300` pour le webhook. Hors Vercel (serveur de
dev), la promesse continue simplement de tourner dans le processus.

---

## F. Notion — écriture de la note

### F-1. Pas de modèle par défaut

La dictée et Outlook créent leurs pages depuis le modèle par défaut de Notes. Le brief §7
exige « deux callouts, et rien d'autre » : la page Read AI est créée **sans** modèle. Le
corps est donc ajouté immédiatement, sans attendre (`waitForTemplate` inutile).

### F-2. Callouts et lots

Réutilise `richText()` et `batches()` de `functions/_lib/thread.ts`, qui reçoit deux
constructeurs exportés de plus (`paragraph`, `callout`) au lieu d'une copie.

1. `PATCH /blocks/{page}/children` avec les deux callouts, chacun portant ses premiers
   paragraphes, dans la limite de 100 blocs au total ;
2. la réponse rend l'identifiant de chaque callout ;
3. le reste des paragraphes est ajouté à chaque callout par lots de 100, en ciblant son
   identifiant, avec 350 ms entre deux requêtes (≈ 3 req/s). `notion()` réessaie déjà un 429.

Une transcription d'une heure fait de l'ordre de 300 à 600 interventions : 4 à 7 requêtes.

Icône des callouts : la forme nommée vérifiée par 001 (D-4), `conversation` grise, pour les
deux. Une autre icône nommée n'a pas été vérifiée, et une icône refusée coûterait la note.

### F-3. Échec pendant l'écriture du corps

Comme Outlook (001) : la page est mise à la corbeille, puis l'erreur remonte. Une page sans son
contenu serait retrouvée par `ID client` et le réessai ne l'écrirait jamais.

### F-4. Fonctions partagées extraites

`contactRelation()` et `propertyItems()` vivaient dans `functions/api/outlook/notes.ts`. Elles
passent dans `functions/_lib/notes-db.ts` et la route Outlook les importe : déplacement sans
changement de comportement.

---

## G. Authentification de la PWA

### G-1. Code et session

- Code : 6 chiffres tirés par `crypto.randomInt`, stocké **haché** (HMAC-SHA256 avec
  `SESSION_SECRET`, email compris dans le message) sous `auth:code:<email>`, TTL 600 s,
  compteur d'essais dans la même valeur. 5 essais faux → la clé est supprimée.
- Limites d'envoi : `auth:cool:<email>` (`NX EX 60`) et `auth:hour:<email>` (`INCR`, `EX
  3600`, plafond 5). Elles s'appliquent **à toute adresse**, autorisée ou non : la réponse est
  identique dans les deux cas, limites comprises.
- L'envoi du mail part en arrière-plan (`waitUntil`) : le temps de réponse ne trahit pas
  l'appartenance à la liste.
- Session : JWT HS256 signé avec `SESSION_SECRET` (`jose`), `sub` = email, `jti` aléatoire,
  90 jours. Cookie `mosaic_session`, `HttpOnly; Secure; SameSite=Strict; Path=/`,
  `Max-Age` 90 jours.
- **Glissement** : l'app appelle `GET /api/session` à chaque lancement ; la réponse réémet le
  cookie pour 90 jours. Une app ouverte au moins une fois tous les 90 jours ne se déconnecte
  jamais. **Alternative écartée** : réémettre sur chaque route, qui imposait de toucher la
  construction de toutes les réponses.
- Révocation : `auth:revoked:<jti>` avec TTL jusqu'à l'expiration du jeton, consulté à chaque
  requête.

### G-2. Cookie dans la PWA installée iOS — **à confirmer sur appareil**

La PWA installée a son propre stockage, séparé de Safari, cookies compris. Un cookie
persistant (`Max-Age`) y survit à la fermeture ; un cookie de session (sans `Max-Age`) n'y
survit pas. D'où `Max-Age` explicite. Vérification sur iPhone inscrite au quickstart.

### G-3. SMTP Gmail

`nodemailer`, `smtp.gmail.com:465`, TLS implicite, mot de passe d'application. Le mail ne
contient que le code, sa durée et le nom de l'app.

---

## H. Web Push

- `web-push` côté serveur, clés VAPID ; abonnements dans `push:subs` (hash : empreinte de
  l'endpoint → `{ email, subscription }`). 404 / 410 → suppression.
- Service worker : **`importScripts`** d'un fichier dédié, `public/push-sw.js`, déclaré dans
  `workbox.importScripts`. Le mode `generateSW` et toute la configuration de cache restent
  identiques (dont `networkTimeoutSeconds: 3`). **Alternative écartée** : `injectManifest`,
  qui réécrit toute la stratégie de cache à la main.
- iOS : uniquement en PWA installée (16.4+), permission demandée sur un geste.

---

## I. Inconnues restantes

| Sujet | Qui tranche | Statut |
| --- | --- | --- |
| Option `ReadAI` de `Source` | Théo, `npm run check:readai` puis interface Notion | À confirmer avant déploiement |
| Signature sur une vraie requête de test | Admin Read AI | À confirmer au quickstart |
| Cookie persistant dans la PWA iOS | Théo, sur iPhone | À confirmer au quickstart |
