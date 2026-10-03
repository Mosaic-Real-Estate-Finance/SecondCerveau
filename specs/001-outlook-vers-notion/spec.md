# Feature Specification: Complément Outlook vers Notion

**Feature Branch**: `(aucune — travail sur main pour l'instant)`

**Created**: 2026-10-03

**Status**: Clarifiée — prête pour le plan

**Input**: Brief « Complément Outlook vers Notion », 2026-09-30, @Théo Gouman

Un collaborateur Mosaic qui lit un échange dans Outlook crée en deux clics une note Notion
rattachée au bon contact, sans quitter Outlook.

**Pourquoi.** Les échanges écrits restent aujourd'hui hors du CRM. La dictée couvre les
rendez-vous, ce complément couvre les mails. Les deux alimentent la même base Notes, donc
l'historique d'un contact devient complet.

## Clarifications

### Session 2026-10-03

- Q: La colonne Email de Contacts est de type « email » et ne porte qu'une adresse. Où vont les adresses supplémentaires d'un contact ? → A: Toutes dans la colonne Email, séparées par des virgules. Le lien mailto cesse d'être valide dès qu'il y en a plus d'une ; c'est accepté.
- Q: Quand un second collaborateur enrichit une note créée par un autre, qui est l'Auteur ? → A: Les deux. La propriété Auteur est de type Personne et accepte plusieurs valeurs ; chacun est ajouté au fil des enrichissements.
- Q: Un fil où tous les participants sont internes à Mosaic : que fait le panneau ? → A: L'envoi est refusé. Le panneau explique qu'il n'y a aucun interlocuteur externe à rattacher.

## User Scenarios & Testing *(mandatory)*

Le brief liste six parcours (US1 à US6), tous en P1. Ils sont repris ici regroupés en quatre
journeys livrables indépendamment : pris isolément, « les contacts sont présélectionnés » ne
rend aucun service tant que rien ne part dans Notion. Chaque journey indique les identifiants
du brief qu'il couvre, et aucun critère d'acceptation n'est perdu.

### User Story 1 - Classer un échange en deux clics (Priority: P1)

*Couvre US1, US3, US4 du brief.*

Le collaborateur ouvre un mail dont les participants sont déjà dans Contacts, ouvre le
panneau, voit les bons contacts présélectionnés, et envoie. Une note unique apparaît dans
Notes, liée à ces contacts, avec l'intégralité du fil.

**Why this priority**: C'est la feature. Sans elle, rien d'autre n'a de valeur.

**Independent Test**: Ouvrir un mail d'un contact connu, cliquer sur le bouton, cliquer sur
« Créer la note », ouvrir le lien renvoyé : la note existe, elle est liée au contact, et elle
contient tous les messages du fil du plus ancien au plus récent.

**Acceptance Scenarios**:

1. **Given** un mail dont l'expéditeur est dans Contacts, **When** le collaborateur ouvre le
   panneau, **Then** ce contact est reconnu et présélectionné, avec son nom et sa société.
2. **Given** un mail avec expéditeur, destinataires et copies tous présents dans Contacts,
   **When** le panneau s'ouvre, **Then** tous sont reconnus, sur n'importe laquelle de leurs
   adresses.
3. **Given** des contacts présélectionnés, **When** le collaborateur envoie, **Then** une
   note unique est créée, liée à tous les contacts retenus, avec la source « Email ».
4. **Given** une conversation de plusieurs messages, **When** la note est créée, **Then** le
   fil entier y figure, du plus ancien au plus récent.
5. **Given** la note créée, **When** Notion AI s'exécute, **Then** le titre, le texte propre
   et les tags sont écrits par l'IA, comme pour une dictée.

---

### User Story 2 - Classer un échange avec un interlocuteur inconnu (Priority: P2)

*Couvre US2 du brief.*

Un participant de l'échange n'existe pas dans Contacts. Le panneau permet de compléter sa
fiche sans quitter Outlook, puis le crée et le lie à la note.

**Why this priority**: Fréquent dès qu'un nouveau dossier démarre, mais le parcours P1 reste
utilisable sans : il suffit de décocher l'inconnu.

**Independent Test**: Ouvrir un mail d'une adresse absente de Contacts, remplir le formulaire
proposé, envoyer : le contact existe dans Contacts avec son email, et la note lui est liée.

**Acceptance Scenarios**:

1. **Given** un participant externe absent de Contacts, **When** le panneau s'ouvre, **Then**
   il apparaît marqué « Nouveau contact », dépliable en formulaire, email prérempli.
