# Phase 1 — Modèle de données

**Feature** : Complément Outlook vers Notion · **Date** : 2026-10-03

Trois niveaux : ce que le panneau manipule en mémoire, ce que Notion stocke, et les états
par lesquels le panneau passe. Le schéma Notion ci-dessous a été relu en direct le
2026-10-03 (research A-1).

---

## 1. Entités en mémoire du panneau

Rien n'est persisté. Tout est reconstruit à chaque ouverture de mail, et perdu au changement
(FR-002).

### Conversation

| Champ | Type | Origine | Règles |
| --- | --- | --- | --- |
| `conversationId` | `string` | `Office.context.mailbox.item.conversationId` | Clé de déduplication. Absent ou vide → envoi refusé avec un message explicite. |
| `messages` | `Message[]` | Graph, trié côté client | Du plus ancien au plus récent (FR-004 scénario 4). Le tri est côté client : Graph refuse `$orderby` combiné à ce `$filter` (research C-2). |
| `participants` | `Participant[]` | Les champs `from`, `toRecipients`, `ccRecipients` de tous les messages | Dédoublonné sur l'adresse en minuscules. |
| `subject` | `string` | `item.subject` | Affiché, jamais écrit dans Notion : le titre est à Notion AI. |

### Message

| Champ | Type | Origine | Règles |
| --- | --- | --- | --- |
| `id` | `string` | `message.id` de Graph | Sert de borne pour `Dernier message`. |
| `receivedAt` | `string` ISO | `receivedDateTime` | Clé de tri. |
| `from` | `{ name, address }` | `from.emailAddress` | |
| `text` | `string` | `uniqueBody`, demandé en texte par `Prefer: outlook.body-content-type="text"` | `uniqueBody` exclut les citations des messages précédents, donc aucun message n'apparaît deux fois dans la note. Vide après nettoyage → le message est ignoré, mais son `id` compte quand même comme traité. |
| `attachmentNames` | `string[]` | `attachments[].name` | Les fichiers ne sont jamais téléchargés (FR-010). |

### Participant

| Champ | Type | Règles |
| --- | --- | --- |
| `address` | `string` | Comparée en minuscules, sans espaces. |
| `name` | `string` | Nom affiché Outlook, sert à préremplir le formulaire. |
| `internal` | `boolean` | Vrai si le domaine est dans `INTERNAL_DOMAINS` (défaut `mosaicfin.com`) ou si l'adresse est dans `USERS`. Les internes ne sont jamais candidats (FR non négociable : la base Notes reste orientée client). |
| `match` | `Contact \| null` | Rempli par `/api/outlook/contacts/match`. |
| `selected` | `boolean` | Préselectionné si `match` existe ; décochable dans tous les cas (US2 scénario 3). |
| `draft` | `ContactDraft \| null` | Présent seulement si `match` est nul et que la ligne est cochée. |

**Invariant** : un même contact reconnu sous deux adresses du même fil produit **une** entrée
de relation, pas deux (cas limite de la spec). Le dédoublonnage se fait sur l'identifiant de
page Notion, après le match, pas sur l'adresse.

### ContactDraft

Les champs de `src/components/contact-form.tsx` tels qu'ils existent — nom, fonction,
téléphones par pays, types, société existante ou nouvelle — plus **`email`**, nouveau et
prérempli depuis le participant. Un brouillon coché et incomplet désactive l'envoi (US2
scénario 4) ; un brouillon survit à un échec d'envoi (US4 scénario 2).

---

## 2. Schéma Notion

### Base Notes — `NOTION_NOTES_DB`

| Propriété | Type | État réel au 2026-10-03 | Rôle Outlook |
| --- | --- | --- | --- |
| `Sujet` | title | existe | Écrit par Notion AI. Jamais écrit par le complément. |
| `Interlocuteur` | relation → Contacts | existe, `single_property` | Tous les contacts retenus du fil. **La limite de pages doit être constatée dans l'interface** (research A-2). |
| `Date` | date | existe | Date du dernier message du fil. |
| `Auteur` | people | existe | Le collaborateur, via `users.ts`. À l'enrichissement, l'auteur est **ajouté** à la liste existante sans remplacer (FR-005). |
| `Transcription brute` | rich_text | existe | **Non utilisée par le mail.** Le fil va dans le corps de la page. |
| `Note détaillée` | rich_text | existe | Écrite par Notion AI. |
| `Résumé IA` | rich_text | existe | Écrite par Notion AI. |
| `Fichiers` | files | existe | Non utilisée par le mail (FR-010). |
| `Société` | rollup | existe | Dérivée du contact ; rien à écrire. |
| `Projet` | relation | existe | Hors périmètre. |
| `Information` | formula | existe | Dérivée. |
| `ID client` | rich_text | **à créer** | `conversationId`. Clé de déduplication (FR-007). |
| `Source` | select `Dictée` / `Email` | **à créer** | FR-012. La dictée écrit `Dictée`, le mail `Email`. |
| `Dernier message` | rich_text | **à créer** | `id` Graph du dernier message intégré. Borne de l'enrichissement (FR-008). |
| `Statut IA` | select `À traiter` / `Traité` | **à créer** | Remis à `À traiter` à chaque création et à chaque enrichissement. |

