# Phase 0 — Recherche et décisions

**Feature** : Complément Outlook — mobile, manifeste et pièces jointes · **Date** : 2026-10-09

Les constats marqués **vérifié** l'ont été contre la documentation Microsoft ou Notion à jour,
ou contre le dépôt. Ceux marqués **à vérifier en direct** demandent un jeton que le conteneur
de développement n'a pas : un script les tranche avant la mise en production.

---

## A. Mobile

### A-1. La Nested App Authentication fonctionne sur Outlook iOS et Android — **vérifié**

C'était la condition préalable du brief : sans NAA, le panneau ne peut pas se connecter, les
jetons Exchange historiques ayant été coupés en octobre 2025.

Source : [Nested app auth requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/nested-app-auth-requirement-sets)
(mis à jour le 2026-03-31).

| Plateforme | NestedAppAuth 1.1 | Statut |
| --- | --- | --- |
| Outlook iOS | build **4.2433.0** | GA |
| Outlook Android | build **4.2433.0** | GA |

Restrictions : non pris en charge pour une boîte Outlook.com ou Gmail ajoutée à Outlook ; pas
de déclaration dans le manifeste (test à l'exécution, déjà fait par `supportsNaa()`). Les builds
4.2433 datent de septembre 2024 : tout téléphone à jour est au-dessus.

Décision : on code le mobile. Le message « Outlook trop ancien » cite désormais la build
mobile en plus de la version du poste.

### A-2. Déclaration mobile dans le manifeste XML — **vérifié**

Source : [Add support for add-in commands in Outlook on mobile devices](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/add-mobile-support).

- `MobileFormFactor` n'existe que dans `VersionOverridesV1_1`. Il va donc dans le bloc
  imbriqué, à côté du `DesktopFormFactor` qui porte déjà `SupportsPinning`.
- Point d'extension `MobileMessageReadCommandSurface`, avec un `Group` (pas d'`OfficeTab`),
  un contrôle `MobileButton`, pas de `Supertip` (l'info-bulle n'existe pas sur mobile).
- Icônes `bt:MobileIconList` : tailles 25, 32 et 48, chacune aux échelles 1, 2 et 3, soit
  neuf entrées. Fichiers distincts par échelle (25, 50, 75 / 32, 64, 96 / 48, 96, 144 px)
  pour rester nets sur les écrans 2x et 3x.
- Libellé du bouton : 16 caractères conseillés. « Save to Notion » en fait 14.
- Outlook mobile n'active un complément qu'en lecture de message : c'est notre seul cas.
- Le manifeste unifié (JSON) n'est **pas** pris en charge sur mobile : le choix du manifeste
  XML fait en 001 reste le bon.

### A-3. `openBrowserWindow` n'existe pas sur Outlook mobile — **vérifié**

Source : [Open Browser Window requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/open-browser-window-api-requirement-sets).
OpenBrowserWindowApi 1.1 n'est disponible, pour Outlook, que sur Windows classique et Mac.
« Outlook on Android : Not supported », iOS absent de la liste.

Le brief demande d'ouvrir les boutons Notion via `openBrowserWindow` : c'est impossible sur
mobile. Décision : on garde le chemin actuel d'`openExternal` — l'API de l'hôte quand le jeu
d'exigences est déclaré disponible, `window.open` sinon, qui ouvre le lien hors du panneau dans
Outlook mobile. La détection passe désormais par `isSetSupported("OpenBrowserWindowApi", "1.1")`
plutôt que par la seule présence de la fonction. Sur mobile, le passage par le schéma
`notion://` d'`openNotes` est sauté : il repose sur une perte de focus qu'un webview mobile ne
donne pas, et le lien https ouvre de toute façon l'application Notion si elle est installée.

### A-4. Le panneau au doigt — **vérifié dans le dépôt**

- Les champs de `ParticipantForm` sont en 14 px : iOS zoome sur tout champ de moins de 16 px.
  Correctif ciblé `pointer: coarse` dans `outlook.css`.
- Les cases à cocher font 16 px : la ligne entière devient la cible (`label`, 44 px de haut
  minimum).
- `outlook.css` rend déjà le défilement au document ; on ajoute la marge de sécurité basse
  (`env(safe-area-inset-bottom)`) et `touch-action: manipulation`.
- Le cadre est limité à 320 px de large : sur téléphone il prend toute la largeur utile
  (limite portée à 480 px, sans effet sur le poste où le panneau fait ~320 px).

---

## B. Pièces jointes : qui transporte les octets

### B-1. Contrainte

Une fonction Vercel accepte au plus 4,5 Mo de corps de requête. Le panneau ne peut donc pas
envoyer les fichiers. Le serveur doit les chercher lui-même chez Microsoft.

### B-2. Comment le serveur accède à Graph — décision : le jeton délégué du panneau

Trois options :

