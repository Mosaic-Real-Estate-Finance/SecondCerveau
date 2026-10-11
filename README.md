# Mosaic Dictée

PWA de dictée vocale vers la base de notes Notion — et, depuis la feature 002, l'écran où l'on valide les réunions Read AI avant qu'elles n'entrent dans le CRM. La transcription se fait en direct chez Soniox pendant que l'on parle, le texte brut part dans Notion, et Notion AI le met au propre.

Trois écrans, dans cet ordre : dicter, choisir le contact, joindre un document
si besoin. L'envoi part du troisième. Il n'y a pas d'écran de relecture : la
dictée n'est ni réécoutée ni relue. Le texte s'affiche pendant qu'on parle
et il est arrêté une seconde après « terminer » ; il est donc prêt bien
avant l'envoi. S'il ne l'est pas — la dictée a dû être retranscrite depuis
l'enregistrement —, le bouton l'attend au lieu de refuser.

## Démarrer

```bash
npm install
cp .env.example .env.local   # renseigner le token et les deux bases
npm run dev
```

Le serveur de dev exécute les mêmes Functions que la production (`functions/api/*`) : aucun second serveur à lancer.

## Configurer Notion

1. Créer une intégration interne, puis la partager avec la base Contacts et la base de notes.
2. **Base Contacts** : ajouter un rollup `Nom société` (relation `Société`, propriété titre, afficher l'original). Sans lui, l'API fait un appel par société et l'écran de sélection ralentit.
3. **Base de notes** : une relation `Contact` vers Contacts, et une colonne fichier `Fichiers` pour les pièces jointes (nom surchargeable dans `NOTES_PROP_FILE`). Recommandé : une colonne texte (par exemple `ID dictée`) déclarée dans `NOTES_PROP_CLIENT_ID`, qui empêche les doublons quand un envoi est rejoué.
4. Noms de colonnes différents : les surcharger dans les variables `*_PROP_*`.
5. **Notes** : la transcription part dans `Transcription brute`, l'auteur dans `Auteur`, et la page est créée depuis le modèle par défaut de la base (onglet Modèles dans Notion).

## Utilisateurs autorisés et connexion

`functions/_lib/users.ts` porte la liste des adresses et l'identifiant Notion associé, utilisé pour la propriété `Auteur`. Pour ajouter quelqu'un, ajouter une ligne avec son identifiant (la commande figure en tête du fichier). Retirer une ligne ferme aussi les sessions ouvertes de cette adresse.

On entre dans l'app avec un **code à six chiffres reçu par email** (Gmail SMTP, mot de passe d'application). L'écran d'accès répond pareil qu'une adresse soit dans la liste ou non. Un code vaut 10 minutes, sert une fois, supporte 5 essais ; on ne peut en redemander qu'un par minute et cinq par heure. Le bon code ouvre une session dans un cookie `HttpOnly`, valable 90 jours et prolongée à chaque lancement de l'app ; « Se déconnecter », dans les réglages, la révoque. L'ancien en-tête `x-user-email` n'ouvre plus rien : une PWA installée avant ce changement repasse une fois par l'écran d'accès. Le complément Outlook n'est pas concerné : il s'authentifie par son jeton Microsoft. Seul un panneau lancé sans Entra configuré (développement local), qui se rabattait sur l'en-tête, reçoit désormais 401.

## Synchronisation Read AI

Les réunions avec des contacts externes enregistrées par Read AI arrivent seules dans Notes (spec : `specs/002-readai-vers-notion/`).

- Read AI pousse le rapport de chaque réunion terminée vers `POST /api/readai/webhook`, signé (HMAC-SHA256 du corps, clé `READAI_WEBHOOK_SECRET` décodée en base64). La réponse part tout de suite ; le traitement continue après.
- Les participants internes (`INTERNAL_DOMAINS`) ne sont jamais des contacts ; ceux de `users.ts` deviennent les `Auteur`. Les externes sont rapprochés de Contacts en **une** requête, par email exact.
- Tous reconnus : la note est créée (titre, date et heure, `Source` = `ReadAI`, contacts, `ID client` = clé de réunion), avec deux encadrés, « Résumé » et « Transcription ».
- Une personne inconnue : **rien n'est écrit dans Notion**. L'appel attend dans l'écran « À valider » (accès en haut de l'accueil) : rattacher à un contact existant, créer un contact, ou « pas nécessaire ». La note part quand tout le monde est tranché.
- Deux collaborateurs qui enregistrent la même réunion produisent une seule note.
- La file d'attente vit dans Upstash Redis (Vercel Marketplace). Un appel en attente y est conservé en entier jusqu'à la décision, puis effacé (constitution 2.0.0, principe II). Aucun contenu de réunion, nom ni email n'est journalisé.

