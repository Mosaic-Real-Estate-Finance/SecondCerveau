# Feature Specification: Complément Outlook — mobile, manifeste de production et pièces jointes

**Feature Branch**: `claude/determined-tesla-v86syo`

**Created**: 2026-10-09

**Status**: Implémentée — test sur un vrai fil en attente (T024)

**Input**: Brief « Nouvelle évolution du complément Outlook (feature 003) », 2026-10-09, @Théo Gouman

Deux évolutions du complément Outlook livrées ensemble, parce que l'une impose un nouveau
manifeste et que chaque nouveau manifeste oblige l'administrateur Mosaic à le redéployer.

1. **Le manifeste de production.** Nom et bouton « Save to Notion », une info-bulle qui dit
   ce que fait vraiment le panneau (rattacher un échange à plusieurs contacts), et la prise
   en charge d'Outlook sur iPhone et Android. Objectif : ne plus toucher au manifeste avant
   longtemps.
2. **Les pièces jointes.** Les fichiers joints aux messages du fil arrivent dans la colonne
   « Fichiers » de la note, à côté du texte, au lieu d'y être seulement nommés.

**Pourquoi.** Un échange avec un contact, c'est souvent un document : une offre, un mandat,
une présentation. Le nom du fichier dans la note ne suffit pas à le retrouver six mois plus
tard. Et les collaborateurs de Mosaic lisent leurs mails autant sur leur téléphone que sur
leur poste : un complément absent du mobile est un complément qu'on oublie.

## Clarifications

### Session 2026-10-09

- Q: La connexion fonctionne-t-elle sur Outlook mobile ? Sans elle, le panneau ne peut rien
  faire, puisqu'il n'existe plus d'autre mécanisme d'identification. → A: Oui. Microsoft
  documente la Nested App Authentication comme disponible en production (GA) sur Outlook iOS
  et Outlook Android, à partir de la build 4.2433.0 sur les deux plateformes, pour les comptes
  professionnels Microsoft 365 (pas pour Outlook.com ni Gmail). Voir research A-1.
- Q: Le panneau envoie-t-il les fichiers au serveur ? → A: Non. Le serveur est limité à
  4,5 Mo par requête. Le panneau envoie seulement la référence de chaque pièce jointe ; le
  serveur la télécharge chez Microsoft et l'envoie lui-même à Notion. Voir research B.
- Q: Une nouvelle permission Microsoft est-elle nécessaire ? → A: Non. La lecture des pièces
  jointes est couverte par la permission déléguée de lecture du courrier déjà consentie.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Les pièces jointes d'un fil arrivent dans la note (Priority: P1)

Un collaborateur ouvre un fil avec un contact, où trois messages portent un PDF, une
présentation et un tableur. Avant d'envoyer, le panneau annonce « 3 fichiers · 14,2 Mo
seront joints ». Il envoie. Le panneau affiche « Import des fichiers… 1/3 », puis 2/3, 3/3,
puis le succès : « 3 fichiers importés ». Dans Notion, la colonne « Fichiers » de la note
contient les trois fichiers, et chaque nom reste listé sous son message dans le corps de la
note, comme avant.

**Why this priority**: C'est la valeur nouvelle de la feature.

**Independent Test**: Sur un fil de trois messages avec pièces jointes dont une de plus de
5 Mo, créer la note : les trois fichiers sont dans la colonne Fichiers et s'ouvrent.

**Acceptance Scenarios**:

1. **Given** un fil dont les messages portent des pièces jointes, **When** on ouvre le
   panneau, **Then** il affiche le nombre de fichiers qui seront joints et leur taille totale.
2. **Given** ce fil, **When** on crée la note, **Then** la progression « Import des
   fichiers… x/y » s'affiche, et le succès indique le nombre de fichiers importés.
3. **Given** la note créée, **When** on l'ouvre dans Notion, **Then** chaque fichier est dans
   la colonne Fichiers, et son nom figure sous son message dans le corps de la note.
4. **Given** un message dont le corps contient des images (logo de signature, capture collée),
   **When** la note est créée, **Then** ces images ne sont pas importées comme fichiers.
5. **Given** un message qui porte un `winmail.dat` ou une invitation `.ics`, **When** la note
   est créée, **Then** ces fichiers ne sont pas importés.
6. **Given** un fichier de plusieurs dizaines de Mo, sous la limite du workspace Notion,
   **When** la note est créée, **Then** il est importé.

