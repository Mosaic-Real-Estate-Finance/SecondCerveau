# Contrat — routes de l'écran « À valider » (`/api/readai/:action`)

Toutes exigent une session (cookie `mosaic_session`) ; sans elle : 401
`{ error, code: "session" }`. Une seule fonction serveur (`api/readai/[action].ts`).

## `GET /api/readai/items`

`200 { items: ItemView[], excluded: string[], count: number }`. `?count=1` ne rend que
`{ count }` (une commande Redis).

`ItemView` = `QueueItem` sans `meeting.blocks` (la transcription ne quitte jamais le serveur
vers l'écran). Tri : réunion la plus récente d'abord.

## `POST /api/readai/decide`

```json
{ "itemId": "…", "email": "personne@ex.com", "action": "attach", "contactId": "…" }
{ "itemId": "…", "email": "…", "action": "create", "contact": { "name": "…", "role": "…", "phones": [], "types": [], "companyId": "…" } }
{ "itemId": "…", "email": "…", "action": "exclude" }
```

| Cas | Statut | Corps |
| --- | --- | --- |
| Décision enregistrée, reste des personnes | 200 | `{ item: ItemView }` |
| Dernière décision, note créée ou complétée | 200 | `{ closed: true, noteUrl }` |
| Dernière décision, aucun contact retenu | 200 | `{ closed: true, noteUrl: null }` |
| Élément ou personne inconnus | 404 | `{ error }` |
| Personne déjà tranchée | 409 | `{ error: "Déjà traité", code: "decided" }` |
| Création de la note échouée | 502 | `{ error, retry: true, item }` — élément en `error`, décisions gardées |

`create` : nom requis ; l'email est celui de la personne, jamais celui du formulaire.
`attach` : l'adresse est ajoutée à la colonne `Email` du contact choisi.
`exclude` : l'adresse rejoint `readai:excluded`.

## `POST /api/readai/ignore`

`{ itemId }` → `200 { closed: true }`. Rien dans Notion, aucune exclusion.

## `POST /api/readai/retry`

`{ itemId }` → mêmes réponses que la dernière décision de `decide`, ou `{ item }` si le
traitement rejoué remet l'élément en attente.

## `POST /api/readai/excluded`

`{ email, action: "remove" }` → `200 { excluded: string[] }`.

## `POST /api/readai/push` · `DELETE /api/readai/push`

POST `{ subscription: PushSubscriptionJSON }` → `201 { ok: true }`. DELETE
`{ endpoint }` → `200 { ok: true }`.
