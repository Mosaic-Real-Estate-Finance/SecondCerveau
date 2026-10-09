# Tasks: Complément Outlook — mobile, manifeste et pièces jointes

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: oui, `npm run test:outlook` (plan, Testing).

`[P]` : parallélisable (fichiers distincts, sans dépendance).

## Phase 1 — Socle serveur partagé

- [x] T001 Extraire l'upload Notion (`safeName`, création, envoi) de `functions/api/files.ts` vers `functions/_lib/upload.ts`, et y ajouter le mode `multi_part` (parties de 10 Mo, `part_number`, `complete`) au-delà de 20 Mo
- [x] T002 `functions/api/files.ts` utilise `_lib/upload.ts`, plafond de 20 Mo conservé (comportement de la dictée inchangé)
- [x] T003 [P] Règles pures dans `functions/_lib/attachments.ts` : exclusions (`isInline`, `winmail.dat`/TNEF, `.ics`/`text/calendar`), nature, nom `.eml` d'un mail joint, découpe en parties

## Phase 2 — US1/US2 : import d'une pièce jointe (serveur)

- [x] T004 `functions/api/outlook/attachments.ts` : `GET` limite (`maxUploadBytes`), `POST` import d'un fichier (contrat outlook-attachments.md), vérification que le jeton Graph désigne l'utilisateur authentifié, arrêt du téléchargement au-delà de la limite, aucune journalisation de nom
- [x] T005 `api/outlook/attachments.ts` (adaptateur Vercel) et `maxDuration: 300` dans `vercel.json`
- [x] T006 `functions/api/outlook/notes.ts` : `files` sur POST (propriétés de création, colonne absente → `filesSkipped`, 100 au plus)
- [x] T007 `functions/api/outlook/notes.ts` : `files` sur PATCH, dans le même `PATCH` que la marque, existants relus et renvoyés, repli sans la colonne sur refus 400 (research C-2)

## Phase 3 — US1/US2/US3 : panneau

- [x] T008 `src/outlook/graph.ts` : métadonnées des pièces jointes dans l'expansion, `attachments` par message
- [x] T009 `src/outlook/unique.ts` : les pièces jointes suivent la copie retenue
- [x] T010 [P] `src/outlook/attachments.ts` : candidats des messages écrits, exclusions silencieuses, liens cloud non importables, trop lourds, dédoublonnage nom + taille y compris contre les messages déjà enregistrés
- [x] T011 `src/outlook/api.ts` : `uploadLimit`, `importAttachment` (en-tête `X-Graph-Token`), `files` dans `createNote`/`enrichNote`, pièces jointes retirées des messages envoyés
- [x] T012 `src/outlook/Panel.tsx` : section fichiers (nombre, taille totale, cases), étape « Import des fichiers… x/y », uploads gardés pour une reprise, compte rendu au succès (importés, non importés avec raison)

## Phase 4 — US4 : mobile

- [x] T013 [P] `src/outlook/office.ts` : `isMobile()`, `openExternal` passe par l'hôte seulement si `OpenBrowserWindowApi 1.1` est disponible
- [x] T014 [P] `src/outlook/notion-link.ts` : pas de schéma `notion://` sur mobile
- [x] T015 [P] `src/outlook/outlook.css` : champs à 16 px sur écran tactile, `touch-action: manipulation`, marge de sécurité basse
- [x] T016 `Panel.tsx`, `NotionButton.tsx` : cibles de 44 px (lignes cochables entières), cadre jusqu'à 480 px, message « trop ancien » avec la build mobile

## Phase 5 — US5 : manifeste

- [x] T017 [P] `scripts/generate-outlook-icons.mjs` : icônes mobiles 25/32/48 aux échelles 1, 2, 3 ; générer les fichiers
- [x] T018 `scripts/outlook-manifest.template.xml` : `buttonTip` au pluriel, `MobileFormFactor` dans `VersionOverridesV1_1`, ressources des icônes mobiles, `Version` 1.4.0.0 ; régénérer le verrou
- [x] T019 Valider le manifeste avec `office-addin-manifest validate`

## Phase 6 — Vérification

- [x] T020 `scripts/test-outlook.mjs` + script `test:outlook` : règles pures, dédoublonnage, import simulé de 6 Mo (single part) et 45 Mo (multi part) contre Graph et Notion simulés, refus d'un jeton Graph d'une autre personne, exclusion d'une image intégrée
- [x] T021 `scripts/check-attachments.mjs` : conservation des fichiers à la réécriture, sur la vraie base (research C-2)
- [x] T022 README : section pièces jointes et mobile, variables inchangées, redéploiement du manifeste
- [x] T023 `npm run typecheck`, `npm run build`, `npm run test:outlook`, `npm run check:api`, `npm run test:readai` : aucune régression
- [ ] T024 Test manuel sur un vrai fil (quickstart §3 et §4) — nécessite un déploiement et un compte Microsoft 365

## Dépendances

T001 → T002, T004 · T003 → T004 · T004 → T005 · T006 → T007 · T008 → T009 → T010 → T011 → T012 ·
T017 → T018 → T019 · tout → T020–T024.
