# Implementation Plan: Complément Outlook vers Notion

**Branch**: `001-outlook-vers-notion` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-outlook-vers-notion/spec.md`, brief
« Complément Outlook vers Notion » (2026-09-30), et les constats de
[research.md](./research.md).

## Summary

Un second front dans le dépôt SecondCerveau : un taskpane Outlook qui lit la conversation
ouverte, reconnaît les participants dans la base Contacts, laisse créer les inconnus, et crée
— ou enrichit — une note unique dans la même base Notes que la dictée. Le fil va dans le corps
de la page, un bloc callout par message ; Notion AI écrit ensuite le titre, le texte propre et
les tags, comme pour une dictée.

Trois choix structurent la réalisation :

1. **NAA est le seul chemin d'authentification.** Les jetons Exchange hérités sont éteints
   depuis octobre 2025, donc le repli décrit par le brief n'existe plus (research B-1). Le
   backend valide un jeton d'accès émis pour un scope de l'API exposée, jamais un ID token.
2. **La reconnaissance des contacts tient en une requête Notion**, par un filtre `or` de
   `contains` suivi d'une revérification d'égalité exacte côté serveur (research D-3). La
   propriété `Email`, de type `email`, accepte bien une chaîne multi-adresses : vérifié par
   sonde (research A-4).
3. **Le complément est livré d'abord sur Cloudflare Pages**, et la migration vers Vercel —
   retenue, sur le plan gratuit — suit en phase propre. La feature ne l'exige pas
   (research E-1), donc la sortir du chemin critique permet de livrer le MVP sans en dépendre.

Les deux dépendances externes sont levées : la relation `Interlocuteur` n'est pas limitée à une
page (constaté dans l'interface Notion le 2026-10-03), et les quatre propriétés manquantes de
la base Notes ont été créées et confirmées par relecture du schéma le même jour.

## Technical Context

**Language/Version** : TypeScript 7, ES2022. React 19.

**Primary Dependencies** : Vite 8, Tailwind v4, `vite-plugin-pwa` (existant, non touché par le
complément) · Office.js, chargé depuis le CDN Microsoft, jamais bundlé · `@azure/msal-browser`
(`createNestablePublicClientApplication`) · `jose` pour la validation des jetons côté serveur ·
l'API Notion `2026-03-11` via `functions/_lib/notion.ts`, inchangé.

**Storage** : Notion seul. Aucun stockage serveur, aucune base annexe. Le panneau garde son
état en mémoire, le temps d'un mail ouvert.

**Testing** : la grille de convergence de [spec.md](./spec.md) exécutée manuellement dans les
quatre clients Outlook, plus la grille de non-régression de la dictée. Vérifications
automatisables : rejet 401 sans jeton, absence de secret dans le bundle, idempotence sur
envois répétés.

**Target Platform** : taskpane web dans Outlook classique Windows, nouvel Outlook Windows,
Outlook Mac, Outlook sur le web. Backend : Pages Functions (Workers runtime) aujourd'hui,
fonctions Vercel après la phase 6.

**Project Type** : application web à deux fronts et un socle serveur partagé.

**Performance Goals** : moins de 30 s de l'ouverture du mail à la confirmation, pour un fil de
dix messages (SC-001). Afficher la liste des contacts reconnus coûte **une** requête Notion,
quel que soit le nombre de participants ou de contacts.

**Constraints** : panneau d'environ 320 px, une colonne, sans défilement horizontal · aucun
secret dans le bundle · le contenu d'un mail n'est jamais journalisé · COOP/COEP restent
appliqués à la PWA et ne doivent jamais atteindre `/outlook*` · les routes de la dictée ne
changent pas, à une exception justifiée plus bas.

**Scale/Scope** : quatre utilisateurs autorisés, base Contacts de l'ordre de quelques
centaines de fiches, fils de 1 à 50 messages couramment, au-delà traités par lots. Neuf écrans
d'état du panneau, quatre routes serveur nouvelles, un module d'authentification.

## Constitution Check

*GATE : à passer avant la phase 0, à revérifier après la phase 1.*

| Principe | Comment le plan le tient | Statut |
| --- | --- | --- |
| **I. Aucun secret côté client** | Aucun secret client Entra : NAA est un flux public, le taskpane ne détient que des identifiants publics. Le token Notion reste dans les variables serveur. Vérification : recherche de motif dans le bundle de production (SC-003). | ✅ |
| **II. Notion est la source de vérité** | Aucun stockage ajouté. L'état du panneau est en mémoire et perdu au changement de mail, par conception. | ✅ |
| **III. Une seule base Notes** | Le mail et la dictée écrivent dans `NOTION_NOTES_DB`. L'origine est la propriété `Source`, pas une base. | ✅ |
| **IV. Toute route API est authentifiée** | `guard()` reste le point unique ; il appelle désormais `functions/_lib/auth.ts`, qui accepte un Bearer Microsoft vérifié **ou** l'en-tête de la PWA. Aucune route nouvelle ne contourne `guard()`. | ✅ |
| **V. Écritures idempotentes** | `ID client` = `conversationId`, filtre avant création, comme la dictée le fait avec son identifiant de note. `Dernier message` borne l'enrichissement. Colonne créée le 2026-10-03 et idempotence de la dictée vérifiée de bout en bout : deux envois du même identifiant rendent la même page. | ✅ |
| **VI. Aucune perte silencieuse** | Rien n'est affiché comme envoyé avant la réponse de Notion. Les formulaires de contact survivent à l'échec. Si les blocs ne peuvent pas être ajoutés au bon endroit, ils sont ajoutés quand même et l'écart est signalé. | ✅ |
| **VII. Sobriété API** | Une requête Notion pour reconnaître tous les participants, une pour chercher la note existante, une pour créer, puis une par lot de 100 blocs. Aucun appel par ligne de liste. | ✅ |
| **VIII. Minimisation des données** | Le corps des mails traverse le serveur sans être journalisé : aucun `console.log` sur le contenu, et les messages d'erreur ne citent jamais le texte. | ✅ |

Les contraintes produit et interface de la constitution sont reprises telles quelles :
interface en français, DA Mosaic, panneau clair même en thème sombre Outlook. La
transcription sur l'appareil ne concerne pas cette feature.

**Verdict** : aucune violation, et plus aucune dépendance externe en suspens. Le principe V
est tenu depuis la création de `ID client`.

## Project Structure

### Documentation (this feature)

```text
specs/001-outlook-vers-notion/
├── spec.md              # Spécification clarifiée
├── plan.md              # Ce fichier
├── research.md          # Phase 0 : décisions et écarts au brief
├── data-model.md        # Phase 1 : entités, schéma Notion, états
├── contracts/           # Phase 1 : contrats des routes et de l'auth
│   ├── auth.md
│   ├── outlook-contacts-match.md
│   ├── outlook-contacts.md
│   └── outlook-notes.md
├── quickstart.md        # Phase 1 : comment valider de bout en bout
└── tasks.md             # Phase 2 (/speckit-tasks) — pas créé ici
```

### Source Code (repository root)

Les chemins marqués **nouveau** n'existent pas encore ; les autres existent et la colonne dit
ce qui leur arrive.

```text
index.html                          inchangé — entrée de la PWA
outlook.html                        nouveau — seconde entrée Vite du taskpane
vite.config.ts                      + build.rollupOptions.input (deux entrées)
                                    + denylist /outlook du service worker
                                    + middleware dev qui retire COOP/COEP sur /outlook
