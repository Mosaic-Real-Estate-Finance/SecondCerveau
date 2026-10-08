# Feature Specification: Synchronisation Read AI vers Notion

**Feature Branch**: `claude/elegant-mccarthy-li6574`

**Created**: 2026-10-08

**Status**: Clarifiée — prête pour le plan

**Input**: Brief « Synchronisation Read AI → Notion (feature 002) », 2026-10-08, @Théo Gouman

Les réunions avec des contacts externes, enregistrées par Read AI, arrivent d'elles-mêmes dans
la base Notes, rattachées aux bons contacts. Quand une personne n'est pas reconnue, rien n'est
écrit avant qu'un collaborateur ait tranché, depuis un écran « À valider » de la PWA.

**Pourquoi.** La dictée couvre les rendez-vous dont on se souvient de parler, le complément
Outlook couvre les mails. Les visioconférences restaient hors du CRM, alors que Read AI en
produit déjà le résumé et la transcription. Ce troisième outil complète l'historique de
chaque contact, sans saisie, et sans laisser entrer dans le CRM une personne que personne n'a
validée.

**Et parce que la PWA va désormais montrer des résumés de réunions clients**, elle cesse de
faire confiance à une adresse tapée : on y entre avec un code reçu par email.

## Clarifications

### Session 2026-10-08

- Q: Sans NOTION_TOKEN dans le conteneur, comment tenir l'exigence de vérifier le schéma Notion avant de coder ? → A: S'appuyer sur le schéma lu en direct le 2026-10-03 (feature 001), relire le schéma à l'exécution et refuser proprement si une colonne manque, et livrer un script de vérification en lecture du §12 du brief, à lancer avant le déploiement. Les points que seule la lecture en direct tranche restent marqués à confirmer.
- Q: Comment se clôt un élément « compléter une note existante » une fois la personne tranchée ? → A: Le contact validé (rattaché ou créé) est ajouté à la relation de la note existante, sans toucher au contenu, et l'élément sort de la file. « Pas nécessaire » ou « Ignorer » le ferment sans rien écrire.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Une réunion avec des contacts connus arrive seule dans Notion (Priority: P1)

Un collaborateur de Mosaic tient une visio avec deux interlocuteurs déjà présents dans
Contacts. Read AI l'enregistre. Quelques instants après la fin du rapport, une note existe dans
Notes : titre de la réunion, date et heure, source « ReadAI », les collaborateurs présents en
auteurs, les deux contacts rattachés, le résumé et la transcription dans le corps. Chaque
collaborateur qui a activé les notifications reçoit « Réunion ajoutée ».

**Why this priority**: C'est la feature. Tout le reste traite les cas où ce chemin direct ne
suffit pas.

**Independent Test**: Envoyer manuellement depuis Read AI le rapport d'une réunion dont tous
les externes sont dans Contacts : la note apparaît, rattachée, sans aucune question posée.

**Acceptance Scenarios**:

1. **Given** une réunion dont tous les participants externes pertinents sont reconnus par leur
   email exact, **When** Read AI envoie son rapport, **Then** une note est créée, rattachée à
   ces contacts, avec en auteurs les collaborateurs présents qui sont utilisateurs de l'app.
2. **Given** cette note, **When** on l'ouvre, **Then** elle contient exactement deux encadrés,
   « Résumé » puis « Transcription », et la transcription est entière et dans l'ordre, chaque
   intervention précédée du nom de l'orateur en gras et de son horodatage relatif.
3. **Given** une réunion uniquement entre collaborateurs de Mosaic, **When** son rapport
   arrive, **Then** rien n'est créé, rien n'est mis en attente, aucune notification ne part.
4. **Given** une réunion dont les seuls externes n'ont pas d'email, ou sont tous sur la liste
   d'exclusion, **When** son rapport arrive, **Then** rien ne se passe non plus.
5. **Given** le même envoi reçu deux fois, **When** le second arrive, **Then** il est ignoré.
6. **Given** un événement de début de réunion, **When** il arrive, **Then** il est accepté
   et ignoré.

---

### User Story 2 - Valider les personnes inconnues avant d'écrire (Priority: P1)

