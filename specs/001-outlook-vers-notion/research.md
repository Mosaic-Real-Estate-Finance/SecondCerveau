# Phase 0 — Recherche et décisions

**Feature** : Complément Outlook vers Notion · **Date** : 2026-10-03

Chaque point ci-dessous était une inconnue du brief. Tous sont résolus : plus aucun
`NEEDS CLARIFICATION` ne subsiste dans le plan. Les constats marqués **vérifié** l'ont été
contre le dépôt ou contre l'API réelle, comme l'exige le workflow de la constitution.

---

## A. Écarts entre le brief et le dépôt réel

Audit du dépôt et lecture du schéma Notion en direct (`GET /v1/databases/{id}`, 2026-10-03).

### A-1. Les propriétés manquantes de la base Notes — **vérifié**

Schéma réel de Notes : `Sujet` (title), `Information` (formula), `Date` (date), `Projet`
(relation), `Note détaillée` (rich_text), `Auteur` (people), `Transcription brute`
(rich_text), `Fichiers` (files), `Société` (rollup), `Interlocuteur` (relation → Contacts),
`Résumé IA` (rich_text).

Le brief annonce « trois propriétés ». Il en manque **quatre** :

**Créées par l'API le 2026-10-03** et confirmées par relecture du schéma : la base compte
désormais 15 propriétés, les onze d'origine intactes. L'idempotence de la dictée a été
vérifiée de bout en bout dans la même session — deux envois du même `clientId` rendent la
même page, le second avec `duplicate: true` — ce qui n'était pas possible avant.

| Propriété | Type attendu | Conséquence si absente |
| --- | --- | --- |
| `ID client` | Texte | Aucune idempotence — ni pour le mail, ni pour la dictée aujourd'hui |
| `Source` | Sélection (Dictée, Email) | FR-012 impossible |
| `Dernier message` | Texte | FR-008 impossible : on ne sait pas où reprendre |
| `Statut IA` | Sélection (À traiter, Traité) | L'enrichissement ne relance pas l'IA |

`ID client` est présenté par le brief comme « recommandée par le README, à créer si absente ».
Elle est absente, **et** `NOTES_PROP_CLIENT_ID` est vide dans `.env.local` : la dictée en
production n'a donc aucune protection contre les doublons aujourd'hui. C'est un défaut
existant que cette feature corrige au passage, pas une régression qu'elle introduit.

### A-2. `Interlocuteur` n'est pas vérifiable par l'API — **vérifié, puis levé**

`Interlocuteur` est de type `relation`, cible la base Contacts, et son sous-type est
`single_property`. Dans l'API Notion, `single_property` signifie **« sans synchronisation
inverse »**, et non « limitée à une page ». Le réglage « Limiter à 1 page » de l'interface
n'est **pas exposé** par l'API : aucune lecture ne peut le constater.

- **Décision** : la vérification reste une action humaine, dans l'interface Notion
  (base Notes → colonne Interlocuteur → la limite doit être « Pas de limite »).
- **Résolu le 2026-10-03** : Théo a constaté dans l'interface que la relation n'est pas
  limitée à une page. US1 scénario 3 est réalisable, et l'hypothèse « une seule note par
  conversation, liée à tous les contacts du fil » tient. Plus de point bloquant ici.
- Le repli écarté, pour mémoire : une note par interlocuteur, qui aurait contredit cette
  hypothèse et imposé de re-spécifier.

### A-3. `Nom société` n'existe pas dans Contacts — **vérifié**

`CONTACTS_PROP_COMPANY_ROLLUP=Nom société` désigne une propriété absente du schéma réel de
Contacts. Les propriétés existantes sont `Société` (relation → base Sociétés) et, côté Notes,
`Société` (rollup). Le code a un repli — une requête supplémentaire pour résoudre le nom —
donc rien n'est cassé, mais le README se trompe en annonçant « un appel par société ».

- **Décision** : le panneau Outlook affiche nom + société en réutilisant le repli existant,
  sans ajouter d'appel. Corriger le README et la valeur par défaut de
  `CONTACTS_PROP_COMPANY_ROLLUP` est une tâche de nettoyage, hors chemin critique.

### A-4. `Contacts.Email` est de type `email`, une seule adresse — **vérifié**

Confirmé par le schéma. La clarification de session (« toutes les adresses dans Email,
séparées par virgules ») suppose que ce type accepte une chaîne multi-adresses.