Avant de déployer : `npm run check:readai` (schéma Notion, en lecture seule), `npm run test:readai` (règles de filtrage et de rapprochement), `npm run sim:readai` (parcours complets contre un Notion et un Redis simulés). Les prérequis (webhook Read AI, Upstash, Gmail, clés VAPID) sont dans `specs/002-readai-vers-notion/quickstart.md`.

## Complément Outlook : pièces jointes et mobile

Depuis la version 1.4.0.0 du manifeste (feature 003), le complément « Save to Notion » fonctionne aussi dans Outlook sur iPhone et Android (build 4.2433.0 ou plus, compte Microsoft 365), et il importe les pièces jointes du fil dans la colonne `Fichiers` de la note (`NOTES_PROP_FILE`).

Le panneau ne transporte jamais les fichiers : le serveur Vercel n'accepte que 4,5 Mo par requête. Pour chaque fichier coché, le panneau appelle `POST /api/outlook/attachments` avec la référence de la pièce jointe et son jeton Graph délégué (`Mail.Read`, déjà consenti) ; le serveur télécharge le fichier chez Microsoft et l'envoie à Notion, en plusieurs parties au-delà de 20 Mo. Aucune permission ni variable d'environnement nouvelle. Les images intégrées au corps, `winmail.dat` et les invitations `.ics` sont ignorées ; un fichier au-dessus de la limite du workspace Notion est listé comme non importé, sans empêcher la note. À l'enrichissement, seuls les fichiers des nouveaux messages sont ajoutés, dans la même écriture que la marque « Dernier message ».

Avant la mise en production : `node --env-file=.env.local scripts/check-attachments.mjs` vérifie sur la vraie base que Notion conserve les fichiers existants quand la colonne est réécrite. Tests : `npm run test:outlook`. Le manifeste changé doit être redéployé par l'administrateur Microsoft 365 (`https://mosaic.gouman.fr/outlook/manifest.xml`). Détails : `specs/003-outlook-mobile-pieces-jointes/`.

## Notifications

Dans l'app installée (iOS 16.4 et plus), « Recevoir les notifications » dans les réglages. Elles partent à tous ceux qui les ont activées : réunion ajoutée, personnes à valider, réunion non enregistrée. Jamais de résumé ni de transcription. Le service worker reste généré par `vite-plugin-pwa` ; `public/push-sw.js` lui ajoute les deux écouteurs `push` et `notificationclick` par `importScripts`, sans toucher au cache.

## Déployer (Vercel)