Une réunion compte un externe inconnu. Rien n'arrive dans Notion. Les collaborateurs reçoivent
« 1 personne à valider ». Depuis l'accueil de la PWA, un accès discret avec un compteur ouvre
l'écran « À valider » : l'appel y figure avec son titre, sa date, son organisateur, les
contacts déjà reconnus et son résumé. Pour la personne inconnue, on voit son nom, son email,
et la société suggérée par son domaine. Trois choix : la rattacher à un contact existant, créer
un nouveau contact, ou la déclarer « pas nécessaire ». Une fois toutes les personnes
tranchées, la note est créée avec tous les contacts retenus, et l'appel quitte la file.

**Why this priority**: Sans elle, toute réunion avec un nouveau venu serait soit perdue, soit
écrite avec des contacts non validés. Elle est aussi fréquente que le cas direct.

**Independent Test**: Envoyer un rapport avec un contact connu et une adresse inconnue : rien
dans Notion, l'appel est dans « À valider » avec le contact connu affiché ; créer le contact
inconnu depuis l'écran : la note apparaît avec les deux contacts, et l'appel disparaît.

**Acceptance Scenarios**:

1. **Given** une réunion avec un externe connu et un externe inconnu, **When** le rapport
   arrive, **Then** rien n'est créé dans Notion et l'appel attend dans la file, le contact
   connu affiché.
2. **Given** `arsene@gouman.fr` inconnu et `theo@gouman.fr` présent dans Contacts, **When**
   l'appel est affiché, **Then** Arsène est proposé avec la société de Théo présélectionnée,
   et il n'est jamais rattaché sans validation.
3. **Given** une adresse `@gmail.com` inconnue, **When** elle est affichée, **Then** aucune
   société n'est suggérée.
4. **Given** un domaine présent sur des contacts de deux sociétés différentes, **When** la
   personne est affichée, **Then** les deux sociétés sont proposées et l'utilisateur choisit.
5. **Given** une personne à valider, **When** l'utilisateur la rattache à un contact existant,
   **Then** son adresse est ajoutée aux adresses de ce contact, et un appel suivant avec cette
   adresse part directement.
6. **Given** une personne à valider, **When** l'utilisateur crée un nouveau contact, **Then**
   le formulaire est prérempli avec son nom, son email et la société suggérée, et le contact
   est créé dans Notion immédiatement.
7. **Given** une personne à valider, **When** l'utilisateur la déclare « pas nécessaire »,
   **Then** son adresse rejoint la liste d'exclusion de l'équipe et elle ne sera plus jamais
   proposée.
8. **Given** un appel en attente, **When** l'utilisateur choisit « Ignorer cet appel »,
   **Then** rien n'est créé et personne n'est ajouté à la liste d'exclusion.
9. **Given** un appel dont toutes les personnes sont « pas nécessaire » et sans contact déjà
   reconnu, **When** la dernière décision est prise, **Then** aucune note n'est créée.
10. **Given** la note créée à la clôture, **When** on cherche l'appel dans le stockage
    d'attente, **Then** son contenu n'y est plus.
11. **Given** une même adresse portée par deux contacts, **When** elle apparaît dans une
    réunion, **Then** la personne passe en « À valider » avec les deux contacts proposés.

---

### User Story 3 - Entrer dans la PWA avec un code reçu par email (Priority: P1)

L'écran d'accès demande l'adresse, puis un code à six chiffres envoyé par email. Un code
correct ouvre une session qui dure, sur cet appareil, jusqu'à 90 jours sans usage. Toutes les
routes de la PWA exigent cette session. Une déconnexion est possible depuis les réglages.

**Why this priority**: L'écran « À valider » montre le contenu de réunions clients et crée des
contacts : il ne peut pas ouvrir sur une simple adresse tapée, alors que le dépôt est public.
Il conditionne donc la livraison de l'US2.

**Independent Test**: Sans session, chaque route de la PWA renvoie un refus, y compris avec
l'ancien en-tête d'adresse. Avec un code reçu par email, l'accès s'ouvre et survit à la
fermeture de l'app installée sur iPhone.

**Acceptance Scenarios**:

1. **Given** une adresse autorisée, **When** elle est saisie, **Then** un code à six chiffres
   lui est envoyé, valable 10 minutes, utilisable une seule fois.