**Sonde exécutée le 2026-10-03** : création d'une page `ZZ sonde technique`, écriture de
`"zz.test.a@invalid.test, zz.test.b@invalid.test"`, relecture, puis archivage immédiat.
Résultat :

- la valeur est stockée **telle quelle**, sans validation de format ni troncature ;
- un filtre serveur `Email.contains` sur la seconde adresse **trouve la page**.

FR-006 est donc réalisable. La page de sonde a été archivée dans la même exécution.

### A-5. Le titre de Contacts porte un nom vide — **vérifié**

La propriété title de Contacts s'appelle `""`. Le code existant la cible par son type
(`title`), pas par son nom ; la route Outlook fait de même. Aucune action.

### A-6. Ce que la dictée n'écrit pas aujourd'hui — **vérifié**

- `functions/api/contacts.ts` ne renseigne jamais `Email` à la création d'un contact
  → d'où FR-014.
- `functions/api/notes.ts` n'écrit aucune `Source`. FR-012 exige donc **une modification de
  la route de la dictée**, ce qui est en tension avec FR-013 (« ses routes API MUST rester
  inchangées »). Traité dans le plan, section Complexité.

---

## B. Authentification Microsoft

### B-1. Le repli `Office.auth.getAccessToken` du brief n'existe plus

Les jetons Exchange Online hérités — identité utilisateur et jetons de rappel — ont été
désactivés par défaut en février 2025, l'option de réactivation par l'administrateur a été
retirée en juin 2025, et l'extinction a été complète en octobre 2025. La FAQ Microsoft est
explicite : « Legacy Exchange Online user identity tokens and callback tokens are no longer
supported and turned off across all Microsoft 365 tenants. » Un appel à
`getUserIdentityTokenAsync` renvoie désormais une erreur générique 9017 / 9018.

- **Décision** : **NAA est le seul chemin**, sans repli. Le plan du brief décrit un repli qui
  ne fonctionnerait plus ; il est retiré.
- **Conséquence** : le build minimal d'Outlook devient une exigence dure, pas un confort.
- **Alternative écartée** : flux on-behalf-of côté serveur — inutile puisque Graph accepte les
  appels navigateur, et il remettrait un secret client dans la boucle.

### B-2. Builds minimaux — `NestedAppAuth 1.1`

| Client | Minimum |
| --- | --- |
| Outlook sur le web | supporté |
| Outlook Windows, abonnement Microsoft 365 | version 2409, build 18025.20000 |
| Outlook Windows, perpétuel retail | version 2501, build 18429.20132 |
| Outlook Windows, perpétuel volume / LTSC | version 2408, build 17932.20222 |

Le jeu d'exigences **ne peut pas être déclaré dans le manifeste** d'un complément Outlook :
il se teste à l'exécution par `Office.context.requirements.isSetSupported('NestedAppAuth', '1.1')`.

- **Décision** : au démarrage du panneau, si le jeu n'est pas supporté, afficher un message en
  français nommant la version requise, et ne rien tenter. C'est un état d'interface de plus,
  à ajouter au tableau du brief.

### B-3. Le backend valide un jeton d'accès, jamais l'ID token

La documentation Microsoft qualifie la validation de l'ID token d'anti-patron de sécurité :
« Passing the ID token over a network call to enable or authorize access to a service is a
security anti-pattern. » Il faut un **scope personnalisé** sur l'API exposée, et le backend
valide le jeton d'accès émis pour ce scope.

- **Décision** : conforme au brief (`ENTRA_API_CLIENT_ID`, API exposée). Validation par `jose` :
  signature contre les JWKS de l'émetteur, `iss`, `aud`, `exp`, puis `tid` contre
  `ENTRA_TENANT_IDS`. L'email vient de la revendication du jeton et alimente `findUser`.
- MSAL renvoie toujours trois jetons et exige **au moins un scope de ressource** dans la
  demande, sinon aucun jeton d'accès n'est émis.

### B-4. Accès conditionnel — à annoncer au client

L'octroi d'accès conditionnel « approved client app » est retiré depuis mars 2026 et **n'est
pas supporté par MSAL NAA** : il provoque des erreurs de connexion même avec une exception.
L'administrateur doit l'avoir remplacé par un octroi « application protection policy ».

- **Décision** : ajouter ce point à la note de prérequis destinée au client.

---

