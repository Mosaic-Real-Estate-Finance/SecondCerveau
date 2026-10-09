# Contrat — `/api/outlook/attachments`

Authentification : `Authorization: Bearer <jeton d'API>` comme toutes les routes du complément
(001, contracts/auth.md). Sinon 401.

## GET — limite par fichier

Réponse 200 :

```json
{ "maxBytes": 5368709120 }
```

`maxBytes` : limite par fichier du workspace Notion (`/users/me`), mise en cache 30 min.

## POST — importer une pièce jointe

En-têtes :

- `Authorization: Bearer <jeton d'API>`
- `X-Graph-Token: <jeton Graph délégué, portée Mail.Read>`

Corps :

```json
{ "messageId": "AAMk…", "attachmentId": "AAMk…" }
```

Déroulé : métadonnées Graph (`$select=name,size,contentType,isInline`) → refus des exclusions →
téléchargement de `$value` (arrêt dès que la taille dépasse la limite) → upload Notion
(`single_part` ≤ 20 Mo, `multi_part` au-delà, parties de 10 Mo) → identifiant.

Réponses :

| Statut | Corps | Sens |
| --- | --- | --- |
| 200 | `{ "id": "…", "name": "Offre.pdf", "size": 6291456 }` | importé, `id` = file upload Notion |
| 200 | `{ "skipped": true, "reason": "Fichier trop lourd : 6,2 Mo, maximum 5 Mo." }` | non importé, raison à afficher |
| 400 | `{ "error": "…" }` | corps ou jeton Graph manquant |
| 401 | `{ "error", "code" }` | jeton d'API invalide |
| 403 | `{ "error": "Ce jeton Microsoft n'est pas le tien." }` | le jeton Graph désigne une autre personne |
| 502 | `{ "error", "retry": true }` | Graph ou Notion en échec |

Le panneau traite 400, 403 et 502 comme « non importé » avec la raison : la note est écrite
quand même.

Journalisation : aucun nom, aucun contenu. Seuls statuts et identifiants techniques.