2. **Given** un formulaire rempli, **When** le collaborateur envoie, **Then** le contact est
   créé avant la note, puis lié à elle.
3. **Given** un participant indésirable (newsletter, assistant automatique), **When** le
   collaborateur le décoche, **Then** il n'est ni créé ni lié, et l'envoi reste possible.
4. **Given** un formulaire coché mais incomplet, **When** le collaborateur regarde le bouton
   d'envoi, **Then** celui-ci est désactivé.

---

### User Story 3 - Reprendre une conversation déjà classée (Priority: P2)

*Couvre US5 du brief.*

L'échange se poursuit. Le collaborateur rouvre le panneau sur le même fil : la note existante
est reconnue et seuls les nouveaux messages y sont ajoutés.

**Why this priority**: Sans elle, chaque relance crée un doublon et la base se dégrade vite —
mais le parcours P1 reste démontrable d'abord.

**Independent Test**: Classer un fil, recevoir ou simuler une réponse, rouvrir le panneau :
il annonce la note existante et le nombre de nouveaux messages ; après envoi, la note contient
l'ancien et le nouveau, une seule fois chacun.

**Acceptance Scenarios**:

1. **Given** une conversation déjà classée, **When** le panneau s'ouvre, **Then** il affiche
   « Note existante, N nouveaux messages » et un lien vers la note.
2. **Given** une conversation classée sans nouveau message, **When** le panneau s'ouvre,
   **Then** il affiche « Note à jour » et aucun bouton d'envoi.
3. **Given** des nouveaux messages, **When** le collaborateur enrichit, **Then** seuls
   ceux-là sont ajoutés, les contacts manquants sont ajoutés à la relation, et la note est
   remise à retraiter par l'IA.
4. **Given** un même envoi déclenché deux fois, **When** les deux aboutissent, **Then** une
   seule note existe et aucun message n'apparaît en double.

---

### User Story 4 - Ne rien perdre quand ça échoue (Priority: P3)

*Couvre US6 du brief.*

Le réseau tombe ou Notion répond en erreur. Le collaborateur voit ce qui s'est passé, retrouve
sa saisie, et réessaie.

**Why this priority**: Indispensable à la confiance, mais vérifiable seulement une fois les
parcours précédents en place.

**Independent Test**: Couper le réseau au moment de l'envoi : un message en français
apparaît, le formulaire de contact en cours est intact, et « Réessayer » aboutit une fois le
réseau revenu.

**Acceptance Scenarios**:

1. **Given** un envoi qui échoue, **When** l'erreur remonte, **Then** le message est en
   français et dit si c'est le réseau ou Notion.
2. **Given** un formulaire de contact rempli et un envoi échoué, **When** l'erreur s'affiche,
   **Then** la saisie est conservée.
3. **Given** une erreur affichée, **When** le collaborateur clique sur « Réessayer » et que
   la cause a disparu, **Then** l'envoi aboutit sans créer de doublon.

---

### Edge Cases

- **Fil sans aucun participant externe** (échange interne Mosaic uniquement) : l'envoi est
  refusé et le panneau explique qu'il n'y a aucun interlocuteur à rattacher. La base Notes
  reste orientée client.
- **Mail protégé ou chiffré** : le contenu n'est pas lisible ; le panneau le dit et n'envoie
  rien.
- **Fil très long** (plus de 50 messages) : traité par lots, avec une progression affichée,
  sans perte de message.
- **Message dépassant la taille maximale d'un bloc Notion** : découpé sans perte de texte.
- **Mail HTML chargé** (signatures, tableaux) : le texte reste lisible dans Notion.
- **Changement de mail alors que le panneau est épinglé** : le contexte est rechargé ; si une
  saisie de contact est en cours, une confirmation est demandée avant de la perdre.
- **Même participant présent sous deux adresses dans le même fil** : un seul contact, lié une
  seule fois.
- **Première utilisation** : une fenêtre de consentement Microsoft peut apparaître ; le
  panneau l'annonce au lieu de laisser l'utilisateur face à une popup inexpliquée.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** : Le bouton MUST apparaître sur les mails en lecture dans Outlook classique
  Windows, le nouvel Outlook Windows, Outlook Mac et Outlook sur le web.
- **FR-002** : Le panneau MUST pouvoir être épinglé, et MUST se mettre à jour quand
  l'utilisateur change de mail.
- **FR-003** : Le complément MUST ne lire que la conversation du mail ouvert, jamais la boîte
  entière.
