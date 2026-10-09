# Modèle de données — feature 003

## 1. Pièce jointe candidate (panneau, en mémoire)

| Champ | Type | Origine |
| --- | --- | --- |
| `messageId` | string | id Graph de la copie du message qui porte le fichier |
| `id` | string | id Graph de la pièce jointe |
| `name` | string | Graph |
| `size` | number | Graph (octets, indicatif) |
| `kind` | `file` \| `item` \| `reference` | `@odata.type` |
| `contentType` | string | Graph |

États dans le panneau :

```text
            ┌── décochée (par l'utilisateur) ──┐
recensée ───┤                                  ├── envoi ──► importée (uploadId)
            ├── à importer ────────────────────┘          └► échouée (raison)
            ├── trop lourde (taille > limite)  : affichée, non cochable
            └── non importable (lien cloud)    : affichée, non cochable
exclue (inline, winmail.dat, .ics) : jamais affichée
```

Règles :

- recensement sur les messages écrits : tous à la création, les nouveaux à l'enrichissement ;
- dédoublonnage par `nom + taille`, contre les autres candidats **et** contre les pièces jointes
  des messages déjà enregistrés ;
- un upload réussi est gardé pour la durée de vie du panneau (moins d'une heure) : une reprise
  après un échec de la note ne réimporte pas.

## 2. Fichier importé (Notion)

Upload Notion `status: uploaded`, référencé dans la colonne `Fichiers` (`NOTES_PROP_FILE`) :

```json
{ "type": "file_upload", "name": "Offre.pdf", "file_upload": { "id": "…" } }
```

Valide une heure avant attachement. Après attachement, Notion le renvoie en `type: "file"`.

## 3. Colonne Fichiers de Notes

| Propriété | Type | État | Usage |
| --- | --- | --- | --- |
| `Fichiers` | files | existe (vérifié 2026-10-03) | Pièces jointes du mail (cette feature) et de la dictée |

Écrite par le complément : à la création, dans les propriétés de la page ; à l'enrichissement,
dans le `PATCH` qui porte « Dernier message », par réécriture (existants + nouveaux), 100
entrées au plus.

## 4. États du panneau (ajouts à 001 data-model §5)

- `ready` porte en plus `files` (candidats) et `limit` (octets).
- `sending` porte une étape « Import des fichiers… x/y ».
- `sent` porte `imported` (nombre) et `skipped` (`{ name, reason }[]`).