---

### User Story 2 - Choisir les fichiers, et savoir lesquels n'ont pas pu être importés (Priority: P1)

Le panneau liste les fichiers qui seront joints, chacun avec une case cochée. Le collaborateur
décoche le tableur qui n'a rien à faire dans le CRM : le total se met à jour. Un fichier
au-dessus de la limite du workspace est affiché décoché et non cochable, avec la raison. Si
l'import d'un fichier échoue en cours de route, la note est quand même créée, et l'écran de
succès liste le fichier comme non importé, avec la raison.

**Why this priority**: Sans contrôle, le CRM se remplit de pièces sans intérêt ; sans
compte rendu, un fichier manquant passe inaperçu (constitution, principe VI).

**Independent Test**: Décocher une pièce jointe sur trois et créer la note : seules deux
arrivent. Avec un fichier au-dessus de la limite : la note est créée, le fichier est listé
comme non importé, avec sa taille et la limite.

**Acceptance Scenarios**:

1. **Given** la liste des fichiers, **When** on décoche un fichier, **Then** le nombre et la
   taille totale annoncés se mettent à jour, et ce fichier n'est pas importé.
2. **Given** un fichier plus lourd que la limite du workspace Notion, **When** le panneau
   s'affiche, **Then** ce fichier est marqué « trop lourd » avec sa taille et la limite, et
   ne peut pas être coché.
3. **Given** un fichier dont l'import échoue, **When** l'envoi se termine, **Then** la note
   existe, les autres fichiers y sont, et l'écran de succès liste le fichier non importé et
   la raison.
4. **Given** tous les fichiers décochés, **When** on crée la note, **Then** la note est créée
   sans fichier, exactement comme avant cette feature.

---

### User Story 3 - Enrichir une note sans doublonner les fichiers (Priority: P1)

Le fil s'est poursuivi : deux nouveaux messages, dont un avec un PDF. Le collaborateur
enrichit la note. Seul le nouveau PDF est ajouté à la colonne Fichiers ; les fichiers déjà
présents y restent, et aucun n'apparaît deux fois.

**Why this priority**: L'enrichissement est le chemin quotidien d'un fil suivi ; un doublon
à chaque enrichissement rendrait la colonne inutilisable.

**Independent Test**: Créer une note sur un fil avec une pièce jointe, répondre avec une
nouvelle pièce jointe, enrichir : la colonne contient deux fichiers, pas trois.

**Acceptance Scenarios**:

1. **Given** une note existante et un fil enrichi de nouveaux messages avec pièces jointes,
   **When** on enrichit, **Then** seuls les fichiers des nouveaux messages sont ajoutés.
2. **Given** ces mêmes conditions, **When** on enrichit, **Then** les fichiers déjà présents
   dans la colonne y restent.
3. **Given** un nouveau message qui retransmet un fichier déjà joint plus haut dans le fil
   (même nom, même taille), **When** on enrichit, **Then** ce fichier n'est pas ajouté une
   seconde fois.
4. **Given** un envoi rejoué après une coupure, **When** il aboutit, **Then** aucun fichier
   n'apparaît deux fois.

---

### User Story 4 - Utiliser le complément depuis Outlook sur iPhone et Android (Priority: P2)

Sur son téléphone, le collaborateur ouvre un mail, touche le bouton « Save to Notion » dans
les applications du message, et le panneau s'ouvre en plein écran. Il s'y connecte avec son
compte Microsoft comme sur son poste, coche et décoche au doigt, fait défiler la liste, crée
la note, puis ouvre la note dans Notion d'un toucher.

**Why this priority**: Gagne en usage, mais le poste reste le lieu principal du classement ;
la feature apporte déjà sa valeur sans le mobile.

**Independent Test**: Sur Outlook iOS (build 4.2433.0 ou plus) avec un compte Microsoft 365
de Mosaic, ouvrir un mail externe, ouvrir le complément, créer la note, ouvrir la note.

**Acceptance Scenarios**:

1. **Given** Outlook iOS ou Android à jour, après redéploiement du manifeste, **When** on ouvre
   un mail en lecture, **Then** le bouton « Save to Notion » est proposé.
2. **Given** le panneau ouvert sur un téléphone, **When** on interagit au doigt, **Then** chaque
   élément interactif offre une cible d'au moins 44 × 44 points, la page défile jusqu'au
   bouton d'envoi, et rien ne déborde horizontalement.
