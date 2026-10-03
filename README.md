# Mosaic Dictée

PWA de dictée vocale vers la base de notes Notion. La transcription se fait sur le téléphone (Whisper small q8, Transformers.js), le texte brut part dans Notion, et Notion AI le met au propre.

Trois écrans, dans cet ordre : dicter, choisir le contact, joindre un document
si besoin. L'envoi part du troisième. Il n'y a pas d'écran de relecture : la
dictée n'est ni réécoutée ni relue, et la transcription tourne pendant que
l'utilisateur choisit son contact et sa pièce jointe — elle est donc prête,
ou presque, au moment où il envoie. Si elle ne l'est pas, le bouton l'attend
au lieu de refuser.

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

## Utilisateurs autorisés

`functions/_lib/users.ts` porte la liste des adresses et l'identifiant Notion associé, utilisé pour la propriété `Auteur`. Pour ajouter quelqu'un, ajouter une ligne avec son identifiant (la commande figure en tête du fichier).

## Déployer (Cloudflare Pages, gratuit)

- Build : `npm run build`, dossier `dist`, Functions détectées dans `functions/`.
- Variables : celles de `.env.example`, `NOTION_TOKEN` en secret.
- `public/_headers` active l'isolation cross-origin (COOP / COEP), nécessaire au WASM multithread.

Cloudflare plutôt que Vercel : le plan gratuit de Vercel interdit l'usage commercial.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `src/lib/use-recorder.ts` | MediaRecorder + AnalyserNode, sauvegarde partielle toutes les 5 s |
| `src/lib/audio-capture.ts` | Le PCM 16 kHz pris en direct sur le graphe audio, découpé en énoncés aux silences |
| `src/lib/live-transcript.ts` | Les énoncés transcrits au fil de la dictée, et le repli si l'un d'eux échoue |
| `src/lib/engine-guard.ts` | La miette qui détecte un onglet tué par iOS, et fait redescendre le moteur d'un cran |
| `src/lib/notes.ts` | Cache IndexedDB : l'audio y reste jusqu'à confirmation Notion |
| `src/lib/pipeline.ts` | Reprise au lancement, transcription, envoi, wake lock |
| `src/workers/whisper.worker.ts` | Whisper q8 en WASM, build standard servi depuis `public/ort` (le build asyncify fait planter Safari 26) |
| `functions/api/*` | Proxy Notion (l'API Notion refuse le CORS, et le token reste serveur) |
| `src/components/voice-recorder.tsx` | Design Rare UI d'origine, adapté à l'enregistrement |
| `src/screens/AttachScreen.tsx` | Dernière étape : la pièce jointe, facultative, puis l'envoi — qui attend la transcription si elle tourne encore |
| `functions/api/files.ts` | Upload d'un document ou d'une photo vers Notion, rattaché à la colonne `Fichiers` de la note |
| `src/styles/transitions/` | `_root.css` et snippets transitions.dev, collés tels quels |
| `public/pwa-install-animation.html` | Animation d'installation du dépôt `La-Releve/Simulateur-Faisabilit-` (commit `2ca074f`), copiée telle quelle. Seul diffère : la couleur de marque, le nom, l'icône, le domaine et les trois contacts de la feuille de partage. Ses images vivent dans `public/pwa-anim/` |
| `src/components/install-invite.tsx` | Mise en page de `components/simulateur/install-guide.tsx` du même dépôt : animation encastrée en haut de la feuille, bord à bord, puis les étapes numérotées avec les glyphes iOS |
| `src/lib/phone.ts` | 98 indicatifs et le découpage national de chacun. Les noms de pays viennent d'`Intl.DisplayNames`, donc ils suivent l'orthographe de la plateforme |
| `src/lib/schedule.ts` | `afterTransition` : ce qui coûte cher (décodage audio, réveil du worker Whisper) attend la fin de la transition de page |

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

### Le délai entre le dernier mot et la transcription

Le coût est l'inférence, pas le chargement : créer les deux sessions ONNX à
partir des 406 Mo de poids prend 1,5 à 2 s, une passe sur une fenêtre de 30 s
en prend 16 sur un seul thread. D'où deux changements.

**1. La dictée est transcrite pendant qu'elle est dite.** Le PCM est pris en
direct sur le graphe audio (`audio-capture.ts`), coupé en énoncés aux silences
de plus de 0,6 s — jamais plus court que 12 s, jamais plus long que 27 s, la
fenêtre de Whisper en faisant 30 — et chaque énoncé part au worker pendant que
le suivant est prononcé. Les poids sont donc chargés au début de la dictée et
non à la fin. À l'arrêt il ne reste qu'une passe.

C'est une optimisation, jamais l'original. L'audio est stocké comme avant, et
le chemin est abandonné au moindre doute : une passe qui échoue, un navigateur
sans AudioWorklet, et surtout une capture qui n'a pas entendu toute la dictée
— si les secondes captées manquent de plus de 0,8 s à la durée enregistrée,
le texte en direct est jeté et l'enregistrement entier est transcrit à la fin.

**2. Les threads, partout sauf sur WebKit.** Le budget est la moitié des
cœurs, quatre au plus, et il est divisé par deux puis retenu dans
`localStorage` si une session refuse de démarrer. Ils demandent
`SharedArrayBuffer`, donc l'isolation COOP / COEP de `public/_headers`.

| Moteur | 1 thread | 2 | 3 | 4 |
| --- | --- | --- | --- | --- |
| Chromium | 16,4 s | 9,9 s | — | 6,6 s |
| WebKit | 16,0 s | — | 7,4 s | — |

Le gain est réel et on s'en prive quand même sur WebKit : un module WASM en
mode threadé réserve sa mémoire d'avance, et l'iPhone répond à cette
réservation en tuant l'onglet dès qu'un enregistrement commence. Le WebKit de
Playwright l'exécute sans broncher — sur un bureau, avec de la mémoire de
bureau — ce qui est précisément pourquoi cette mesure-là ne valait rien.

### Trois façons de faire planter un onglet iOS, et le filet dessous

Les trois ont été trouvées en une fois, sur le même symptôme : l'onglet meurt
à l'instant où l'enregistrement démarre et la page se recharge.

- **Un `AudioContext` temps réel forcé à 16 kHz** avec un micro branché
  dessus. C'était le moyen le plus simple d'obtenir directement le taux
  d'échantillonnage de Whisper. Le contexte garde maintenant le taux du
  matériel, et chaque énoncé est rééchantillonné par un
  `OfflineAudioContext` à 16 kHz — la même mécanique que le décodage d'un
  enregistrement, donc déjà éprouvée sur l'appareil.
- **Le worklet branché sur la sortie audio.** L'usage veut qu'on relie un
  worklet à `destination` par un gain nul, sinon le moteur risque de ne pas
  l'appeler. Mesuré : il est appelé quand même (326 blocs contre 324 sur
  Chromium, 322 contre 319 sur WebKit). Sur iOS, atteindre la sortie veut
  dire toucher à la session audio du système pendant que le micro est
  ouvert ; on ne la touche plus.