Toute écriture est conditionnée à la présence de la propriété dans le schéma lu, comme le
fait déjà `functions/api/notes.ts`. Une propriété manquante dont dépend une exigence donne
une erreur explicite nommant la colonne, jamais un abandon silencieux (principe VI) — le
précédent du `Fichier` / `Fichiers` a coûté assez cher pour que la règle soit sans exception.

### Base Contacts — `NOTION_CONTACTS_DB`

| Propriété | Type | État réel | Rôle Outlook |
| --- | --- | --- | --- |
| `""` (titre) | title | existe, **nom vide** | Nom du contact. Ciblé par son type, jamais par son nom (research A-5). |
| `Email` | email | existe | Reconnaissance et écriture à la création (FR-006, FR-014). Plusieurs adresses séparées par `, ` — vérifié par sonde (research A-4). |
| `Fonction` | rich_text | existe | Formulaire. |
| `Société` | relation → Sociétés | existe | Formulaire. |
| `Type` | multi_select | existe | Formulaire. |
| `Téléphone`, `Téléphone FR`, `Téléphone CH` | phone_number | existent | Formulaire. |
| `Nom société` | — | **n'existe pas** | `CONTACTS_PROP_COMPANY_ROLLUP` la désigne à tort ; le repli du code résout le nom (research A-3). |

---

## 3. Corps de la page — un message, un bloc

Pour chaque message, dans l'ordre chronologique :

```text
callout  « Échange du 3 octobre 2026 »        (date du message, mois en français)
  ├── divider
  ├── paragraph  …contenu…                    (2 000 caractères maximum par paragraphe)
  ├── paragraph  …suite…
  └── paragraph  « Pièces jointes : plan.pdf, photo.jpg »   (seulement s'il y en a)
```

Contraintes de l'API respectées (research D-1) : deux niveaux d'imbrication par requête,
100 blocs par requête, 2 000 caractères par élément de rich text. Le découpage réutilise
`richText()` de `functions/api/notes.ts`, déjà écrit et éprouvé.

Une ligne vide du mail ouvre un nouveau paragraphe. Au-delà de 100 blocs, plusieurs requêtes
successives, et le panneau affiche la progression (cas limite « fil très long »).

---

## 4. Clés de déduplication et effet d'un rejeu

| Écriture | Clé | Effet d'un second envoi identique |
| --- | --- | --- |
| Création de note | `ID client` = `conversationId` | La note existante est retrouvée et renvoyée avec `duplicate: true`. Aucune page créée. Même mécanisme que la dictée. |
| Enrichissement | `Dernier message` | Seuls les messages postérieurs sont ajoutés. Un rejeu n'ajoute rien. |
| Création de contact | aucune | **Un rejeu crée un doublon.** Atténuation : le panneau crée les contacts avant la note, en série, et ne réémet pas une création déjà réussie lors d'un « Réessayer » — l'identifiant obtenu est conservé dans l'état du panneau. Rendre la route elle-même idempotente demanderait une clé d'unicité dans Contacts, hors périmètre. |
| Ajout de blocs | aucune | Atténuation : les blocs ne sont ajoutés qu'après que `Dernier message` a été lu, et `Dernier message` n'est mis à jour qu'après l'ajout. Un échec entre les deux laisse des blocs sans mise à jour de la borne, donc un rejeu les dupliquerait. Le panneau signale alors l'état incertain et propose d'ouvrir la note plutôt que de réessayer en aveugle (principe VI : visible, jamais silencieux). |

---

## 5. États du panneau

```text
                 ┌──────────────┐
                 │ incompatible │  NestedAppAuth 1.1 absent (research B-2)
                 └──────────────┘
                        ▲
   Office.onReady ──────┤
                        ▼
   ┌────────────┐   ┌──────────┐   ┌──────────────────┐
   │ chargement │──▶│ protégé  │   │ aucun externe    │  envoi refusé
   └────────────┘   └──────────┘   └──────────────────┘
          │
          ├──────────────▶ nouvelle conversation ──┐
          ├──────────────▶ note existante ─────────┤──▶ envoi ──▶ succès
          └──────────────▶ note à jour             │              │
                                                   │              ▼
                                                   └──────────▶ erreur ──▶ (retour à l'état d'envoi, saisie intacte)
```

| État | Déclencheur | Ce qui est conservé |
| --- | --- | --- |
| `incompatible` | `isSetSupported('NestedAppAuth','1.1')` faux | — |
| `chargement` | `Office.onReady` | — |
| `protégé` | corps illisible (mail chiffré) | — |
| `aucun externe` | tous les participants internes | — |
| `nouvelle conversation` | `GET notes` → aucune note | les brouillons et les cases cochées |
| `note existante` | `GET notes` → note + messages postérieurs | idem |
| `note à jour` | `GET notes` → note, aucun message postérieur | — ; aucun bouton d'envoi |
| `envoi` | clic | tout gelé, bouton désactivé |
| `succès` | réponse de Notion | lien vers la page |
| `erreur` | échec réseau ou Notion | **toute la saisie**, plus un bouton « Réessayer » (US4) |

**Changement de mail avec panneau épinglé** : `Office.EventType.ItemChanged` réinitialise
l'état. Si un brouillon de contact est en cours, une confirmation est demandée avant de le
perdre (cas limite de la spec).