3. **Given** un champ de saisie touché sur iPhone, **When** le clavier s'ouvre, **Then** la page
   ne zoome pas.
4. **Given** le succès sur mobile, **When** on touche « Ouvrir dans Notion », **Then** la note
   s'ouvre hors du panneau.
5. **Given** un Outlook mobile trop ancien pour la connexion, **When** on ouvre le panneau,
   **Then** il dit de mettre l'application à jour, avec la version minimale.

---

### User Story 5 - Un manifeste de production stable (Priority: P2)

L'administrateur déploie le nouveau manifeste une fois. Le complément s'appelle « Save to
Notion » partout, l'info-bulle dit qu'il rattache l'échange aux contacts du fil, et le même
manifeste couvre le poste, le web et le mobile.

**Why this priority**: Conditionne le mobile ; coût de redéploiement à chaque changement.

**Independent Test**: Le manifeste passe la validation officielle Microsoft ; installé, il
affiche le bon nom, la bonne info-bulle et le bouton sur poste et mobile.

**Acceptance Scenarios**:

1. **Given** le manifeste généré, **When** on le valide avec l'outil officiel, **Then** il est
   déclaré valide.
2. **Given** le complément installé, **When** on survole le bouton sur poste, **Then**
   l'info-bulle parle de rattacher l'échange aux contacts, au pluriel.
3. **Given** un complément déjà installé en 1.3.0.0, **When** le manifeste est redéployé,
   **Then** Outlook le met à jour (numéro de version supérieur).

---

### Edge Cases

- **Fichier joint qui est un mail** (pièce jointe de type message) : importé comme fichier
  `.eml`.
- **Pièce jointe « lien cloud »** (OneDrive, SharePoint) : il n'y a pas de fichier à copier.
  Affichée comme non importable, avec la raison.
- **Deux copies du même mail** (envoyés et reçus) : ses pièces jointes ne comptent qu'une fois.
- **Le même fichier retransmis** dans plusieurs messages (même nom, même taille) : importé une
  seule fois.