| Option | Nouvelle permission ou secret | Verdict |
| --- | --- | --- |
| **Le panneau transmet son jeton Graph délégué** (déjà obtenu pour lire le fil, portée `Mail.Read`) dans un en-tête, et le serveur l'utilise pour cette seule requête | Aucune | **Retenue** |
| On-Behalf-Of : le serveur échange le jeton d'API contre un jeton Graph | Un secret client sur l'inscription d'application, et `Mail.Read` déclarée côté API | Rejetée : secret à gérer et à faire tourner, configuration admin nouvelle |
| Permission d'application `Mail.Read` | Permission applicative, accès à **toutes** les boîtes du locataire | Rejetée : disproportionnée, consentement admin nouveau |

Pourquoi c'est sûr :

- Le jeton Graph n'ouvre rien chez nous : l'identité reste prouvée par le jeton d'API vérifié
  (constitution IV). Le jeton Graph n'est qu'un moyen de lire, et Graph le valide lui-même.
- Le serveur ne s'en sert que vers une URL fixe
  `https://graph.microsoft.com/v1.0/me/messages/{id}/attachments/{id}`, identifiants encodés :
  impossible de l'aiguiller ailleurs.
- Il vérifie que le jeton Graph désigne la même personne que le jeton d'API (FR-023). Le
  décodage de ses revendications se fait sans vérification de signature, et c'est suffisant :
  un jeton falsifié serait refusé par Graph à l'appel suivant, donc des revendications qui
  passent l'appel sont authentiques.
- Il ne le stocke ni ne le journalise. Il vit le temps de la requête.
- `Mail.Read` délégué couvre `GET /me/messages/{id}/attachments/{id}/$value` : aucune
  permission nouvelle (FR-021).

### B-3. Une requête par fichier — décision

`POST /api/outlook/attachments` reçoit `{ messageId, attachmentId }`, lit les métadonnées chez
Graph, télécharge le contenu, l'envoie à Notion et renvoie l'identifiant d'upload Notion.
Le panneau appelle cette route fichier par fichier, ce qui donne :

- la progression « x/y » sans canal de streaming ;
- un temps borné par fichier plutôt que par fil (`maxDuration` 300 s) ;
- un échec isolé : un fichier qui rate n'emporte pas les autres ni la note.

Les identifiants d'upload sont ensuite passés à la création ou à l'enrichissement de la note,
qui les attache à la colonne Fichiers **dans la même écriture que la marque « Dernier
message »**. C'est ce qui garantit l'absence de doublon (C-1).

Alternative rejetée : une route qui importe tout le fil en un appel. Une seule fonction de
plusieurs minutes, aucune progression, et un échec au 4ᵉ fichier perd les trois premiers.

### B-4. Fichiers de plus de 20 Mo — **vérifié**

Source : [Sending larger files](https://developers.notion.com/docs/sending-larger-files).
Le mode `single_part` s'arrête à 20 Mo. Au-delà, `multi_part` : parties de 5 à 20 Mo (la
dernière peut être plus petite), envoyées avec `part_number`, puis `POST
/file_uploads/{id}/complete`. Parties de 10 Mo, comme le recommande Notion. Le fichier est tenu
en mémoire dans la fonction (quelques dizaines de Mo, sous la mémoire allouée).

