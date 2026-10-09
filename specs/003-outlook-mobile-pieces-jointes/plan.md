# Implementation Plan: Complément Outlook — mobile, manifeste et pièces jointes

**Branch**: `claude/determined-tesla-v86syo` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-outlook-mobile-pieces-jointes/spec.md` et les
constats de [research.md](./research.md).

## Summary

Un manifeste 1.4.0.0 qui ajoute Outlook mobile (`MobileFormFactor`, neuf icônes), une
info-bulle au pluriel, et rien d'autre ; un panneau utilisable au doigt ; et l'import des
pièces jointes du fil dans la colonne « Fichiers » de la note.

Quatre choix structurent la réalisation :

1. **Le serveur va chercher les fichiers chez Microsoft** avec le jeton Graph délégué que le
   panneau a déjà, transmis par en-tête et jamais conservé. Aucun fichier ne transite par le
   corps d'une requête au serveur, aucune permission ni secret nouveau (research B-2).
2. **Un fichier par requête** (`POST /api/outlook/attachments`), pour la progression et
   l'isolement des échecs ; `multi_part` au-delà de 20 Mo (research B-3, B-4).
3. **Les fichiers sont attachés dans la même écriture que la marque « Dernier message »**,
   ce qui rend le doublon impossible à l'enrichissement (research C-1), avec un repli sans
   perte si Notion refuse de conserver les fichiers existants (C-2).
4. **Réutiliser** : la logique d'upload de `files.ts` passe dans `_lib/upload.ts`,
   `maxUploadBytes`, `unique()` pour les copies, `openExternal`, les composants du panneau.

## Technical Context

**Language/Version** : TypeScript 7, React 19, Node 22 (fonctions Vercel).

**Primary Dependencies** : existantes (`@azure/msal-browser`, `jose`, Tailwind v4, `sharp` pour
les icônes). Outil de validation : `office-addin-manifest` via `npx`, sans dépendance ajoutée.

**Storage** : Notion (colonne Fichiers de Notes). Rien de nouveau dans Redis.

**Testing** : `npm run test:outlook` — fonctions pures (sélection et exclusion des pièces
jointes, dédoublonnage, découpe en parties, nom de fichier) et la route d'import de bout en
bout contre des serveurs Graph et Notion simulés en local (fichiers de 6 Mo et 45 Mo).
`scripts/check-attachments.mjs` contre la vraie base (research C-2). Validation officielle du
manifeste. Test manuel sur un vrai fil (`quickstart.md`).

**Target Platform** : Outlook Windows classique et nouveau, Mac, web, iOS et Android ≥ 4.2433.0.

**Project Type** : application web à trois outils et un socle serveur partagé.

**Performance Goals** : 30 Mo importés en moins d'une minute (SC-002).

**Constraints** : 4,5 Mo par corps de requête Vercel ; 12 fonctions (plafond atteint, B-6) ;
`maxDuration` 300 s pour la route d'import ; 100 fichiers par écriture Notion ; aucun nom ni
contenu de fichier journalisé.

**Scale/Scope** : 5 utilisateurs, fils de quelques messages à quelques dizaines.

## Constitution Check

| Principe | Vérification | Statut |
| --- | --- | --- |
| I. Aucun secret côté client | Aucun secret ajouté ; le jeton Graph est celui de l'utilisateur, déjà côté client | OK |
| II. Notion source de vérité | Rien de stocké ailleurs ; les fichiers vont dans Notion | OK |
| III. Une seule base Notes | Colonne de la base existante | OK |
| IV. Routes authentifiées | La nouvelle route passe par `guard()` (jeton d'API vérifié) ; le jeton Graph n'authentifie rien | OK |
| V. Écritures idempotentes | Fichiers écrits avec la marque ; uploads gardés côté panneau pour une reprise | OK |
| VI. Aucune perte silencieuse | Fichier non importé = listé avec la raison ; la note n'en dépend pas | OK |
| VII. Sobriété API | 1 lecture Graph par fil comme avant ; par fichier : 1 GET page de garde Notion évité, 2 à 2+N appels d'upload ; limite lue en cache | OK |
| VIII. Minimisation | Le contenu transite en mémoire vers Notion ; aucun nom de fichier dans les journaux | OK |
| Outils indépendants | `files.ts` (dictée) garde son comportement ; seule sa logique est déplacée | OK |
| Schéma vérifié en lecture | `Fichiers` (files) vérifié le 2026-10-03 ; relu à l'exécution ; conservation à vérifier par script | OK, avec C-2 |

Pas d'écart à justifier.

## Project Structure

### Documentation (this feature)

```text
specs/003-outlook-mobile-pieces-jointes/
├── spec.md
├── research.md
├── plan.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── outlook-attachments.md
│   └── outlook-notes-files.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
scripts/
├── outlook-manifest.template.xml   # 1.4.0.0, MobileFormFactor, buttonTip
├── generate-outlook-icons.mjs      # + 9 icônes mobiles
├── check-attachments.mjs           # nouveau : vérification C-2 sur la vraie base
└── test-outlook.mjs                # nouveau : tests purs + route d'import simulée
public/outlook/icon-{25,32,48}{,@2x,@3x}.png
api/outlook/attachments.ts          # nouveau, 12e fonction
vercel.json                         # maxDuration 300 pour la route
functions/
├── _lib/upload.ts                  # nouveau : upload Notion single/multi part
├── _lib/attachments.ts             # nouveau : règles pures (exclusion, parties, nom)
├── api/files.ts                    # utilise _lib/upload.ts, comportement inchangé
├── api/outlook/attachments.ts      # nouveau : GET limite, POST import d'un fichier
└── api/outlook/notes.ts            # POST/PATCH acceptent `files`
src/outlook/
├── graph.ts                        # métadonnées des pièces jointes
├── unique.ts                       # les pièces jointes suivent la copie retenue
├── attachments.ts                  # nouveau : candidats, exclusions, dédoublonnage
├── api.ts                          # importAttachment, uploadLimit, files dans les notes
├── auth.ts                         # (inchangé) graphToken réutilisé
├── office.ts                       # isMobile, openBrowserWindow détecté par requirement set
├── notion-link.ts                  # pas de schéma notion:// sur mobile
├── Panel.tsx                       # section fichiers, progression, compte rendu
├── NotionButton.tsx                # cible tactile
└── outlook.css                     # 16 px sur écran tactile, safe area, touch-action
```

**Structure Decision**: le découpage existant (fonctions dans `functions/`, adaptateurs Vercel
dans `api/`, panneau dans `src/outlook/`) est conservé.

## Complexity Tracking

| Point | Pourquoi | Alternative plus simple rejetée |
| --- | --- | --- |
| 12ᵉ fonction Vercel | Durée et rôle propres (import long, 300 s) | La loger dans `outlook/notes.ts` mêlerait deux durées et deux contrats ; le regroupement est reporté à la prochaine route |
| Repli d'écriture sans la colonne Fichiers | Comportement de Notion non documenté (C-2) | Écrire sans repli : risque de bloquer l'enrichissement entier sur un refus |