## C. Microsoft Graph

### C-1. Récupérer le fil

`GET /me/messages?$filter=conversationId eq '{id}'`, avec l'en-tête
`Prefer: outlook.body-content-type="text"` qui rend `body` **et** `uniqueBody` en texte brut.
`uniqueBody` donne le message débarrassé des citations des précédents, ce qu'exige l'entité
Message de la spécification.

### C-2. Ne pas combiner `$filter` et `$orderby`

Sur `messages`, Graph impose que toute propriété de `$orderby` apparaisse aussi dans
`$filter`, et avant les propriétés qui n'y sont pas. Un
`$filter=conversationId eq '…'&$orderby=receivedDateTime` tombe donc en erreur.

- **Décision** : pas de `$orderby`. Pagination suivie jusqu'au bout via `@odata.nextLink`,
  puis **tri chronologique côté client** sur `receivedDateTime`. Un fil tient de toute façon
  en mémoire.
- **Alternative écartée** : `$search`, qui ne se combine pas avec `$filter`.

### C-4. Un fil n'est pas une liste d'échanges, c'est une liste de copies — **constaté en production**

Une note rendait quatre encadrés pour trois mails. Le quatrième ne contenait rien d'autre
qu'une signature Outlook pour Mac, un bloc `De : / Date : / À : / Objet :` et la répétition
du message précédent.

Trois causes se cumulent, et aucune n'est un bug de notre code :

1. `/me/messages` balaie **toute la boîte**, dossiers compris. Une réponse envoyée revient
   donc en double — la copie dans Éléments envoyés et celle reçue — avec deux `id` Graph
   différents. La seule chose que les deux copies partagent est le Message-ID RFC 5322,
   exposé par Graph sous `internetMessageId` : c'est **l'identité d'un mail**, là où `id`
   n'est que l'identité d'une copie.
2. `uniqueBody` doit rendre la partie neuve d'une réponse sans l'historique. Sur la forme
   que compose Outlook pour Mac — texte neuf **au-dessus** de l'en-tête cité —
   l'heuristique rend parfois exactement l'inverse : la part qu'elle aurait dû retirer.
3. « Envoyé à partir d'Outlook pour Mac » n'a été écrit par personne.

- **Décision** : `src/outlook/unique.ts`. Le texte est coupé au premier marqueur de
  citation (séparateur Outlook, attribution « … a écrit : », ou bloc d'en-tête — trois
  lignes `Libellé :` consécutives dont un `De :`, jamais moins, pour qu'un « Objet : relance »
  écrit à la main survive) ; les signatures d'appareil et les lignes `>` sont retirées ;
  puis les copies sont repliées sur `internetMessageId`, avec l'égalité de texte à
  expéditeur identique comme filet, au-delà de 40 caractères — « Ok » deux fois dans un fil,
  ce sont deux mails.
- Un message qui **avait** du texte et n'en a plus après nettoyage est écarté : il ne
  contenait que les mots d'un autre. Un message **vide à l'arrivée** est conservé, parce
  qu'il a réellement été envoyé. C'est cette distinction qui justifie que le nettoyage
  rende un `{ text, quoteOnly }` plutôt qu'une chaîne.
- Les brouillons (`isDraft`) sont exclus : un brouillon est un mail que personne n'a reçu.
- Garde-fou : si tout le fil se révélait être de la citation, la liste d'origine est rendue
  telle quelle. Un panneau vide n'explique rien.
- Les identifiants Graph des copies effacées voyagent dans `copyIds`, et ce n'est pas de la
  comptabilité : la marque « Dernier message » d'une note déjà enrichie peut nommer une
  copie que le repli fait disparaître. Sans les alias, le serveur ne retrouverait plus le
  repère et réécrirait le fil entier. Vérifié au banc : un repère portant l'identifiant de
  la copie supprimée rend exactement le même décompte que celui du mail conservé.
- **Filtré côté client**, dans `graph.ts`, parce que c'est là que vit la connaissance de
  Graph — et parce que le compteur « n messages identifiés », la marque « Dernier message »
  et le décompte des nouveaux retombent alors tous sur la même liste.

### C-3. Permission

`Mail.Read` déléguée, jeton NAA distinct de celui du backend. Graph accepte l'appel depuis le
navigateur, donc aucun flux serveur.

---

## D. Notion — écriture des messages dans le corps de la page

### D-1. Limites de l'API

