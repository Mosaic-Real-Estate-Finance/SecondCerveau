# Phase 1 — Modèle de données

## 1. Entrée : rapport Read AI (`meeting_end`)

Seuls ces champs sont lus ; tout le reste du payload est ignoré et jamais stocké.

| Champ | Type | Usage |
| --- | --- | --- |
| `request_id` | string | dédoublonnage des envois |
| `trigger` | `meeting_end` \| `meeting_start` | seul `meeting_end` est traité |
| `session_id` | string | clé de repli |
| `title` | string | titre de la note |
| `start_time`, `end_time` | ISO UTC | `Date`, horodatage relatif |
| `participants[]`, `owner` | `{ name, first_name, last_name, email \| null }` | filtrage, auteurs, rapprochement |
| `summary` | string | callout Résumé |
| `transcript.speaker_blocks[]` | `{ start_time: "ms", speaker: { name }, words }` | callout Transcription |
| `platform`, `platform_meeting_id` | string | clé de réunion |
| `report_url` | string | affiché dans l'écran |

## 2. Entités calculées

### Meeting (forme normalisée, la seule conservée)

```ts
type Meeting = {
  sessionId: string;
  title: string;
  start: string;          // ISO
  end: string | null;
  owner: Person | null;
  summary: string;
  blocks: { at: number; speaker: string; words: string }[];  // at = ms relatifs
  platform: string;
  platformMeetingId: string | null;
  reportUrl: string | null;
};
type Person = { name: string; email: string | null };
```

### Répartition des participants

| Groupe | Règle | Devient |
| --- | --- | --- |
| sans email | `email` null ou vide | ignoré |
| interne | domaine ∈ `INTERNAL_DOMAINS` | auteur s'il figure dans `users.ts` |
| exclu | externe dont l'email ∈ liste d'exclusion | ignoré |
| externe pertinent | le reste | rapproché |

### Résultat du rapprochement, par externe pertinent

| Statut | Condition | Données |
| --- | --- | --- |
| `recognized` | email exact sur un seul contact | `{ contactId, name, company }` |
| `ambiguous` | email exact sur plusieurs contacts | `candidates: Contact[]` |
| `unknown` | aucun email exact | `companies: { id, name }[]` (vide si domaine générique ou inconnu) |

### Issue d'un rapport

| Issue | Condition |
| --- | --- |
| `ignored` | aucun externe pertinent |
| `noted` | tous reconnus → note créée (ou complétée) |
| `queued` | au moins un `ambiguous` ou `unknown` |
| `merged` | même réunion déjà en attente ou déjà notée |
| `error` | exception pendant le traitement |

## 3. Redis

Préfixes : `readai:` pour la synchronisation, `auth:` pour la connexion, `push:` pour les
notifications. Toute valeur JSON est sérialisée par le client.

| Clé | Type | TTL | Contenu |
| --- | --- | --- | --- |
| `readai:req:<request_id>` | string | 30 j | `1` — envoi déjà reçu |
| `readai:lock` | string | 280 s | jeton du détenteur — verrou unique (research C-3) |
| `readai:meeting:<clé réunion>` | string | aucun, supprimée avec l'élément | `{ itemId }` de l'élément en attente |
| `readai:item:<id>` | JSON | aucun | `QueueItem` |
| `readai:items` | zset | aucun | `id` → score = début de réunion (ms) |
| `readai:recent` | hash | entrées purgées après 3 j | `clé` → `{ t: sha(titre), s: début ms, x: sha(emails externes)[], at }` |
| `readai:excluded` | set | aucun | emails exacts |
| `auth:code:<email>` | JSON | 600 s | `{ hash, tries }` |
| `auth:cool:<email>` | string | 60 s | `1` |
| `auth:hour:<email>` | int | 3600 s | nombre d'envois |
| `auth:revoked:<jti>` | string | jusqu'à `exp` | `1` |
| `push:subs` | hash | aucun | `sha(endpoint)` → `{ email, subscription }` |

### QueueItem

```ts
type QueueItem = {
  id: string;                    // aléatoire, 16 hex
  key: string;                   // clé de réunion
  kind: "new" | "complete";      // complete = compléter une note existante
  status: "pending" | "error";
  stage?: "process" | "close";   // où l'erreur a eu lieu
  error?: string;                // message court, sans contenu de réunion
  createdAt: string;
  noteId?: string;               // kind = complete
  noteUrl?: string;
  meeting: Meeting | Omit<Meeting, "summary" | "blocks">;  // sans contenu si kind = complete
  authors: string[];             // emails d'utilisateurs
  recognized: { email: string; contactId: string; name: string; company: string }[];
  people: PendingPerson[];
};

type PendingPerson = {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  companies: { id: string; name: string }[];   // suggestions par domaine
  candidates: { id: string; name: string; company: string }[];  // doublon dans la base
  decision?:
    | { action: "attach"; contactId: string; name: string; company: string; by: string; at: string }
    | { action: "create"; contactId: string; name: string; company: string; by: string; at: string }
    | { action: "exclude"; by: string; at: string };
};
```

### Transitions

```text
              tous tranchés, ≥1 contact     ┌──────────┐
 pending ───────────────────────────────────▶ (supprimé) + note créée / complétée
   │  ▲       tous tranchés, 0 contact       └──────────┘
   │  │       ignorer l'appel  ─────────────▶ (supprimé), rien dans Notion
   │  │
   │  └── réessayer (stage = close) ────────┐
   ▼                                        │
 error ◀── échec de création de la note ────┘
   │
   └── réessayer (stage = process) : le traitement complet est rejoué
```

Une personne tranchée garde sa décision dans tous les états : un réessai ne recrée jamais un
contact (`decision.contactId` est réutilisé).

## 4. Notion

### Note créée (base Notes)

| Propriété | Valeur | Condition |
| --- | --- | --- |
| titre | `meeting.title` (« Réunion Read AI » s'il est vide) | toujours |
| `Date` | `{ start: meeting.start }` (ISO avec heure) | colonne de type `date` |
| `Source` | `{ select: { name: "ReadAI" } }` | option présente, sinon erreur de configuration |
| `Auteur` | `people` = utilisateurs présents | colonne de type `people` |
| `Interlocuteur` | `relation` = tous les contacts retenus | toujours |
| `ID client` | clé de réunion | exigée |
| `Statut IA`, `Transcription brute` | jamais écrites | — |

Corps : callout « Résumé » (un paragraphe par bloc de texte du résumé), callout
« Transcription » (un paragraphe par intervention : **Nom** ` (mm:ss) — texte`).

### Contact rattaché

`Email` ← valeur existante + `, ` + nouvelle adresse, si l'adresse n'y est pas déjà.

### Contact créé

Par `createContact()` existant, avec `email` renseigné.