- **FR-004** : Seuls les comptes du tenant Mosaic MUST pouvoir utiliser le backend ; toute
  autre identité MUST être rejetée.
- **FR-005** : L'auteur de la note MUST être le collaborateur connecté à Outlook. Lorsqu'un
  autre collaborateur enrichit une note existante, il MUST être ajouté aux auteurs sans
  remplacer les précédents.
- **FR-006** : Un participant MUST être reconnu sur n'importe laquelle de ses adresses
  connues. Les adresses d'un contact MUST tenir dans l'unique colonne Email, séparées par des
  virgules ; la reconnaissance MUST les découper et comparer en égalité exacte, insensible à
  la casse.
- **FR-014** : La création d'un contact depuis le panneau MUST écrire son adresse dans la
  colonne Email. Aucune route existante ne l'écrit aujourd'hui.
- **FR-007** : Une conversation MUST produire au plus une note, quelle que soit le nombre
  d'envois ; la clé d'unicité est l'identifiant de la conversation.
- **FR-008** : Un enrichissement MUST n'ajouter que les messages absents de la note.
- **FR-009** : Le contenu d'un mail MUST aller dans Notion et nulle part ailleurs ; il MUST
  ne jamais être journalisé côté serveur.
- **FR-010** : Les pièces jointes MUST être ignorées ; seuls leurs noms sont listés sous le
  message concerné.
- **FR-011** : L'interface MUST être en français et suivre la direction artistique Mosaic, y
  compris lorsque Outlook est en thème sombre.
- **FR-012** : La note MUST porter une origine distinguant « Email » de « Dictée ».
- **FR-013** : La dictée MUST continuer de fonctionner sans régression, y compris ses routes
  API, qui MUST rester inchangées.

### Key Entities

- **Conversation** : le fil de mails ouvert dans Outlook. Porte un identifiant stable qui sert
  de clé d'unicité, une liste de messages ordonnés, et un ensemble de participants.
- **Message** : un mail du fil. Porte une date, un expéditeur, un corps en texte débarrassé
  des citations des messages précédents, et une liste de noms de pièces jointes.
- **Participant** : une adresse présente dans le fil, interne (Mosaic) ou externe. Seules les
  externes sont candidates au rattachement.
- **Contact** : une fiche de la base Contacts, identifiée par ses adresses mail.
- **Note** : une page de la base Notes, liée à un ou plusieurs contacts, portant son origine,
  la date du dernier message, son auteur, la clé de la conversation, la marque du dernier
  message intégré et un état de traitement IA.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : Moins de 30 secondes entre l'ouverture du mail et la confirmation, pour un fil
  de dix messages.
- **SC-002** : Zéro doublon : sur 20 envois répétés de la même conversation, une seule note.
- **SC-003** : Aucun secret présent dans le code livré au navigateur, vérifié par recherche
  dans le bundle de production.
- **SC-004** : Les quatre clients Outlook passent la grille de convergence en entier.
- **SC-005** : Aucune régression de la dictée : son parcours complet passe après déploiement,
  et ses notes portent l'origine « Dictée ».
- **SC-006** : Un collaborateur classe un échange sans aide, du premier coup, sans quitter
  Outlook.

## Assumptions

- **Rattachement aux contacts seulement.** L'entreprise est déjà portée par la fiche contact ;
  aucune liaison directe note → société.
- **Pas de commentaire libre.** Le fil brut part dans Notion, Notion AI le réécrit, comme pour
  la dictée. Rien n'est saisi à la main en plus du formulaire de contact.
- **Une seule note par conversation**, liée à tous les contacts de l'échange, et non une note
  par interlocuteur.
- **Les adresses internes** sont celles du domaine `mosaicfin.com`, plus les adresses de la
  liste des utilisateurs autorisés.
- **Hors périmètre** : synchronisation automatique de toute la boîte, envoi de mails depuis
  Notion, Outlook mobile, surface de rédaction.
- **Dépendance bloquante à vérifier** : la relation `Interlocuteur` de la base Notes doit
  accepter plusieurs pages. Le réglage n'est pas exposé par l'API de Notion ; il doit être
  constaté dans l'interface. S'il est limité à une page, US1 scénario 3 est impossible en
  l'état.
- **Dépendance** : quatre propriétés manquent aujourd'hui à la base Notes (clé de
  conversation, origine, dernier message intégré, état IA) et doivent être créées avant le
  développement.
- **Dépendance** : une application Microsoft Entra, son consentement administrateur et un
  compte de test sont fournis par le client. La V1 se développe sur le compte Microsoft de
  Théo.