- 2 000 caractères par élément de rich text (déjà géré par `richText()` dans
  `functions/api/notes.ts`, réutilisable tel quel) ;
- 100 blocs par requête `PATCH /v1/blocks/{id}/children` ;
- deux niveaux d'imbrication par requête — suffisant pour `callout > (divider, paragraphes)`.

### D-2. Le modèle par défaut est appliqué après la création — **vérifié dans le dépôt**

`functions/api/notes.ts` le documente déjà : « Notion applies it after the page is created, so
the response comes back blank; `children` cannot be used with it. » La route passe
`template: { type: "template_id", template_id }` et ne peut pas fournir `children`.

- **Décision** : après création, interroger les enfants de la page jusqu'à ce que le modèle
  soit posé (quelques essais espacés, plafonnés), puis ajouter les blocs du mail à la fin. Au
  dépassement du plafond, ajouter quand même et le signaler : perdre l'ordre est acceptable,
  perdre le mail ne l'est pas (principe VI).

### D-3. Reconnaissance des contacts en une seule requête

Le brief propose de lire la propriété Email de toute la base. Avec la sonde A-4, mieux est
possible : un filtre composé `or` de `Email.contains` sur chaque adresse externe du fil tient
en **une requête**, indépendamment de la taille de la base comme du nombre de participants.

`contains` étant une sous-chaîne, `o@m.com` trouverait `theo@m.com`. Le serveur découpe donc
les valeurs retournées sur les virgules et **revérifie l'égalité exacte**, en minuscules,
avant de déclarer un contact reconnu.

- **Décision** : un filtre `or` pour restreindre, l'égalité exacte pour conclure. Une requête,
  sémantique juste — principe VII tenu.
- **Alternative écartée** : une requête par adresse (N appels, plafond Notion de 3 req/s
  atteint sur un fil à dix participants).

### D-4. L'icône d'un encadré se nomme, elle ne s'adresse pas — **vérifié contre la base réelle le 3 octobre 2026**

Quatre formes ont été postées sur une page jetable, puis relues :

| Envoyé | Résultat |
| --- | --- |
| `{ type: "icon", icon: { name: "conversation", color: "gray" } }` | 200, **stocké tel quel** |
| `{ type: "external", external: { url: ".../icons/conversation_gray.svg" } }` | 200, mais **réécrit** par Notion dans la forme ci-dessus |
| `{ type: "custom_emoji", custom_emoji: { name: "conversation" } }` | 400 — `custom_emoji.id` exigé |
| `{ name: "conversation", color: "gray" }` | 400 |

- **Décision** : la forme native nommée. L'URL externe marche, mais elle décrit par un
  fichier ce que l'API sait désigner par son nom, et c'est Notion qui finit par la traduire.
- `color: "gray_background"` sur l'encadré : accepté et relu tel quel.

---

## E. Hébergement

### E-1. La feature n'exige pas la migration — **vérifié**

Le brief présente la migration Cloudflare Pages → Vercel comme un préalable. Les trois motifs
techniques avancés tiennent tous sur Pages :

| Motif du brief | Constat |
| --- | --- |
| Désactiver COOP/COEP sur `/outlook*` | `_headers` de Pages supporte la **suppression** d'un en-tête posé par une règle plus large, par le préfixe `! ` : `/outlook*` puis `! Cross-Origin-Embedder-Policy`. |
| Une route `PATCH` | Pages Functions exporte `onRequestPatch`, comme les autres verbes. |
| Seconde entrée Vite | Affaire de `build.rollupOptions.input`, indifférente à l'hôte. |

Le motif réel du brief est ailleurs : « Le README écarte Vercel parce que le plan gratuit
interdit l'usage commercial : le déploiement doit être sur un plan Pro. » C'est une décision
de plateforme et de coût, pas une contrainte de la feature.

- **Décision, arbitrée le 2026-10-03** : la migration est **retenue**, sur le plan gratuit.
  Théo a tranché le motif de coût : le projet n'a pas d'usage commercial, donc le plan gratuit
  suffit et la réserve du README tombe. Elle reste placée hors du chemin critique, en phase
  propre, après que le complément fonctionne sur Pages : elle est ainsi exécutable sans que le
  MVP en dépende. La grille de convergence de la dictée est le garde-fou.