- Le projet Vercel est relié au dépôt : chaque push sur `main` part en production, chaque autre branche en prévisualisation.
- Build : `npm run build`, dossier `dist` (déclarés dans `vercel.json`). Les fonctions serveur sont les fichiers de `api/`, de simples enveloppes autour des handlers de `functions/api/`.
- **`api/` contient douze fichiers, le plafond du plan.** Une route nouvelle se greffe sur une fonction existante — `api/auth/[action].ts` et `api/readai/[action].ts` aiguillent sur le dernier segment du chemin — plutôt que d'ajouter un fichier.
- Variables : celles de `.env.example`, dans Settings → Environment Variables. `NOTION_TOKEN`, `SONIOX_API_KEY`, `SESSION_SECRET`, les mots de passe et les clés privées en type *Sensitive*. Une variable `VITE_*` est lue au build : la changer demande un redéploiement.
- En-têtes, durées maximales des fonctions et réécritures : `vercel.json`, et lui seul.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `src/lib/use-recorder.ts` | MediaRecorder + AnalyserNode, sauvegarde partielle toutes les 5 s, mise en pause quand le lien ou l'onglet tombe |
| `src/lib/audio-capture.ts` | Le PCM 16 kHz pris en direct sur le graphe audio, en flux continu |
| `src/lib/soniox.ts` | Le WebSocket Soniox : configuration, audio, tokens, tampon des dernières secondes et reconnexion |
| `src/lib/vocabulary.ts` | Les termes métier envoyés comme contexte à chaque flux |
| `src/lib/notes.ts` | Cache IndexedDB : l'audio y reste jusqu'à confirmation Notion |
| `src/lib/pipeline.ts` | Reprise au lancement, finalisation du flux ou retranscription de l'enregistrement, envoi, wake lock |
| `functions/api/auth.ts` | Connexion, et `stt-token` : la clé Soniox temporaire, réservée à un utilisateur connecté |
| `functions/api/*` | Proxy Notion (l'API Notion refuse le CORS, et le token reste serveur) |
| `functions/api/readai/` | Le webhook Read AI et les routes de l'écran « À valider » (une seule fonction Vercel pour toutes, le plan Hobby s'arrête à 12) |
| `functions/_lib/readai/` | Signature, répartition des participants, rapprochement, clé de réunion, note, file d'attente |
| `functions/_lib/session.ts` | Codes de connexion et sessions |
| `src/screens/ReviewScreen.tsx` | L'écran « À valider » |
| `src/screens/SettingsScreen.tsx` | Notifications et déconnexion |
| `src/components/voice-recorder.tsx` | Design Rare UI d'origine, adapté à l'enregistrement |
| `src/screens/AttachScreen.tsx` | Dernière étape : la pièce jointe, facultative, puis l'envoi — qui attend la transcription si elle tourne encore |
| `functions/api/files.ts` | Upload d'un document ou d'une photo vers Notion, rattaché à la colonne `Fichiers` de la note |
| `src/styles/transitions/` | `_root.css` et snippets transitions.dev, collés tels quels |
| `public/pwa-install-animation.html` | Animation d'installation du dépôt `La-Releve/Simulateur-Faisabilit-` (commit `2ca074f`), copiée telle quelle. Seul diffère : la couleur de marque, le nom, l'icône, le domaine et les trois contacts de la feuille de partage. Ses images vivent dans `public/pwa-anim/` |
| `src/components/install-invite.tsx` | Mise en page de `components/simulateur/install-guide.tsx` du même dépôt : animation encastrée en haut de la feuille, bord à bord, puis les étapes numérotées avec les glyphes iOS |
| `src/lib/phone.ts` | 98 indicatifs et le découpage national de chacun. Les noms de pays viennent d'`Intl.DisplayNames`, donc ils suivent l'orthographe de la plateforme |
| `src/lib/schedule.ts` | `afterTransition` : ce qui coûte cher (décodage audio) attend la fin de la transition de page |

### Le piège WebKit qui faisait perdre des dictées

WebKit **ne sait pas stocker un `Blob` dans IndexedDB** : il n'en garde qu'une
référence vers un fichier qu'il gère lui-même, et ce fichier peut avoir
disparu à la relecture — l'erreur est alors « The object can not be found
here », et l'enregistrement est perdu. En navigation privée, l'écriture
échoue d'emblée ([WebKit 188438](https://bugs.webkit.org/show_bug.cgi?id=188438),
[198278](https://bugs.webkit.org/show_bug.cgi?id=198278)).

Mesuré dans WebKit : `put(ArrayBuffer)` → **ok**, `put(Blob)` → **transaction
annulée**. L'audio est donc stocké en octets bruts (`audio: ArrayBuffer` +
`mimeType`), copiés dans la base par valeur.

Deux garde-fous par-dessus :

- **La mémoire est la source de vérité, la base est la durabilité en
  dessous.** Une écriture qui échoue coûte le filet en cas de crash, jamais
  la dictée en cours. `saveNote` ne rejette plus.
- **Le texte est aussi miroité dans `localStorage`** (tout sauf l'audio,
  20 notes, écrit à chaque lancement). Vérifié : base entièrement supprimée,
  la note et sa transcription sont toujours là.