- **Plus de 100 fichiers** dans un fil : les 100 premiers sont importés, les autres listés
  comme non importés (limite d'une colonne Fichiers par écriture).
- **La colonne « Fichiers » absente ou d'un autre type** : la note est créée, les fichiers
  sont listés comme non importés avec la raison.
- **Session Microsoft expirée pendant l'import** : le jeton est renouvelé avant chaque
  fichier ; un échec reste un fichier non importé, jamais une note perdue.
- **Échec de la création de la note après l'import des fichiers** : l'erreur s'affiche, on
  réessaie, et les fichiers déjà importés ne sont pas réimportés (ils restent valides une
  heure côté Notion).
- **Note enrichie entre-temps par quelqu'un d'autre** : comme aujourd'hui, rien n'est écrit
  et le panneau demande de recharger ; aucun fichier n'est attaché.
- **Notion refuse de conserver les fichiers existants lors d'un enrichissement** : les
  messages et la marque sont écrits, les nouveaux fichiers sont listés comme non importés,
  les fichiers existants ne sont pas touchés.
- **Fil sans aucune pièce jointe importable** : la section des fichiers n'apparaît pas.

## Requirements *(mandatory)*

### Functional Requirements

**Manifeste**

- **FR-001** : Le complément MUST s'appeler « Save to Notion », et son bouton MUST porter le
  même libellé, sur toutes les surfaces.
- **FR-002** : L'info-bulle du bouton MUST indiquer que l'échange est enregistré dans Notion
  et rattaché aux contacts externes du fil, au pluriel.
- **FR-003** : Le manifeste MUST déclarer Outlook sur mobile (iOS et Android) en lecture de
  message, avec un bouton qui ouvre le même panneau, et les icônes aux tailles et échelles
  exigées par Microsoft pour le mobile.
- **FR-004** : Le numéro de version du manifeste MUST être supérieur à 1.3.0.0, et le
  manifeste MUST passer la validation officielle Microsoft.

**Panneau sur mobile**

- **FR-005** : Chaque élément interactif du panneau MUST offrir une cible tactile d'au moins
  44 × 44 points sur un écran tactile.
- **FR-006** : Le panneau MUST défiler verticalement jusqu'à son dernier élément, sans
  défilement horizontal, sur un écran de téléphone.
- **FR-007** : Toucher un champ de saisie sur iPhone MUST NOT zoomer la page.
- **FR-008** : Les boutons qui mènent à Notion MUST ouvrir la page hors du panneau, par le
  moyen de l'hôte quand il en offre un, et par le navigateur sinon.
- **FR-009** : Sur un Outlook trop ancien pour la connexion, le message MUST donner les
  versions minimales du poste et du mobile.

**Pièces jointes**

- **FR-010** : Le panneau MUST recenser les pièces jointes des messages qui seront écrits :
  tous à la création, seulement les nouveaux à l'enrichissement.
- **FR-011** : Les images intégrées au corps des messages, les `winmail.dat` et les
  invitations de calendrier MUST être exclues, sans être affichées.
- **FR-012** : Un même fichier (même nom, même taille) MUST n'être importé qu'une fois par
  note, y compris s'il a été joint par un message déjà enregistré.
- **FR-013** : Avant l'envoi, le panneau MUST afficher le nombre de fichiers qui seront joints
  et leur taille totale, et MUST permettre de décocher chaque fichier.
- **FR-014** : Un fichier plus lourd que la limite par fichier du workspace Notion MUST être
  affiché comme non importable, avec sa taille et la limite. La limite MUST être lue auprès
  de Notion, jamais supposée.
- **FR-015** : Pendant l'envoi, le panneau MUST afficher « Import des fichiers… x/y ».
- **FR-016** : Les fichiers MUST être déposés dans la colonne « Fichiers » de la note
  (configurable comme les autres colonnes).
- **FR-017** : L'échec de l'import d'un fichier MUST NOT empêcher l'écriture de la note. Le
  succès MUST indiquer le nombre de fichiers importés et lister les fichiers non importés
  avec leur raison.
- **FR-018** : À l'enrichissement, les fichiers déjà dans la colonne MUST y rester.
- **FR-019** : Le nom de chaque pièce jointe MUST rester listé sous son message dans le corps
  de la note, comme aujourd'hui.
- **FR-020** : L'import MUST fonctionner pour des fichiers de plusieurs dizaines de Mo.
- **FR-021** : Aucune nouvelle permission Microsoft MUST être demandée.
- **FR-022** : Le contenu et le nom des fichiers MUST NOT être journalisés côté serveur
  (constitution, VIII).
- **FR-023** : Le serveur MUST refuser de lire une pièce jointe dans une autre boîte mail que
  celle de l'utilisateur authentifié.

### Key Entities

- **Pièce jointe candidate** : un fichier d'un message du fil. Nom, taille, type, message
  d'origine, nature (fichier, mail joint, lien cloud), état (à importer, décochée, trop
  lourde, non importable, importée, échouée avec raison).
- **Fichier importé** : une pièce jointe déposée chez Notion, référencée par la note dans sa
  colonne Fichiers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : 100 % des pièces jointes cochées et sous la limite arrivent dans la colonne
  Fichiers, ou figurent dans la liste des non importés avec une raison.
- **SC-002** : Un fichier de 30 Mo est importé en moins d'une minute sur une connexion
  ordinaire.
- **SC-003** : Après N enrichissements d'un même fil, chaque fichier apparaît exactement une
  fois dans la colonne.
- **SC-004** : Un collaborateur crée une note depuis son téléphone sans zoomer ni faire
  défiler horizontalement.
- **SC-005** : Le manifeste n'a besoin d'aucune autre modification identifiée pour les six
  mois suivants, hors décisions listées dans le plan.

## Assumptions

- Les collaborateurs utilisent des comptes Microsoft 365 de leur organisation : c'est la seule
  configuration où la connexion fonctionne sur mobile.
- Le workspace Notion de Mosaic est sur un plan payant (limite par fichier de 5 Go) ; sur un
  plan gratuit la limite serait de 5 Mo, et la feature s'y adapte en lisant la limite.
- La colonne « Fichiers » est de type fichiers (vérifié le 2026-10-03, research 001 A-1).
- Les pièces jointes d'un mail Outlook dépassent rarement 150 Mo (limite Microsoft).
- La conservation des fichiers existants lors d'un enrichissement par réécriture de la colonne
  n'est pas documentée par Notion : elle est vérifiée par un script avant mise en production,
  et un repli sans perte est prévu (research C-2).