- **À reconfirmer si l'usage change** : les conditions du plan gratuit de Vercel excluent
  l'usage commercial. L'outil sert aujourd'hui l'organisation en interne ; s'il devait un jour
  servir une prestation facturée, le plan serait à revoir. Noté une fois, pas un obstacle.
- **Risque assumé** : c'est l'élément le plus risqué du lot, parce qu'il touche une
  application qui tourne et que la dictée dépend d'en-têtes d'isolation exacts pour ouvrir le
  microphone sur iPhone.

### E-2. Service worker

`navigateFallbackDenylist` ne couvre aujourd'hui que `/^\/api\//`. Sans ajout, le service
worker de la dictée, de portée `/`, répondrait l'app de dictée sur `/outlook`.

- **Décision** : ajouter `/^\/outlook/` à la liste, et vérifier sur un appareil ayant déjà
  installé la PWA — c'est là que le service worker est le plus ancien.

### E-3. Office.js

Chargé depuis `https://appsforoffice.microsoft.com/lib/1/hosted/office.js`, jamais bundlé
(Microsoft ne supporte pas une copie locale). C'est exactement ce que COEP `require-corp`
bloquerait : d'où E-2 et la suppression d'en-tête de E-1.

---

### E-4. Vite et Node ne résolvent pas les imports pareil — **constaté en production**

**Symptôme.** Déploiement du 2026-10-03 : les en-têtes d'isolation corrects, le panneau qui
s'ouvre, et les **huit** routes qui répondent 500.

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/functions/api/outlook/notes'
  imported from /var/task/api/outlook/notes.js
```

**Cause.** `package.json` porte `"type": "module"`, et `tsconfig.node.json` portait
`moduleResolution: "bundler"`. Le résolveur de Vite fait correspondre `"../functions/api/notes"`
à un fichier `.ts` ; Node en ESM résout le chemin littéral et n'ajoute aucune extension. Vercel
transpile sans empaqueter — les spécificateurs sortent intacts — donc le code qui marchait en dev
ne pouvait pas démarrer en production. Les routes de la dictée tombaient avec celles du
complément : même pont `api/`.

**Ce qui rendait la panne invisible.** `bundler` est un contrat exact pour `src/`, que rolldown
empaquette, et un mensonge pour `functions/` et `api/`, que Node exécute. Le typecheck validait
donc du code que Node refuse. Le build passait, la dictée passait en local, et rien n'avertissait.

**Correction.** Extension explicite sur les 36 imports relatifs de `api/` et `functions/`, et
`moduleResolution: "nodenext"` dans `tsconfig.node.json` pour que l'erreur devienne une erreur de
compilation (`TS2835`) au lieu d'un 500. `tsc -b` étant dans `npm run build`, le déploiement ne
peut plus partir avec cette faute. Second filet : `npm run check:api`
(`scripts/check-api.mjs`) reproduit la séquence de Vercel — transpilation seule, puis import par
le résolveur de Node — et vérifie les handlers exportés.

**Pourquoi pas l'empaquetage des fonctions**, l'autre option : il ajoutait une étape de build
propre à Vercel pour contourner un problème dont la cause était une configuration inexacte. Rendre
la configuration exacte corrige la cause et transforme la classe d'erreur en erreur de compilation.

**Vérifié.** Avant correction, les 8 routes échouent sous Node avec le message de production, mot
pour mot. Après, les 8 démarrent et exportent leurs handlers. En dev, `/api/contacts` rend
toujours 237 contacts et `/api/companies` 160 sociétés.

## G. Manifeste du complément

### G-1. `SupportsPinning` impose deux `VersionOverrides` imbriquées — **vérifié**

Le premier sideload sur Outlook sur le web a échoué sur « The installation is taking longer
than expected », sans autre indice. `npx office-addin-manifest validate` donne la cause en une
ligne :

> The element 'Action' in namespace '…/mailappversionoverrides' has invalid child element
> 'SupportsPinning'.

`SupportsPinning` n'existe que dans le schéma `mailappversionoverrides/1.1`, et ce bloc doit
être **imbriqué dans** celui de la version 1.0, qui reste requis pour les hôtes qui ne
comprennent que lui. Les deux blocs décrivent donc le même bouton, celui de 1.1 ajoutant
l'épinglage.

- **Décision** : structure imbriquée, et `office-addin-manifest validate` exécuté après toute
  modification du gabarit. Un manifeste bien formé en XML n'est pas un manifeste valide, et
  Outlook ne dit pas lequel des deux manque.
- **Conséquence** : `FunctionFile` est requis par `DesktopFormFactor`. Il pointe désormais sur
  `public/outlook/commands.html`, une page vide. Le faire pointer sur le taskpane ferait
  tourner tout le panneau — MSAL compris — dans la frame cachée qu'Outlook charge pour
  résoudre les actions, soit une demande de jeton que personne n'a demandée.
- **Conséquence** : `SupportUrl` pointait sur `/outlook/`, qui ne répond que grâce au repli du
  serveur de développement ; en production il aurait servi l'application de dictée. Il pointe
  sur le taskpane.

### G-2. Chrome bloque localhost depuis Outlook sur le web — **vérifié, et aucun en-tête n'y peut rien**

Après la correction du manifeste, le sideload échoue encore sur Chrome, et la console donne
`localhost:5173/outlook/icon-128.png net::ERR_FAILED`, **sans erreur de certificat**.

C'est *Local Network Access*. Une origine publique — `outlook.office.com` — demande une
origine loopback, et Chrome le refuse depuis la version 141.

- **L'en-tête `Access-Control-Allow-Private-Network` ne résout pas ce cas.** Il appartient au
  modèle précédent, *Private Network Access*, que LNA remplace. Sous LNA la barrière est une
  **permission utilisateur**, et elle est détenue par le site **englobant** : la page de
  Microsoft, pas la nôtre. Une iframe ne l'obtient que par délégation
  (`Permissions-Policy: local-network-access`), ce qu'Outlook n'accorde pas.
- **Décision** : l'en-tête est tout de même renvoyé, mais seulement en réponse à un préflight
  qui le demande, et seulement sur `/outlook*`. Il couvre les navigateurs Chromium encore sur
  PNA — ce qui inclut des WebView2 en retard, donc le nouvel Outlook Windows. Il ne coûte
  qu'une branche et ne s'exécute que si un navigateur pose réellement la question.
- **Contournements, par ordre de solidité** :
  1. **Servir le taskpane depuis une origine publique.** C'est la vraie réponse, et la
     migration vers `mosaicref.vercel.app` est déjà décidée, ses redirections Entra déjà
     déclarées. Cela retire localhost de la boucle.
  2. **Safari**, qui n'applique pas LNA.
  3. **Politique d'entreprise `LocalNetworkAccessAllowedForUrls`** sur
     `https://outlook.office.com`. Supportée, contrairement au drapeau.
  4. `about://flags/#local-network-access-check`, pour une session de développement. L'ancien
     `LocalNetworkAccessRestrictionsTemporaryOptOut` disparaît avec Chrome 156.