2. **Given** une adresse non autorisée, **When** elle est saisie, **Then** la réponse visible
   est identique à celle d'une adresse autorisée, et aucun email ne part.
3. **Given** un code, **When** cinq essais faux ont été faits, **Then** ce code est bloqué.
4. **Given** un code expiré, **When** il est saisi, **Then** il est refusé.
5. **Given** une adresse, **When** un renvoi est demandé moins d'une minute après le
   précédent, ou plus de cinq fois dans l'heure, **Then** il est refusé avec un message.
6. **Given** une session ouverte dans la PWA installée, **When** l'app est fermée puis
   rouverte, **Then** l'utilisateur est toujours connecté.
7. **Given** une session ouverte, **When** l'utilisateur se déconnecte, **Then** la session
   est révoquée et ne peut plus servir, même rejouée.
8. **Given** la dictée après connexion, **When** une note est dictée et envoyée, **Then** le
   parcours fonctionne comme avant.

---

### User Story 4 - Une réunion, une seule note (Priority: P2)

Deux collaborateurs de Mosaic enregistrent la même réunion. Read AI produit deux rapports.
Le CRM n'en garde qu'une note, ou un seul élément en attente, avec les deux collaborateurs en
auteurs.

**Why this priority**: Sans elle, chaque réunion à plusieurs produit des doublons dans le CRM.
Mais la plupart des réunions n'ont qu'un enregistreur.

**Independent Test**: Envoyer deux rapports de la même réunion, y compris à la même seconde :
une seule note, ou un seul élément en attente, avec deux auteurs.

**Acceptance Scenarios**:

1. **Given** un premier rapport en attente, **When** le second arrive, **Then** il est fusionné
   dans le même élément : nouveaux auteurs et nouveaux externes ajoutés, contenu du premier
   conservé.
2. **Given** une note déjà créée, **When** le second rapport arrive, **Then** les nouveaux
   auteurs et les contacts reconnus manquants sont ajoutés à la note, son contenu n'est pas
   réécrit, et un externe inconnu nouveau crée un élément « compléter une note existante ».
3. **Given** deux rapports arrivés à la même seconde, **When** ils sont traités, **Then** une
   seule note ou un seul élément en attente en résulte.
