# Contrat — `POST /api/outlook/contacts/match`

Reconnaît des adresses mail dans la base Contacts. Lecture seule.

Authentification : [auth.md](./auth.md). Satisfait FR-006.

## Requête

```json
{ "addresses": ["jean@exemple.fr", "Marie@Exemple.FR"] }
```

| Champ | Type | Règles |
| --- | --- | --- |
| `addresses` | `string[]` | 1 à 100 entrées. Normalisées côté serveur : espaces retirés, minuscules. Les doublons sont fusionnés. |

## Réponse `200`

```json
{
  "matched": {
    "jean@exemple.fr": { "id": "…", "name": "Jean Durand", "company": "Durand SAS" }
  },
  "unknown": ["marie@exemple.fr"]
}
```

Les clés de `matched` sont les adresses **telles que normalisées**, pas telles qu'envoyées.
Chaque adresse de la requête apparaît exactement une fois, dans `matched` ou dans `unknown`.

## Algorithme — une seule requête Notion

1. Un filtre composé : `{ "or": [ { "property": "Email", "email": { "contains": "<adresse>" } }, … ] }`.
   Une requête, quel que soit le nombre d'adresses ou de contacts (principe VII).
2. Pour chaque page rendue, découper la valeur de `Email` sur les virgules, trimmer, mettre en
   minuscules.
3. **Revérifier l'égalité exacte.** `contains` est une sous-chaîne : `o@m.com` trouverait
   `theo@m.com`. Sans cette étape, un contact serait rattaché à tort (research D-3).
4. Si deux contacts portent la même adresse, retenir le premier et l'indiquer dans la réponse
   par `"ambiguous": ["adresse"]` — la base a un défaut que le panneau doit montrer, non taire.

## Erreurs

| Cas | Statut | Corps |
| --- | --- | --- |
| `addresses` absent ou vide | 400 | `{ "error": "Aucune adresse à rechercher" }` |
| Plus de 100 adresses | 400 | `{ "error": "Trop d'adresses dans une seule requête" }` |
| Pas d'identité | 401 | voir [auth.md](./auth.md) |
| Notion en erreur | 502 | `{ "error": "…", "retry": true\|false }` via `fail()` |

## Vérification

- Un contact dont `Email` vaut `a@x.fr, b@x.fr` est trouvé sur `b@x.fr`.
- Une recherche de `b@x.fr` ne trouve pas un contact dont `Email` vaut `ab@x.fr`.
- Dix adresses en entrée → exactement une requête Notion (compteur de `notion()`).