### G-3. office.js se charge hors d'Outlook, et le panneau s'y trompait — **corrigé**

`Office.onReady` se résout dans n'importe quel onglet : la bibliothèque vient du CDN et
s'initialise sans hôte. Le panneau en déduisait la présence d'Outlook, puis constatait
l'absence de `NestedAppAuth` et annonçait **« Cette version d'Outlook est trop ancienne »** à
quelqu'un qui n'utilisait pas Outlook du tout.

Ce qui distingue un hôte n'est pas la bibliothèque mais la boîte mail. `inMailbox()` teste
`Office.context.mailbox`, et il est consulté **avant** le test de version. Les trois cas sont
désormais distincts, vérifiés au navigateur : pas d'office.js, office.js sans boîte mail, et
un Outlook réel trop ancien — qui lui mérite bien son message.

### G-4. Le manifeste n'est pas en cause pour le clic sans effet — **audité**

Les trois points soupçonnés sont corrects :

- **Règle d'activation** : `<Rule xsi:type="ItemIs" ItemType="Message" FormType="Read" />` dans
  une collection `Mode="Or"`, ce qui couvre tout mail reçu ordinaire en lecture.
- **Surface** : `MessageReadCommandSurface`, déclarée dans le bloc 1.0 **et** dans le 1.1.
- **SourceLocation** : `https://<hôte>/outlook.html`, dans `FormSettings` comme dans les
  `Resources` des deux blocs.

Et le bouton apparaît bien dans le ruban, ce qui prouve que l'activation fonctionne : un hôte
qui n'aurait pas retenu la règle n'afficherait rien. Un clic qui ne déclenche aucune requête
signifie que l'hôte n'a jamais tenté l'URL, donc que la cause est en amont du manifeste.