La logique d'upload de `functions/api/files.ts` (nom sûr, création puis envoi) passe dans
`functions/_lib/upload.ts`, enrichie du mode `multi_part`. `files.ts` (la dictée) l'utilise
sans changer de comportement : il garde son plafond de 20 Mo (constitution, un outil ne
modifie pas les routes d'un autre).

### B-5. Limite par fichier du workspace — **vérifié dans le dépôt**

`maxUploadBytes()` lit `bot.workspace_limits.max_file_upload_size_in_bytes` sur `/users/me`.
La même route expose cette limite au panneau (`GET /api/outlook/attachments`) pour qu'il marque
les fichiers trop lourds avant l'envoi ; le serveur la revérifie sur la taille réelle reçue.

La taille annoncée par Graph peut dépasser de quelques Ko celle du contenu. Le panneau s'en
sert pour l'affichage et le marquage ; seule la taille réelle fait foi côté serveur.

### B-6. Douzième fonction Vercel — **à noter**

Le plan Hobby plafonne à 12 fonctions (002, research E-1). Le dépôt en a 11 ; la route des
pièces jointes est la 12ᵉ. Le plafond est atteint : la prochaine route devra regrouper des
actions dans une route dynamique, comme `api/readai/[action].ts`.

---

## C. Notion

### C-1. Pas de doublon à l'enrichissement — décision

Trois garde-fous, du plus fort au plus faible :

1. **Seuls les nouveaux messages** fournissent des fichiers (même découpe que pour le texte).
2. **Atomicité avec la marque** : les fichiers sont écrits dans le même `PATCH` de propriétés
   que « Dernier message ». Si ce `PATCH` échoue, ni la marque ni les fichiers ne bougent ; la
   reprise refait les deux. S'il réussit, la marque avance et ces messages ne seront plus
   jamais « nouveaux ».
3. **Même nom et même taille** qu'un fichier d'un message déjà enregistré : écarté par le
   panneau (retransmissions).

Le `409` existant (note enrichie entre-temps) s'applique avant toute écriture : aucun fichier
n'est attaché dans ce cas.

### C-2. Conserver les fichiers existants — **à vérifier en direct**

Une mise à jour d'une colonne Fichiers **remplace** la liste ([Page properties](https://developers.notion.com/reference/page-property-values)).
Pour ajouter, il faut renvoyer les fichiers existants. Ils reviennent du `GET` de la page en
`type: "file"` avec une URL signée temporaire. La documentation ne dit pas explicitement que
Notion accepte ce renvoi.

Décision :

- Relire la page juste avant l'écriture (URL fraîche) et renvoyer chaque entrée existante telle
  quelle, suivie des nouveaux `file_upload`.
- **Repli sans perte** : si Notion refuse cette écriture (400), refaire le `PATCH` **sans** la
  colonne Fichiers. Les messages et la marque sont écrits, les fichiers existants ne sont pas
  touchés, et les nouveaux fichiers sont rendus au panneau comme non importés avec la raison.
  Rien n'est perdu en silence (VI) et rien n'est doublonné.
- `scripts/check-attachments.mjs` tranche la question sur la vraie base : il crée une page de
  test, y attache un fichier, en ajoute un second par renvoi, vérifie qu'il y en a deux, puis
  met la page à la corbeille. À lancer avant la mise en production.

### C-3. 100 fichiers par écriture — **vérifié**

Les tableaux d'une requête Notion sont limités à 100 éléments
([Request limits](https://developers.notion.com/reference/request-limits)). Au-delà de 100 fichiers
(existants compris), les suivants sont rendus comme non importés.

### C-4. Colonne absente

La dictée renvoie une erreur 500 si la colonne Fichiers manque. Pour le mail, la note compte
plus que les fichiers : elle est créée, et les fichiers sont rendus comme non importés avec la
raison « la base n'a pas de colonne fichiers ».

---

## D. Graph

### D-1. Métadonnées dans la lecture du fil — **vérifié**

L'expansion existante `$expand=attachments($select=name)` devient
`$select=id,name,size,isInline,contentType`. `@odata.type` est toujours renvoyé et distingue
`fileAttachment`, `itemAttachment` (mail joint) et `referenceAttachment` (lien cloud). Pas de
requête de plus.

### D-2. Exclusions

- `isInline: true` : images du corps (logos de signature, captures collées).
- `winmail.dat` ou type `application/ms-tnef` : enveloppe technique d'Outlook.
- `.ics` ou type `text/calendar` : invitation.
- `referenceAttachment` : pas d'octets à copier. **Affiché** comme non importable (« lien
  vers un fichier en ligne »), car l'utilisateur s'attend à le voir.

Les trois premières sont silencieuses (FR-011). Les noms continuent d'apparaître sous chaque
message comme aujourd'hui (FR-019) : ce bloc n'est pas modifié.

### D-3. Copies d'un même mail

`unique()` replie les copies d'un mail et garde les noms de la copie la plus riche. Les
pièces jointes suivent exactement la même règle, et chacune porte l'identifiant du message
auquel elle appartient réellement : le serveur télécharge donc toujours depuis la bonne copie.

### D-4. Contenu

`GET /me/messages/{id}/attachments/{id}/$value` renvoie les octets d'un `fileAttachment` et le
MIME d'un `itemAttachment` (enregistré en `.eml`).

---

## E. Le manifeste dans six mois

Relu avec la question du brief. Ce qui pourrait encore l'obliger à changer, et que cette
version ne peut pas trancher seule :

1. **Le domaine.** Toutes les URL pointent vers `mosaic.gouman.fr`. Si le complément doit
   passer sur un domaine de Mosaic, c'est un nouveau manifeste **et** une nouvelle redirection
   `brk-multihub://` sur l'inscription Entra.
2. **Écrire dans la boîte mail.** Marquer un mail « classé dans Notion » (catégorie Outlook)
   demanderait la permission `ReadWriteItem` au lieu de `ReadItem` : nouveau manifeste et
   nouveau consentement.
3. **Les boîtes partagées.** Utiliser le complément sur une boîte partagée ou déléguée
   demande `SupportsSharedFolders` dans le manifeste (et un autre chemin Graph que `/me`).
4. **Le manifeste unifié (JSON).** Microsoft y pousse, mais il n'est pas pris en charge sur
   mobile ; le XML reste la seule option pour cette feature.

Les trois premiers sont des décisions produit, posées à Théo avant la livraison.
