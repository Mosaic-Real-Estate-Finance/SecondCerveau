# Contrat — ajout de `files` à `/api/outlook/notes`

Complète 001 `contracts/outlook-notes.md`. Seuls les ajouts sont décrits.

## POST et PATCH : corps

```json
{
  "…": "inchangé",
  "files": [{ "id": "<file upload Notion>", "name": "Offre.pdf" }]
}
```

`files` est facultatif. Absent ou vide : comportement identique à 001.

## POST

- Les fichiers sont posés dans la colonne Fichiers à la création de la page.
- Colonne absente ou d'un autre type : la note est créée sans eux, et ils reviennent dans
  `filesSkipped`.
- Au-delà de 100 : les suivants reviennent dans `filesSkipped`.
- Réponse `duplicate: true` (note déjà existante) : rien n'est attaché.

## PATCH

- Les fichiers sont écrits dans le même `PATCH` de propriétés que « Dernier message », après
  les fichiers déjà présents (relus à cet instant).
- Si Notion refuse ce `PATCH` (400), il est refait sans la colonne Fichiers : messages et
  marque écrits, existants intacts, nouveaux dans `filesSkipped`.
- 409 (note enrichie entre-temps) : rien n'est écrit, comme en 001.
- Aucun message nouveau : rien n'est écrit, fichiers compris.

## Réponse (ajouts)

```json
{
  "filesAdded": 2,
  "filesSkipped": [{ "name": "Plan.pdf", "reason": "La base de notes n'a pas de colonne fichiers « Fichiers »." }]
}
```
