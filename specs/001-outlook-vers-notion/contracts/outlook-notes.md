# Contrat — `/api/outlook/notes`

Trois verbes sur une route : savoir, créer, enrichir.

Authentification : [auth.md](./auth.md). Satisfait FR-007, FR-008, FR-012, et FR-005 pour les
auteurs.

Sur Pages Functions : `onRequestGet`, `onRequestPost`, `onRequestPatch` — les trois verbes
sont supportés tels quels, sans migration (research E-1).

---

## `GET /api/outlook/notes?conversationId=…`

Dit si la conversation est déjà classée, et jusqu'où.

### Réponse `200`

```json
{ "note": { "id": "…", "url": "https://www.notion.so/…", "lastMessageId": "AAMk…" } }
```

ou, si rien n'existe :

```json
{ "note": null }
```

`lastMessageId` est `null` si la note existe mais que `Dernier message` est vide — cas d'une
note créée avant cette feature. Le panneau traite alors tous les messages comme nouveaux ;
mieux vaut un doublon visible dans le corps qu'un message perdu.

### Erreurs

| Cas | Statut | Corps |
| --- | --- | --- |
| `conversationId` absent | 400 | `{ "error": "Identifiant de conversation manquant" }` |
| `ID client` absente du schéma Notes | 500 | `` { "error": "La base de notes n'a pas de propriété « ID client »" } `` |
| Pas d'identité | 401 | voir [auth.md](./auth.md) |

---

## `POST /api/outlook/notes`

Crée la note et y écrit le fil.

### Requête

```json
{
  "conversationId": "AAQk…",
  "contactIds": ["…", "…"],
  "messages": [
    {
      "id": "AAMk…",
      "receivedAt": "2026-10-02T14:31:00Z",
      "from": { "name": "Jean Durand", "address": "jean@exemple.fr" },
      "text": "…",
      "attachmentNames": ["plan.pdf"]
    }
  ]
}
```

| Champ | Requis | Règles |
| --- | --- | --- |
| `conversationId` | oui | Non vide. Écrit dans `ID client`. |
| `contactIds` | oui | Au moins un. Dédoublonné. Un tableau vide est refusé : une note sans interlocuteur n'a pas sa place dans cette base. |
| `messages` | oui | Au moins un, triés du plus ancien au plus récent. Le serveur ne retrie pas : il fait confiance à l'ordre reçu et le documente ici. |

### Comportement

1. **Déduplication.** Filtre sur `ID client` = `conversationId`. Si une note existe, répondre
   `200` avec `{ "duplicate": true }` et **ne rien écrire** : c'est un enrichissement que
   l'appelant voulait, pas une création.
2. **Création de la page** depuis le modèle par défaut, avec `Interlocuteur`, `Date` (date du
   dernier message), `Auteur`, `Source` = `Email`, `ID client`, `Statut IA` = `À traiter`.
   `Transcription brute` n'est pas écrite.
3. **Attente du modèle.** Notion applique le modèle après la création ; `children` est
   interdit à la création. Interroger les enfants de la page par essais espacés, plafonnés.
   Au dépassement, ajouter quand même et renvoyer `"templateTimedOut": true` : l'ordre des
   blocs peut souffrir, le mail ne doit pas être perdu (research D-2, principe VI).
4. **Ajout des blocs**, par lots de 100, un callout par message (data-model §3).
5. **`Dernier message`** mis à `id` du dernier message ajouté, **après** l'ajout.

### Réponse `201`

```json
{ "id": "…", "url": "https://www.notion.so/…", "messagesAdded": 7, "templateTimedOut": false }
```

### Erreurs

| Cas | Statut | Corps |
| --- | --- | --- |
| `contactIds` vide | 400 | `{ "error": "Aucun interlocuteur à rattacher" }` |
| `messages` vide | 400 | `{ "error": "Aucun message à enregistrer" }` |
| Une propriété requise absente du schéma | 500 | message nommant la colonne |
| Page créée, blocs en échec | 502 | `{ "error": "…", "retry": true, "noteUrl": "…" }` — l'URL est renvoyée pour que le panneau puisse montrer la note partielle au lieu de laisser croire que rien n'a eu lieu |
| Pas d'identité | 401 | voir [auth.md](./auth.md) |

---

## `PATCH /api/outlook/notes`

Ajoute les messages nouveaux d'une conversation déjà classée.

### Requête

Identique au `POST`, plus :

```json
{ "noteId": "…", "sinceMessageId": "AAMk…" }
```

`sinceMessageId` est ce que le `GET` a rendu. Le serveur le revérifie contre `Dernier message`
de la page : s'ils diffèrent, quelqu'un d'autre a enrichi entre-temps, et la réponse est `409`
avec la vraie valeur. Le panneau recharge alors plutôt que d'écrire par-dessus.

### Comportement

1. Vérifier `sinceMessageId` contre `Dernier message`.
2. Ne garder que les messages postérieurs à cette borne (FR-008). Aucun message déjà intégré
   n'est réécrit.
3. Ajouter les blocs, par lots de 100.
4. Compléter `Interlocuteur` : union des contacts existants et des nouveaux, jamais un
   remplacement.
5. Compléter `Auteur` : l'utilisateur courant est **ajouté** à la liste existante s'il n'y est
   pas (FR-005, clarification de session).
6. Mettre `Date` à la date du dernier message, `Statut IA` à `À traiter`, `Dernier message` à
   l'`id` du dernier ajouté.

### Réponses

| Cas | Statut | Corps |
| --- | --- | --- |
| Messages ajoutés | 200 | `{ "id": "…", "url": "…", "messagesAdded": 3 }` |
| Rien de nouveau | 200 | `{ "id": "…", "url": "…", "messagesAdded": 0 }` |
| Borne obsolète | 409 | `{ "error": "La note a été enrichie entre-temps.", "lastMessageId": "…" }` |
| `noteId` absent | 400 | `{ "error": "Note introuvable" }` |
| Pas d'identité | 401 | voir [auth.md](./auth.md) |

---

## Vérification commune

- Vingt `POST` de la même conversation → une seule page (SC-002).
- Un `PATCH` rejoué → `messagesAdded: 0`, aucun bloc en double.
- Un message de 10 000 caractères → texte intégral dans Notion, découpé en paragraphes.
- Un fil de 60 messages → tous présents, plusieurs requêtes de blocs, progression affichée.
- Aucun appel sans identité n'aboutit.
- Aucune journalisation du contenu : relecture du code, aucun `console.log` sur `text`.