- **Le pool de threads**, ci-dessus.

Et dessous, un filet : iOS ne signale jamais un plantage, il ramène l'onglet.
`engine-guard.ts` écrit donc une miette dans `localStorage` avant le travail
à risque et l'efface quand il se termine — ainsi que sur `pagehide` et quand
la page passe en arrière-plan, qui ne sont pas des plantages. Une miette
encore là au lancement suivant ne peut vouloir dire qu'une chose : l'onglet
est mort dessus. Le moteur descend d'un cran, définitivement, et repasse au
chemin simple.

Mesuré de bout en bout, montre en main entre le bouton « terminer » et le
texte à l'écran, avec de la vraie parole française injectée dans le micro :

| Durée de la dictée | Avant | Un seul thread (iPhone) | Quatre threads |
| --- | --- | --- | --- |
| 8 s | ~10,8 s | ~10 s | **3,7 s** |
| 12 s | ~11 s | **11 s** | — |
| 58 s | 38,7 s | **19 à 21 s** | **4,9 s** |

Sur la dictée de 58 s en un seul thread, 130 à 140 des mots sont lisibles à
l'écran au bout de 9 à 10 s : ils s'affichent au fur et à mesure.

Effet de bord utile : sur la dictée de 58 s, le fichier entier donne 99 mots
et perd un paragraphe au milieu — le recollement des fenêtres de 30 s de
Whisper est fragile — là où les énoncés en donnent 154, complets.

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
| `sw.js` jamais mis en cache | `public/_headers` | Une nouvelle version se propage au déploiement suivant, pas des heures après |
| Écrans de lancement iOS | `npm run splash`, `public/splash/` | iOS n'affiche un launch screen que si une image correspond exactement à la résolution du device |
| Voile de démarrage | `#splash-cover` (`index.html`, `src/main.tsx`) | Pas de flash blanc entre le launch screen natif et l'interface |
| `100lvh` en mode installé | `src/styles/index.css` | Après la première ouverture du clavier, WebKit rétrécit le viewport et ne le restaure jamais |
| Sélection, callout et rebond désactivés en mode installé | `src/styles/index.css` | L'app installée ne se comporte plus comme une page web |
| Invitation à installer | `src/components/install-invite.tsx`, `public/pwa-install-animation.html` | Affichée une fois, seulement connecté, sur mobile, hors app installée |
| Bande lumineuse ancrée à `100lvh` | `src/screens/RecordScreen.tsx` | La page porte `transform`, `filter` et `will-change` pour la transition : elle devient le bloc conteneur de ses enfants `fixed`, et `bottom: 0` tombait sur le bas de la page, pas de l'écran — la lueur flottait au-dessus de la barre Safari au lieu de passer dessous |

Non repris volontairement : `user-scalable=no` (tous nos champs sont déjà en 16 px, donc pas de zoom au focus, et on garde le zoom d'accessibilité), la barre d'état `black-translucent` (illisible sur notre fond blanc), et tout le volet notifications push.

## Icônes

`npm run icons` régénère les PNG du manifeste depuis `src/assets/mosaic-symbole.svg`, avec la couleur définie en tête de `scripts/generate-icons.mjs`.