### Le texte pendant la dictée

La transcription tournait sur le téléphone, avec Whisper en WASM. Sur WebKit
elle n'avait droit qu'à un seul thread, et il fallait 10 à 20 s entre le
dernier mot et le texte. Elle part désormais chez Soniox en temps réel : le
texte s'écrit pendant qu'on parle, et « terminer » ne fait plus qu'arrêter ce
qui est déjà là.

**Le navigateur ne voit jamais la clé du compte.** Il demande à
`POST /api/auth/stt-token` une clé temporaire, valable une minute et pour un
seul flux, que le serveur fabrique chez Soniox avec `SONIOX_API_KEY`. La
route passe par le même contrôle de session que les autres : seul un
utilisateur connecté en obtient une. Elle renvoie aussi l'adresse du
WebSocket et le modèle, si bien qu'on change de région ou de modèle par
variable d'environnement, sans toucher au front. L'hôte qui fabrique la clé
se déduit de celui du WebSocket (`stt-rt.eu.soniox.com` → `api.eu.soniox.com`),
parce qu'une clé n'est valable que dans sa région. Elle voyage dans les
sous-protocoles du WebSocket : un navigateur ne peut pas y poser d'en-tête, et
la clé dans le premier message est dépréciée chez Soniox.

**Le son est pris sur le graphe audio**, à côté de l'enregistrement mp4 qui,
lui, est gardé. `audio-capture.ts` en tire du PCM 16 kHz mono, rééchantillonné
par quarts de seconde, et `soniox.ts` l'envoie en continu. Le flux est
configuré en français (`language_hints`) avec le glossaire de
`vocabulary.ts` comme contexte : les noms propres et le jargon sont ce qu'un
modèle généraliste rate, et quelques centaines de termes ne coûtent rien.

**Deux sortes de mots reviennent.** Les non-finaux sont une hypothèse qui
peut encore changer ; les finaux ne sont envoyés qu'une fois et ne bougent
plus. L'écran montre les finaux suivis de l'hypothèse du moment, reconstruite
à chaque message, dans le champ `partial` de la note. Ce champ change
plusieurs fois par seconde : il n'est écrit qu'en mémoire, sans quoi chaque
mot recopierait dans IndexedDB l'enregistrement entier, qui grossit.

**« Terminer »** envoie deux dixièmes de seconde de silence puis la commande
de finalisation ; Soniox rend alors tout en final et signale la fin par un
marqueur. Le texte passe dans `transcript`, statut `transcribed`, et le reste
du parcours ne change pas.

### Une coupure ne perd pas la dictée

Un WebSocket peut rester « ouvert » plusieurs secondes après que plus rien ne
passe. Et iOS suspend l'onglet quand l'écran se verrouille ou qu'une autre
app passe devant — le cas de loin le plus fréquent, bien plus qu'une vraie
coupure réseau. Vus d'ici, les deux se ressemblent, et ils sont traités pareil.

**Les dernières secondes de PCM sont gardées.** Chaque mot final porte
l'instant où son audio se termine : le flux sait toujours jusqu'où Soniox a
réellement entendu. Soniox ne sait pas reprendre une session ; à la
reconnexion, une session neuve est ouverte et tout ce qui suit ce point est
renvoyé. Aucun mot n'est compté deux fois, aucun n'est sauté.

**Le lien est déclaré mort sans attendre la socket** : rien de reçu depuis
8 s alors que de l'audio est parti, une file d'envoi qui ne se vide plus, ou
l'évènement `offline` du téléphone. Une pause ne déclenche rien : elle
n'envoie que des keepalive, auxquels Soniox ne répond pas. La reconnexion se
fait avec un délai croissant, de 0,5 à 8 s, et tout de suite quand le réseau
revient.

**Pendant ce temps l'enregistrement est en pause**, avec un message qui le
dit, et il reprend seul quand le lien revient. Le tampon n'a donc à couvrir
que les quelques secondes qu'il a fallu pour s'en apercevoir ; il en garde 30.
Une reconnexion de moins d'une seconde et demie ne met rien en pause : le
tampon suffit, et une pause qui clignote n'apprend rien à personne. Quand
l'app passe en arrière-plan (`visibilitychange`, `pagehide`),
l'enregistrement est mis en pause et la socket lâchée tout de suite ; au
retour, le flux se reconnecte, renvoie ce qui n'était pas confirmé, et
l'enregistrement reprend.