4. **Given** une réunion sans identifiant de plateforme (enregistrée depuis l'app Read),
   **When** un second rapport arrive avec le même titre, un début à moins de 10 minutes et au
   moins un externe commun, **Then** il est traité comme la même réunion.

---

### User Story 5 - Être prévenu sur son téléphone (Priority: P2)

Un collaborateur active « Recevoir les notifications » dans les réglages de la PWA installée.
Il reçoit une notification quand une réunion est ajoutée, quand des personnes sont à valider,
et quand un traitement a échoué. Un clic l'amène à la note, ou à l'appel concerné dans « À
valider ».

**Why this priority**: La file d'attente fonctionne sans, mais personne ne saurait qu'elle se
remplit.

**Independent Test**: Activer les notifications sur un iPhone avec la PWA installée, envoyer
un rapport avec un inconnu : la notification arrive, et le clic ouvre l'écran sur cet appel.

**Acceptance Scenarios**:

1. **Given** la PWA non installée, **When** l'utilisateur ouvre les réglages, **Then** le
   réglage des notifications n'est pas proposé, et il est renvoyé vers l'invitation
   d'installation.
2. **Given** les notifications activées par plusieurs collaborateurs, **When** un appel est
   traité, **Then** tous les reçoivent, quel que soit l'organisateur de la réunion.
3. **Given** une note créée directement, **When** la notification est cliquée, **Then** la
   note Notion s'ouvre.
4. **Given** un appel en file ou en erreur, **When** la notification est cliquée, **Then**
   l'écran « À valider » s'ouvre sur cet appel.
5. **Given** un appel ignoré, **When** il est traité, **Then** aucune notification ne part.
6. **Given** une notification, **When** on la lit, **Then** elle ne contient jamais de
   résumé ni de transcription.

---

### User Story 6 - Ne rien perdre quand ça échoue (Priority: P2)

Notion est indisponible au moment de créer la note. L'appel n'est pas perdu : il apparaît dans
« À valider » au statut erreur, avec « Réessayer ». Le réessai aboutit sans doublon de note ni
de contact.

**Why this priority**: Read AI ne renvoie pas un rapport déjà accepté ; un échec silencieux
après acceptation serait une perte définitive.

**Independent Test**: Rendre Notion injoignable, envoyer un rapport connu : l'appel est en
erreur dans l'écran ; rétablir Notion, cliquer « Réessayer » : une seule note.

**Acceptance Scenarios**:

1. **Given** un traitement qui échoue après réception, **When** l'erreur survient, **Then**
   l'appel est conservé au statut erreur et une notification « Réunion non enregistrée » part.
2. **Given** un appel en erreur, **When** l'utilisateur clique « Réessayer » et que la cause a
   disparu, **Then** la note est créée une seule fois, et aucun contact n'est recréé.
3. **Given** une clôture d'appel en attente qui échoue, **When** l'erreur survient, **Then**
   l'élément reste dans la file, ses décisions déjà prises sont conservées.

---

### Edge Cases

- **Signature absente ou fausse** : refus, rien n'est traité.
- **Réunion d'une heure** : la réception est confirmée en moins de 2 secondes, le traitement
  continue ensuite ; la transcription arrive entière dans Notion malgré les limites de taille
  par requête.
- **Organisateur absent de la liste des participants** : il y est ajouté.
- **Même personne présente deux fois** : dédoublonnée par email.
- **Aucun collaborateur présent n'est utilisateur de l'app** : la note est créée quand même,
  sans auteur.
- **Deux collaborateurs tranchent la même personne en même temps** : la première décision
  l'emporte ; le second voit « Déjà traité » et la liste se rafraîchit ; un seul contact est
  créé.
- **Rapport issu d'un fichier uploadé ou partagé après coup** : Read AI n'envoie rien ; l'envoi
  manuel depuis le rapport reste le moyen de rattrapage.
- **Colonne `Statut IA` supprimée** : sans effet, elle n'est pas écrite.
- **Option `ReadAI` absente du sélecteur `Source`** : le traitement le signale comme une
  erreur de configuration, au lieu de créer l'option en silence.
- **Abonnement aux notifications périmé** : il est supprimé au premier refus du service.
- **PWA déjà installée avant la feature** : elle repasse une fois par l'écran d'accès.

## Requirements *(mandatory)*

### Functional Requirements

**Réception**

- **FR-001** : Le point de réception MUST n'accepter que les requêtes dont la signature du
  corps est valide, et refuser les autres.
- **FR-002** : Seuls les événements de fin de réunion MUST être traités ; tout autre événement
  MUST être accepté sans effet.
- **FR-003** : Un même envoi (même identifiant de requête) MUST n'être traité qu'une fois, sur
  une fenêtre d'au moins 30 jours.
- **FR-004** : La réception MUST être confirmée avant le traitement, et ne MUST jamais échouer
  pour une raison propre à l'application, afin que Read AI ne désactive pas l'envoi.
- **FR-005** : Un traitement qui échoue après confirmation MUST laisser l'appel visible au
  statut erreur, avec un moyen de réessayer.

**Filtrage et rapprochement**

- **FR-006** : Les participants MUST être normalisés (email en minuscules, organisateur
  ajouté, dédoublonnage par email) puis répartis en sans email, internes et externes.
- **FR-007** : Les internes MUST ne jamais être rattachés comme contacts ; ceux qui sont
  utilisateurs de l'app MUST devenir les auteurs de la note.
- **FR-008** : Un externe présent sur la liste d'exclusion MUST être retiré ; s'il ne reste
  aucun externe pertinent, l'appel MUST être ignoré sans trace.
- **FR-009** : Le rapprochement de tous les externes d'un appel MUST coûter une seule requête
  à la base Contacts, quelle que soit leur nombre ou la taille de la base.
- **FR-010** : Un externe MUST être reconnu seulement si son email exact figure parmi les
  adresses d'un contact.
- **FR-011** : À défaut, son domaine MUST être cherché sur les emails des contacts, et les
  sociétés de ces contacts MUST être suggérées, toutes s'il y en a plusieurs. Les domaines de
  messagerie grand public MUST être exclus de cette suggestion, par une liste par défaut
  surchargeable.
- **FR-012** : Une adresse portée par deux contacts MUST mener à une validation, avec les deux
  contacts proposés.

**Une note par réunion**

- **FR-013** : Chaque appel MUST recevoir une clé de réunion, fondée sur l'identifiant de
  plateforme quand il existe, sur l'identifiant de session sinon, complétée d'un
  rapprochement par titre, début à moins de 10 minutes et externe commun.
- **FR-014** : La clé MUST être écrite sur la note, de sorte qu'un rejeu ne crée jamais une
  seconde note.
- **FR-015** : Deux rapports de la même réunion arrivés simultanément MUST produire une seule
  note ou un seul élément en attente.
- **FR-016** : Un second rapport MUST être fusionné dans l'élément en attente, ou compléter la
  note existante (auteurs, contacts reconnus) sans en réécrire le contenu ; un nouvel externe
  inconnu MUST alors créer un élément « compléter une note existante ».

**La note**

- **FR-017** : La note MUST porter le titre de la réunion, sa date avec l'heure si la colonne
  l'accepte, la source « ReadAI », les auteurs, tous les contacts retenus et la clé de
  réunion. Elle MUST ne pas écrire l'état de traitement IA ni la transcription brute de la
  dictée.
- **FR-018** : Le corps MUST contenir un encadré « Résumé » (le résumé en paragraphes) puis un
  encadré « Transcription » (un paragraphe par intervention, `Nom (mm:ss) — texte`, nom en
  gras, temps relatif au début), et rien d'autre.
- **FR-019** : L'écriture MUST respecter la cadence permise par Notion et réessayer quand
  Notion demande de ralentir.

**File d'attente et écran « À valider »**

- **FR-020** : Un appel avec au moins un externe pertinent non reconnu MUST attendre dans la
  file, sans limite de durée, sans rien écrire dans Notion.
- **FR-021** : L'écran MUST lister les appels du plus récent au plus ancien, avec titre, date,
  organisateur, contacts reconnus et résumé en lecture.
- **FR-022** : Pour chaque personne, l'écran MUST offrir : rattacher à un contact existant
  (recherche, société suggérée en tête, adresse ajoutée au contact), créer un contact
  (formulaire prérempli, contact créé immédiatement), « pas nécessaire » (exclusion partagée
  par l'équipe).
- **FR-023** : L'écran MUST offrir « Ignorer cet appel », sans création ni exclusion.
- **FR-024** : Quand toutes les personnes sont tranchées, la note MUST être créée avec tous
  les contacts retenus, puis l'appel MUST quitter la file et son contenu être supprimé. Sans
  aucun contact retenu, aucune note n'est créée.
- **FR-025** : La première décision sur une personne MUST l'emporter ; une décision
  concurrente MUST recevoir « Déjà traité » ; aucun contact ne MUST être créé en double.
- **FR-025b** : Un élément « compléter une note existante » MUST, à sa clôture, ajouter les
  contacts validés à la relation de la note existante sans en toucher le contenu ; clos sans
  contact retenu, il MUST ne rien écrire.
- **FR-026** : La liste d'exclusion MUST être consultable, et une adresse MUST pouvoir en être
  retirée.

**Notifications**

- **FR-027** : Un utilisateur MUST pouvoir activer les notifications depuis la PWA installée,
  sur plusieurs appareils.
- **FR-028** : Les notifications MUST partir à tous les utilisateurs qui les ont activées pour
  trois cas : note ajoutée, personnes à valider, erreur ; et jamais pour un appel ignoré.
- **FR-029** : Une notification MUST ne contenir que le titre de la réunion, un compte et, pour
  une note ajoutée, les noms des contacts rattachés.
- **FR-030** : Le comportement hors ligne actuel de la PWA MUST rester identique.

**Authentification**

- **FR-031** : L'accès à la PWA MUST passer par un code à six chiffres envoyé par email aux
  seules adresses autorisées, avec une réponse identique pour une adresse non autorisée.
- **FR-032** : Un code MUST être conservé haché, valable 10 minutes, à usage unique, limité à
  5 essais, et ne MUST pas être renvoyé plus d'une fois par minute ni plus de 5 fois par heure
  et par adresse.
- **FR-033** : Une session MUST durer 90 jours glissants, être inaccessible au script de la
  page, et être révocable par la déconnexion.
- **FR-034** : Toutes les routes appelées par la PWA MUST exiger une session ; l'ancien en-tête
  d'adresse MUST ne plus rien ouvrir. Le complément Outlook MUST garder son propre chemin.

**Données**

- **FR-035** : Aucun résumé, aucune transcription, aucun nom ni email de participant MUST
  apparaître dans les journaux serveur.
- **FR-036** : Un appel en attente MUST ne conserver que les champs nécessaires à la création
  de la note.

### Key Entities

- **Rapport Read AI** : ce que Read AI envoie à la fin d'une réunion. Identifiant de requête,
  identifiant de session, titre, horaires, participants et organisateur, résumé, transcription
  par interventions, plateforme et identifiant côté plateforme.
- **Réunion** : identifiée par sa clé. Peut recevoir plusieurs rapports.
- **Participant** : nom, prénom, nom de famille, email (éventuellement absent). Sans email,
  interne ou externe.
- **Personne à valider** : un externe non reconnu, avec ses suggestions (sociétés, ou contacts
  en cas de doublon) et la décision prise sur lui.
- **Appel en attente** : une réunion en file, avec ce qu'il faut pour créer la note, ses
  personnes à valider, ses contacts reconnus, ses auteurs, son statut (en attente, erreur) et
  son type (nouvelle note, compléter une note existante).
- **Liste d'exclusion** : adresses exactes à ne plus jamais proposer, partagée par l'équipe.
- **Abonnement aux notifications** : un appareil d'un utilisateur.
- **Session** : l'accès ouvert d'un utilisateur sur un appareil, révocable.
- **Note**, **Contact**, **Société** : celles du CRM existant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : La réception d'un rapport, même d'une réunion d'une heure, est confirmée en
  moins de 2 secondes.
- **SC-002** : Une réunion dont tous les externes sont connus apparaît dans Notes sans aucune
  action humaine, en moins de 2 minutes après l'envoi du rapport.
- **SC-003** : Zéro personne rattachée sans validation : une adresse non reconnue par son email
  exact n'atteint jamais une note sans décision d'un collaborateur.
- **SC-004** : Zéro doublon : deux rapports de la même réunion, ou deux envois du même rapport,
  laissent une seule note.
- **SC-005** : Zéro appel perdu : tout rapport accepté finit en note, en file, en erreur
  visible ou en « ignoré » justifié par la règle de filtrage.
- **SC-006** : Aucune route de la PWA ne répond sans session.
- **SC-007** : Aucun contenu de réunion, nom ni email de participant dans les journaux.
- **SC-008** : La dictée et le complément Outlook passent leur parcours complet sans
  régression.

## Assumptions

- **Read AI** : le workspace est sur un plan qui permet un webhook à l'échelle du workspace,
  configuré par un administrateur ; seules les réunions des membres sont couvertes.
- **Auteurs** : seuls les collaborateurs présents ET utilisateurs de l'app deviennent auteurs ;
  les autres internes sont simplement ignorés.
- **Rapprochement par nom** : hors périmètre, trop hasardeux.
- **Fusion avec une note Outlook ou une dictée du même jour** : hors périmètre, elles restent
  séparées.
- **Éléments non utilisés** : action items, questions clés, sujets, chapitres ne sont pas
  repris ; aucune tâche n'est créée.
- **Reprise des réunions passées** : hors périmètre ; l'envoi manuel depuis un rapport suffit.
- **Notifications sur iPhone** : uniquement dans l'app installée, iOS 16.4 ou plus récent.
- **Dépendance** : un stockage opérationnel partagé entre les instances serveur, autorisé par
  la constitution 2.0.0 (principe II).
- **Dépendance** : un compte d'envoi d'emails pour les codes.
- **Vérification du schéma** : faute de jeton Notion dans l'environnement de développement,
  le schéma de référence est celui lu en direct le 2026-10-03 (feature 001). Un script de
  vérification en lecture est livré et doit passer avant le déploiement.
- **Dépendance** : l'option `ReadAI` du sélecteur `Source` existe dans Notes, ou est ajoutée
  par un humain.
