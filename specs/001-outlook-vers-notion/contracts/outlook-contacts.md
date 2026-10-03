# Contrat — `POST /api/outlook/contacts`

Crée un contact depuis le panneau. Reprend la logique de `functions/api/contacts.ts` et
ajoute l'écriture de `Email`, qu'aucune route n'écrit aujourd'hui (FR-014).

Authentification : [auth.md](./auth.md).

`functions/api/contacts.ts` **n'est pas modifiée** : la dictée continue de créer ses contacts
exactement comme avant.

## Requête

```json
{
  "name": "Marie Martin",
  "email": "marie@exemple.fr",
  "role": "Directrice financière",
  "types": ["Client"],
  "phones": [{ "country": "FR", "number": "+33612345678" }],
  "companyId": "…",
  "companyName": "Martin & Associés"
}
```

| Champ | Requis | Règles |
| --- | --- | --- |
| `name` | oui | Non vide après trim. Écrit dans la propriété de type `title`, ciblée par son type : son nom est vide dans ce schéma (research A-5). |
| `email` | oui | Une seule adresse à la création. Normalisée en minuscules. |
| `role`, `types`, `phones` | non | Mêmes règles que `contacts.ts`. |
| `companyId` | non | Société existante. Exclusif avec `companyName`. |
| `companyName` | non | Crée la société, comme `contacts.ts`. |

## Réponse `201`

```json
{ "id": "…", "name": "Marie Martin", "company": "Martin & Associés" }
```

La forme est celle que `/api/outlook/contacts/match` rend dans `matched`, pour que le panneau
traite un contact créé et un contact reconnu sans distinction.

## Erreurs

| Cas | Statut | Corps |
| --- | --- | --- |
| `name` ou `email` manquant | 400 | `{ "error": "Nom et adresse mail requis" }` |
| `companyId` et `companyName` ensemble | 400 | `{ "error": "Choisissez une société existante ou donnez-en une nouvelle" }` |
| `Email` absente du schéma Contacts | 500 | `` { "error": "La base Contacts n'a pas de propriété « Email »" } `` |
| Pas d'identité | 401 | voir [auth.md](./auth.md) |
| Notion en erreur | 502 | via `fail()` |

Le message d'erreur **nomme la colonne manquante**. Créer un contact sans son email le rendrait
invisible à toute reconnaissance future : l'échec doit être bruyant (principe VI).

## Non-idempotence, assumée

Deux appels identiques créent deux contacts. Il n'existe pas de clé d'unicité dans Contacts, et
en créer une est hors périmètre. Le panneau ne réémet jamais une création déjà réussie : il
garde l'identifiant obtenu, et un « Réessayer » ne reprend qu'à l'étape qui a échoué
(data-model §4).