**Et dessous, l'enregistrement.** Il reste dans IndexedDB jusqu'à ce que
Notion confirme la note. Si le flux n'a pas porté toute la dictée — un tampon
débordé, une capture interrompue, un onglet tué en pleine dictée et retrouvé
au lancement suivant —, le texte en direct est écarté et l'enregistrement est
renvoyé à Soniox depuis le début. À peu près au rythme où il a été dit, car
Soniox demande un débit proche du temps réel et coupe les rafales : c'est
lent, mais c'est un cas rare, et c'est le seul qui sache rendre une dictée
entière.

### Trois façons de faire planter un onglet iOS

Les trois ont été trouvées en une fois, sur le même symptôme : l'onglet meurt
à l'instant où l'enregistrement démarre et la page se recharge.

- **Un `AudioContext` temps réel forcé à 16 kHz** avec un micro branché
  dessus. C'était le moyen le plus simple d'obtenir directement les 16 kHz
  attendus en sortie. Le contexte garde maintenant le taux du matériel, et le
  son est rééchantillonné par un `OfflineAudioContext` à 16 kHz, un quart de
  seconde à la fois — la même mécanique que le décodage d'un enregistrement,
  donc déjà éprouvée sur l'appareil.
- **Le worklet branché sur la sortie audio.** L'usage veut qu'on relie un
  worklet à `destination` par un gain nul, sinon le moteur risque de ne pas
  l'appeler. Mesuré : il est appelé quand même (326 blocs contre 324 sur
  Chromium, 322 contre 319 sur WebKit). Sur iOS, atteindre la sortie veut
  dire toucher à la session audio du système pendant que le micro est
  ouvert ; on ne la touche plus.
- **Le pool de threads** du moteur WASM de Whisper, qui réservait sa mémoire
  d'avance. Il est parti avec le moteur.

Les deux premières règles restent valables avec Soniox : ne jamais forcer le
taux d'échantillonnage du contexte, ne jamais relier le worklet à
`destination`.

### La bande sous la barre flottante d'iOS 26

