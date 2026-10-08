# Contrat — `POST /api/readai/webhook`

Appelant : Read AI (webhook de workspace). Authentification : signature, et elle seule.

## Requête

- En-tête `X-Read-Signature` : HMAC-SHA256 hexadécimal du corps brut, clé =
  `base64decode(READAI_WEBHOOK_SECRET)`.
- Corps : JSON brut, schéma standard Read AI (voir `data-model.md` §1).

## Réponses

| Cas | Statut | Corps | Effet |
| --- | --- | --- | --- |
| Signature absente, fausse, ou secret non configuré | 401 | `{ error }` | aucun |
| Corps illisible (signé mais pas du JSON) | 200 | `{ ok: true, ignored: "payload" }` | journal technique sans contenu |
| `trigger` ≠ `meeting_end` | 200 | `{ ok: true, ignored: "trigger" }` | aucun |
| `request_id` déjà vu | 200 | `{ ok: true, duplicate: true }` | aucun |
| Stockage indisponible | 503 | `{ error }` | Read AI réessaiera |
| Accepté | 200 | `{ ok: true }` | traitement en arrière-plan |

Temps de réponse visé : < 2 s, indépendant de la taille de la transcription.

## Traitement en arrière-plan

Issue `ignored` | `noted` | `queued` | `merged` | `error` (voir `data-model.md`). Aucune issue
n'est silencieuse sauf `ignored`, qui est le filtrage voulu.
