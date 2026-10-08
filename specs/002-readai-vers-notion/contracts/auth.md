# Contrat — authentification de la PWA

## `POST /api/auth/code`

`{ email }` → toujours `200 { ok: true }` pour une adresse bien formée, qu'elle soit autorisée
ou non. Un code n'est envoyé qu'aux adresses de `users.ts`.

| Cas | Statut | Corps |
| --- | --- | --- |
| Adresse mal formée | 400 | `{ error }` |
| Moins d'une minute depuis le dernier envoi | 429 | `{ error: "Attendez une minute avant de redemander un code." }` |
| Plus de 5 envois dans l'heure | 429 | `{ error: "Trop de codes demandés, réessayez dans une heure." }` |
| Stockage indisponible | 503 | `{ error }` |

## `POST /api/auth/verify`

`{ email, code }` → `200 { email, firstName }` + `Set-Cookie: mosaic_session=…; HttpOnly;
Secure; SameSite=Strict; Path=/; Max-Age=7776000`.

Échec : `401 { error: "Code incorrect ou expiré." }`, identique pour un code faux, expiré,
épuisé, ou une adresse non autorisée. Le 5e essai faux supprime le code.

## `POST /api/auth/logout`

Révoque le `jti` de la session courante jusqu'à son expiration, efface le cookie. `200 { ok }`.

## `GET /api/session` · `POST /api/session`

Session valide → `200 { email, firstName }` et cookie réémis pour 90 jours (glissement).
Sinon `401`.

## `guard()`

Ordre : en-tête `Authorization: Bearer` (chemin Microsoft du complément, inchangé) ; sinon
cookie `mosaic_session` (signature, expiration, révocation, adresse toujours dans
`users.ts`). L'en-tête `x-user-email` n'est plus lu.