Safari 26 **ne rend pas le contenu `position: fixed` sous ses contrôles
flottants** ([forum Apple 800798](https://developer.apple.com/forums/thread/800798),
[analyse d'E. Lunardi](https://www.edoardolunardi.dev/blog/safari-26-and-the-strange-case-of-fixed-overlays)).
`viewport-fit=cover` n'y change rien, `lvh` et `dvh` s'arrêtent tous deux sur
la même ligne : aucune longueur CSS ne descend là. Ce qu'on voit en dessous
est le *canvas*, que le navigateur peint avec le fond propagé depuis `html`.

D'où deux réponses, selon ce que l'app peint tout en bas de l'écran :

- **Un voile** (la carte société) : le canvas est repeint de la couleur du
  voile composité sur blanc, `#AEAFC2` — `src/lib/canvas-tint.ts`. Les
  feuilles par le bas sont blanches et rejoignent déjà un canvas blanc, elles
  n'ont donc rien à teinter.
- **La lueur de dictée** : elle ne peut pas descendre, elle arrive donc
  blanche sur la ligne. Son masque s'éteint sur son dernier dixième, ce qui
  ne laisse aucune marche — et fait lire la lumière comme venant de sous le
  bord plutôt que s'arrêtant dessus.

### Trois pièges de mise en page

- **Le morphisme imbriqué.** Le snippet 20 adresse ses parties en sélecteurs descendants. Avec un panneau dans un panneau — une société créée depuis la fiche contact — le panneau extérieur ouvrait aussi le menu du panneau intérieur, dont la boîte vide se posait sur le bouton censé l'ouvrir. L'état fermé du panneau intérieur est réaffirmé dans `index.css`, après les règles qu'il annule.
- **Le bouton `+` est en `position: fixed`.** Il ne peut donc pas être découpé par le défilement de la liste ou du formulaire auquel il appartient, et il continuait de s'afficher par-dessus ce qui se trouvait dessous. Il est mesuré après chaque rendu (la carte de la note le décalait d'une hauteur entière) et masqué dès que son ancre sort de son conteneur de défilement.
- **Ce qui est rendu dans `<body>` sort de sa page.** Un panneau portalisé n'hérite plus ni de l'`opacity` ni de l'`inert` de l'écran auquel il appartient : le bouton « + » de l'écran contacts s'est retrouvé au-dessus de l'accueil, et sans ses insets mesurés il s'ouvrait plein écran par défaut. Chaque panneau relit donc l'`inert` de sa page, et ne s'affiche qu'une fois réellement mesuré — pas à la frame d'avant.
- **Un ancêtre transformé est le bloc conteneur de ses enfants `fixed`, et les découpe à sa boîte.** La page porte un `transform` pour la transition, le menu d'un panneau en porte un pour son entrée. Tout ce qui doit se mesurer sur l'écran est donc rendu dans `<body>` : la bande lumineuse (elle était tranchée net en travers de sa partie la plus vive), la feuille des indicatifs (elle sortait de l'écran et ne se refermait plus) et les panneaux de morphisme. Leur position vient du rectangle de leur ancre, lu dans une frame et non dans un effet de mise en page — deux panneaux qui se remesurent pendant un glissement de page étaient le poste le plus cher du fil principal.

## Licences

- Composant Voice Note de [Rare UI](https://rareui.com) : MIT + Commons Clause + attribution. La licence accepte que le crédit figure dans un README : c'est celui-ci. Le lecteur d'origine a été retiré avec l'écran de relecture ; la pilule d'enregistrement en dérive. Licence complète dans `src/components/ui/LICENSE-rare-ui`.
- [voice-glow](https://libraries.dev/voice.html) (lueur de bas d'écran pendant l'enregistrement) et snippets [transitions.dev](https://transitions.dev) : MIT.

## iOS et PWA

Logiques reprises du dépôt Infrastructure et adaptées à Vite :

| Sujet | Où | Ce que ça règle |
| --- | --- | --- |
| Navigation bornée à 3 s dans le service worker | `vite.config.ts` (`networkTimeoutSeconds`) | L'écran blanc au lancement de la PWA iOS quand le réseau traîne : au-delà de 3 s, la coquille en cache s'affiche |
| `sw.js` jamais mis en cache | `vercel.json` | Une nouvelle version se propage au déploiement suivant, pas des heures après |
| Écrans de lancement iOS | `npm run splash`, `public/splash/` | iOS n'affiche un launch screen que si une image correspond exactement à la résolution du device |
| Voile de démarrage | `#splash-cover` (`index.html`, `src/main.tsx`) | Pas de flash blanc entre le launch screen natif et l'interface |
| `100lvh` en mode installé | `src/styles/index.css` | Après la première ouverture du clavier, WebKit rétrécit le viewport et ne le restaure jamais |
| Sélection, callout et rebond désactivés en mode installé | `src/styles/index.css` | L'app installée ne se comporte plus comme une page web |
| Invitation à installer | `src/components/install-invite.tsx`, `public/pwa-install-animation.html` | Affichée une fois, seulement connecté, sur mobile, hors app installée |
| Bande lumineuse ancrée à `100lvh` | `src/screens/RecordScreen.tsx` | La page porte `transform`, `filter` et `will-change` pour la transition : elle devient le bloc conteneur de ses enfants `fixed`, et `bottom: 0` tombait sur le bas de la page, pas de l'écran — la lueur flottait au-dessus de la barre Safari au lieu de passer dessous |

Non repris volontairement : `user-scalable=no` (tous nos champs sont déjà en 16 px, donc pas de zoom au focus, et on garde le zoom d'accessibilité) et la barre d'état `black-translucent` (illisible sur notre fond blanc). Les notifications push, longtemps écartées, sont arrivées avec la synchronisation Read AI (voir plus haut).

## Icônes

`npm run icons` régénère les PNG du manifeste depuis `src/assets/mosaic-symbole.svg`, avec la couleur définie en tête de `scripts/generate-icons.mjs`.
