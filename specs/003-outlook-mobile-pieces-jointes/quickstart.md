# Quickstart — validation de la feature 003

## Prérequis

- `.env.local` avec `NOTION_TOKEN`, `NOTION_NOTES_DB`, `NOTION_CONTACTS_DB`, `ENTRA_*`.
- Un déploiement de prévisualisation Vercel de la branche, ou `npm run dev:vercel`.
- Un compte Microsoft 365 de test, et un fil avec un contact externe contenant :
  un PDF, un fichier de plus de 5 Mo, une image de signature, si possible un fichier de plus
  de 20 Mo et un `.ics`.

## 1. Tests automatiques (sans jeton)

```sh
npm run typecheck
npm run test:outlook   # règles pures + import simulé de 6 Mo et 45 Mo (multi_part)
npm run build          # écrit dist/outlook/manifest.xml, refuse un manifeste sans version montée
npx office-addin-manifest validate dist/outlook/manifest.xml
```

Attendu : tout passe ; la validation dit « The manifest is valid ».

## 2. Conservation des fichiers à l'enrichissement (vraie base)

```sh
node --env-file=.env.local scripts/check-attachments.mjs
```

Attendu : « 2 fichiers après renvoi : la conservation fonctionne. » La page de test est mise
à la corbeille. Si le script répond que Notion refuse le renvoi, l'enrichissement utilise le
repli (research C-2) : à signaler avant la mise en production.

## 3. Vrai fil, sur le poste

1. Sideloader le manifeste de dev pointant vers l'hôte de test.
2. Ouvrir le fil. Attendu : « N fichiers · X Mo seront joints », l'image de signature et le
   `.ics` absents de la liste.
3. Décocher un fichier, vérifier que le total change.
4. Créer la note. Attendu : « Import des fichiers… 1/N » … puis « N fichiers importés ».
5. Dans Notion : colonne Fichiers avec les fichiers cochés, tous ouvrables ; les noms toujours
   sous chaque message.
6. Répondre dans le fil avec une nouvelle pièce jointe, rouvrir le panneau, enrichir.
   Attendu : un seul fichier ajouté, les précédents toujours là, aucun doublon.

## 4. Vrai fil, sur téléphone

Outlook iOS ou Android ≥ 4.2433.0, compte Microsoft 365. Après déploiement du manifeste par
l'admin : ouvrir un mail, menu « … » / applications, « Save to Notion ».
Attendu : connexion, cases cochables au doigt, aucun zoom en touchant un champ, défilement
jusqu'au bouton, « Ouvrir dans Notion » ouvre hors du panneau.