public/_headers                     + bloc /outlook* qui supprime COOP et COEP
scripts/outlook-manifest.template.xml  nouveau — gabarit du manifeste, hors public/
public/outlook/icon-{16,32,64,80,128}.png   nouveau

src/outlook/                        nouveau — le panneau
├── main.tsx                        Office.onReady, puis rendu
├── Panel.tsx                       la machine à états des neuf écrans
├── office.ts                       lecture du mail, ItemChanged, isSetSupported
├── auth.ts                         MSAL NAA : jeton backend, jeton Graph
├── graph.ts                        récupération du fil, uniqueBody texte, tri client
├── api.ts                          appels aux routes /api/outlook/*
├── participants.ts                 interne/externe, dédoublonnage par contact
└── config.ts                       domaines internes connus du panneau avant le premier appel

src/components/contact-form.tsx     + champ Email, préremplissable
src/components/                     réutilisés tels quels (screen, toast, shimmer…)
src/lib/, src/screens/, src/workers/  inchangés — la dictée n'est pas touchée

functions/_lib/notion.ts            + props Source / Statut IA / Dernier message / Email
                                    + types d'Env correspondants
functions/_lib/auth.ts              nouveau — vérifie un Bearer Microsoft, sinon repli PWA
functions/_lib/users.ts             inchangé
functions/_lib/thread.ts            nouveau — fil de messages → blocs Notion
functions/api/contacts.ts           inchangé
functions/api/companies.ts          inchangé
functions/api/files.ts              inchangé
functions/api/session.ts            inchangé
functions/api/notes.ts              une seule ligne ajoutée : Source = « Dictée » (voir Complexité)
functions/api/outlook/
├── notes.ts                        nouveau — GET ?conversationId= · POST · PATCH
└── contacts/
    ├── match.ts                    nouveau — POST adresses → reconnus / inconnus
    └── index.ts                    nouveau — POST création avec Email
```

**Structure Decision** : deux fronts, un socle serveur. Le taskpane est une seconde entrée
Vite (`outlook.html` + `src/outlook/`) plutôt qu'un dépôt ou un projet séparé : il réutilise
les composants et la DA de la PWA, et surtout `contact-form.tsx`, qui porte toute la logique
du formulaire nouveau contact. Les routes vivent sous `functions/api/outlook/`, un préfixe qui
rend l'isolation visible : aucune route de la dictée n'est modifiée par le complément, et une
régression de l'un ne peut pas venir de l'autre. Le seul code vraiment partagé est
`functions/_lib/`, ce que la constitution autorise explicitement.

## Phasage

Chaque phase se termine sur un état vérifiable. L'ordre diffère du brief sur un point : la
migration vers Vercel passe **après** que le complément fonctionne, pour la raison donnée en
research E-1.

| # | Phase | Fin de phase vérifiable | Bloquée par |
| --- | --- | --- | --- |
| 0 | Prérequis hors code | Les 4 propriétés existent dans Notes ; `Interlocuteur` constatée sans limite ; app Entra enregistrée | Théo |
| 1 | Squelette | Manifeste et icônes servis ; le taskpane affiche le sujet du mail ; sideload réussi dans les 4 clients | 0 (Entra non requis ici) |
| 2 | Backend Notion | Les 4 routes répondent, idempotence et blocs vérifiés au curl | 0 (propriétés + Interlocuteur) |
| 3 | Panneau fonctionnel | Les 4 parcours de la spec passent sur Outlook web | 1, 2 |
| 4 | Authentification | NAA en place, tout appel sans jeton valide rejeté en 401, PWA sans régression | 0 (Entra) |
| 5 | Production Mosaic | Tenant en liste blanche, consentement admin, collaborateurs dans `users.ts` | 4 |
| 6 | Migration Vercel | PWA et complément identiques sur Vercel, grille de la dictée verte | 3, 4 — **annulable** |
| 7 | Déploiement | Pilote en sideload, puis déploiement centralisé Microsoft 365 | 5 |

La phase 1 n'attend pas la phase 0 autrement que pour le sideload : un taskpane statique se
développe sans Entra ni propriété Notion.

## Complexity Tracking

| Violation | Pourquoi nécessaire | Alternative plus simple, et pourquoi écartée |
| --- | --- | --- |
| **FR-012 impose de modifier `functions/api/notes.ts`**, que FR-013 veut inchangée | Une note doit porter son origine, et l'origine d'une dictée ne peut être écrite que par la route de la dictée. Sans cela, le prompt Notion AI ne peut pas distinguer les deux sources, et SC-005 (« ses notes portent l'origine Dictée ») est invérifiable. | *Laisser les notes de dictée sans Source et traiter l'absence comme « Dictée »* : écarté, parce qu'une valeur absente est aussi ce qu'on obtient d'un bug d'écriture, et qu'on ne saurait plus les distinguer. *Un remplissage par automatisation Notion* : écarté, cela déplace une règle métier hors du dépôt. **Atténuation** : l'ajout est additif et conditionné à la présence de la colonne dans le schéma, comme tout ce qu'écrit déjà cette route ; sans la colonne, le comportement est identique à aujourd'hui. Portée : une entrée dans l'objet `properties`. |
| **La migration Cloudflare → Vercel est planifiée bien qu'inutile à la feature** | Décision de plateforme, arbitrée par Théo le 2026-10-03 : la migration se fait, sur le plan gratuit, le projet n'ayant pas d'usage commercial. Le motif n'est pas technique — les trois obstacles invoqués par le brief tiennent sur Pages (research E-1). | *S'en passer* : techniquement suffisant, mais ce n'est pas mon arbitrage à rendre. **Atténuation** : phase 9, hors du chemin critique, gardée par la grille de non-régression de la dictée, et exécutable sans que le MVP en dépende. |

## Revue de conformité post-conception

Revérifié après la phase 1, sur les artefacts produits.

- **Principe I** — Les contrats de `contracts/` ne font voyager aucun secret. Le taskpane ne
  détient que `ENTRA_API_CLIENT_ID`, un identifiant public par conception.
- **Principe IV** — `contracts/auth.md` définit un point d'entrée unique ; les trois contrats
  de route le citent et déclarent tous le 401.
- **Principe V** — `data-model.md` nomme la clé de déduplication de chaque écriture et décrit
  l'effet d'un rejeu.
- **Principe VI** — `data-model.md` décrit les transitions d'état du panneau, y compris les
  chemins d'échec et ce qui est conservé.

Aucune violation nouvelle n'apparaît à la conception.