Safari n'est pas une échappatoire : macOS a lui aussi une autorisation « réseau local », et
un refus y est silencieux. La conclusion de G-2 tient pour les deux navigateurs — il faut une
origine publique.

### G-5. Le panneau ouvert depuis le ruban du haut : c'est Outlook qui le referme — **documenté chez Microsoft**

**Constat (Théo, 2026-10-03).** Depuis le bouton d'applications de l'en-tête d'un message, le
panneau s'ouvre. Depuis le bouton d'applications du ruban du haut, en vue conversation, il se
referme aussitôt, « ouvert sans message sélectionné ».

**Ce n'est pas le code.** `grep` sur `src/outlook/` : aucun appel à
`Office.context.ui.closeContainer()`, à `window.close()` ni à quoi que ce soit qui ferme le
panneau. Rien dans le complément ne peut le fermer.

**C'est l'hôte, et c'est écrit.** Un complément de la surface `MessageReadCommandSurface` est lié
à un élément. Microsoft l'énonce pour Outlook sur le web et le nouvel Outlook Windows :

> « add-ins that implement no item context don't activate when the Reading Pane is hidden or when
> a message isn't selected. This is because add-in commands in Outlook on the web don't appear on
> the ribbon. To activate an add-in from the Message Read surface, you must first select a
> message, then select the add-in command from the message action bar. »

Le point d'entrée pris en charge est donc la barre d'actions du message — exactement celui qui
marche. Le bouton du ruban du haut n'est pas la commande du complément : Outlook ouvre le conteneur
sans contexte d'élément, puis le détruit.

**`SupportsNoItemContext` ne corrigerait pas ce symptôme**, et coûte cher :

| | |
| --- | --- |
| Effet réel | Active le multi-sélection et l'épinglage, **pas** l'activation sans message sur le web |
| Schéma | Enfant de `<Action>`, dans les `VersionOverrides` 1.1 uniquement |
| Jeu d'exigences | `DefaultMinVersion` à passer de 1.5 à **1.13**, ce qui écarte les hôtes en dessous |
| Lecture de la sélection | `getSelectedItemsAsync` (Mailbox 1.13) ; `conversationId` n'arrive qu'en **1.14** |
| Permission | **`ReadWriteMailbox`** au lieu de `ReadItem` — un nouveau consentement administrateur, pour un complément qui ne fait que lire |
| Écueil connu | `getSelectedItemsAsync` échoue avec « Invalid operation (getSelectedItemsAsync) when `Office.context.mailbox.item` is null », soit précisément notre cas |

**Décision.** On ne déclare pas `SupportsNoItemContext`. Récupérer le dernier message de la
conversation affichée sans message sélectionné n'est pas faisable sur ce chemin, et l'échanger
contre `ReadWriteMailbox` pour un complément en lecture seule est hors de proportion.

**Corrigé quand même, parce que l'état était atteignable et muet.** Deux choses :

1. `mailbox.item` peut être `null` pendant qu'Outlook charge encore les métadonnées du volet de
   lecture. Lu une seule fois, un panneau ouvert sur un mail parfaitement ordinaire s'arrêtait sur
   « aucun mail » et y restait. `awaitItem()` dans `src/outlook/office.ts` l'attend (12 × 150 ms).
   Vérifié : un élément qui arrive après 400 ms est bien repris.
2. L'état sans message dit maintenant « Sélectionnez un message pour l'envoyer vers Notion »,
   nomme le bon point d'entrée et porte un bouton « Réessayer ». Il n'est plus un cul-de-sac.

Sources : [Activate your Outlook add-in without the Reading Pane enabled or a message
selected](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/contextless),
[SelectedItemDetails](https://learn.microsoft.com/en-us/javascript/api/outlook/office.selecteditemdetails),
[office-js#3680](https://github.com/OfficeDev/office-js/issues/3680).

## F. Inconnues restantes

Les deux dépendances bloquantes sont levées. La seule question ouverte ne bloque que la convergence.

| Sujet | Qui tranche | Statut |
| --- | --- | --- |
| Limite de pages de `Interlocuteur` | Théo, interface Notion | **Levé le 2026-10-03** : pas de limite |
| Hébergement | Théo | **Tranché le 2026-10-03** : Vercel, plan gratuit |
| Prompt Notion AI pour les notes de source Email | Théo, dans Notion | Ouvert, avant la convergence |
