# Contrat — Authentification

**Module** : `functions/_lib/auth.ts` (nouveau), appelé par `guard()` dans
`functions/_lib/notion.ts`.

Toute route de ce dépôt — dictée comprise — passe par `guard()`. Ce contrat remplace son
contenu actuel sans changer sa signature, donc sans toucher une seule route existante.

## Aujourd'hui

```ts
export function guard(request, env): { user: User } | Response {
  const user = findUser(request.headers.get("x-user-email"));
  if (!user) return json({ error: "Adresse non autorisée" }, 401);
  return { user };
}
```

Un en-tête suffit. Comme le dit le commentaire du fichier : « an address alone lets someone
in, so it identifies the author rather than proving who they are. »

## Demain

```ts
export async function identify(request: Request, env: Env): Promise<User | null>;
```

Deux chemins, dans cet ordre :

1. **`Authorization: Bearer <jwt>`** — jeton d'accès Microsoft. Vérifié avec `jose` :
   - signature contre les JWKS de l'émetteur, récupérés et mis en cache ;
   - `iss` : émetteur Microsoft attendu ;
   - `aud` : `ENTRA_API_CLIENT_ID` ;
   - `exp` / `nbf` ;
   - `tid` ∈ `ENTRA_TENANT_IDS`.

   L'email vient de la revendication du jeton (`preferred_username`, repli `upn`, repli
   `email`), puis `findUser(email)`.

2. **`x-user-email`** — repli PWA, comportement actuel inchangé.

`guard()` devient asynchrone et renvoie 401 si `identify` donne `null`.

## Règles non négociables

- **Jamais l'ID token.** Microsoft qualifie sa validation côté service d'anti-patron de
  sécurité. Le panneau demande un jeton d'accès pour un scope de l'API exposée, et c'est ce
  jeton-là qui voyage (research B-3).
- **Un Bearer invalide n'est jamais rattrapé par le repli.** Si l'en-tête `Authorization` est
  présent mais le jeton mauvais, la réponse est 401 : sinon il suffirait d'ajouter un
  `x-user-email` à côté d'un faux Bearer pour contourner toute la vérification.
- **Le compte Outlook doit figurer dans `USERS`.** Un jeton Microsoft valide d'un collaborateur
  absent de la liste est rejeté en 401 — l'identité est prouvée, l'autorisation ne l'est pas.

## Réponses

| Cas | Statut | Corps |
| --- | --- | --- |
| Jeton valide, utilisateur connu | — | la route continue |
| Aucune identité | 401 | `{ "error": "Adresse non autorisée" }` |
| Bearer invalide, expiré, mauvais `aud` | 401 | `{ "error": "Session Microsoft invalide, reconnectez-vous." }` |
| Bearer d'un tenant non autorisé | 401 | `{ "error": "Ce compte n'appartient pas à une organisation autorisée." }` |
| Jeton valide, utilisateur absent de `USERS` | 401 | `{ "error": "Adresse non autorisée" }` |
| Configuration serveur incomplète | 500 | `{ "error": "Configuration serveur incomplète" }` |

## Vérification

- `curl` sans en-tête sur chacune des quatre routes `/api/outlook/*` → 401.
- `curl` avec un Bearer forgé → 401.
- `curl` avec un Bearer valide d'un autre tenant → 401.
- Le parcours complet de la dictée, inchangé, avec son seul `x-user-email` → fonctionne.

## Variables d'environnement

| Nom | Rôle | Défaut |
| --- | --- | --- |
| `ENTRA_API_CLIENT_ID` | audience attendue des jetons | — (requis pour le chemin Bearer) |
| `ENTRA_TENANT_IDS` | tenants autorisés, séparés par des virgules | — (requis pour le chemin Bearer) |
| `INTERNAL_DOMAINS` | domaines considérés internes | `mosaicfin.com` |

Les deux premières absentes : le chemin Bearer est désactivé et seul le repli PWA fonctionne.
C'est ce qui permet de développer les phases 1 à 3 avant la phase 4.
