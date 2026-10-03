# Quickstart — valider le complément Outlook

**Feature** : Complément Outlook vers Notion · **Date** : 2026-10-03

Comment faire tourner le complément et prouver qu'il marche. Les contrats sont dans
[contracts/](./contracts/), le modèle dans [data-model.md](./data-model.md).

---

## 0. Prérequis, dans l'ordre

Sans le premier point, rien d'autre ne sert : il décide si la feature est réalisable telle que
spécifiée.

1. **Constater la limite de `Interlocuteur`.** Notion → base Notes → en-tête de la colonne
   `Interlocuteur` → *Modifier la propriété*. « Limiter à 1 page » doit être **désactivé**.
   L'API ne peut pas le lire (research A-2). Si c'est limité et non modifiable, s'arrêter et
   re-spécifier.
2. **Créer quatre propriétés dans Notes** : `ID client` (texte), `Source` (sélection :
   `Dictée`, `Email`), `Dernier message` (texte), `Statut IA` (sélection : `À traiter`,
   `Traité`).
3. **Renseigner `.env.local`** :

   ```sh
   NOTES_PROP_CLIENT_ID=ID client
   NOTES_PROP_SOURCE=Source
   NOTES_PROP_AI_STATUS=Statut IA
   NOTES_PROP_LAST_MESSAGE=Dernier message
   CONTACTS_PROP_EMAIL=Email
   INTERNAL_DOMAINS=mosaicfin.com
   ```

   Les deux variables Entra (`ENTRA_API_CLIENT_ID`, `ENTRA_TENANT_IDS`) ne sont nécessaires
   qu'à partir de la phase 4 : sans elles, le repli `x-user-email` suffit pour développer.
4. **App Entra** (phase 7) : plateforme **Single-page application**, API exposée avec un scope
   pour le backend, permission déléguée `Mail.Read`, consentement administrateur.

   URI de redirection, de type SPA. Le schéma attend **l'origine seule, port compris**, et
   aucun sous-chemin :

   - `brk-multihub://localhost:5173` — c'est celui qui sert, le taskpane tournant dans Outlook
     sur la machine de développement ;
   - `brk-multihub://192.168.1.86:5173` — seulement utile pour un sideload depuis un autre
     appareil du réseau ;
   - `https://localhost:5173/outlook.html` — la page qui demande les jetons, pour les clients
     web qui passent par le flux d'authentification standard.

   Puis renseigner `ENTRA_API_CLIENT_ID` et `ENTRA_TENANT_IDS` dans `.env.local`. Les deux
   absentes, le chemin par jeton Microsoft reste désactivé et le repli `x-user-email` suffit.

Vérifier que les propriétés sont bien là, sans ouvrir Notion :

```sh
NOTION_TOKEN=$(grep '^NOTION_TOKEN=' .env.local | cut -d= -f2-) \
NOTES=$(grep '^NOTION_NOTES_DB=' .env.local | cut -d= -f2-) \
sh -c 'curl -s "https://api.notion.com/v1/databases/$NOTES" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2026-03-11" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)[\"properties\"]; print(sorted(d))"'
```

Attendu : `ID client`, `Source`, `Dernier message`, `Statut IA` présents.

---

## 1. Lancer

```sh
npm install
npm run outlook:certs    # une seule fois : certificat approuvé par le système
npm run dev:outlook      # génère le manifeste de dev, puis sert l'app
```

`npm run outlook:certs` appelle `office-addin-dev-certs` pour un certificat valable un an
couvrant `localhost`, `127.0.0.1` et `192.168.1.86`, et installe son autorité dans le trousseau.
Aucun mot de passe n'est demandé. Vérification :

```sh
curl -s -o/dev/null -w '%{http_code}\n' https://localhost:5173/outlook.html
```

**Sans `-k`.** Si ça rend `200`, le certificat est réellement approuvé. C'est le point qui
compte : **Outlook sur le web charge le taskpane dans une iframe, et une iframe n'offre aucun
avertissement à contourner** — un certificat auto-signé y donne un panneau vide, sans message.

### Deux modes, et pourquoi

| Commande | Certificat | Pour |
| --- | --- | --- |
| `npm run dev:mobile` | auto-signé (`basicSsl`) | le téléphone, qui a déjà accepté celui-là |
| `npm run dev:outlook` | approuvé par le système | Outlook, qui n'accepte que celui-là |

Ils ne diffèrent que par le certificat : même port, mêmes routes, mêmes variables.
`dev:mobile` reste intact exprès — la PWA installée sur le téléphone est en service, et un
certificat non approuvé dans une PWA en mode autonome échoue en écran blanc, pas en question.

Pour n'avoir qu'un seul serveur pour les deux, installer une fois l'autorité sur le téléphone :
envoyer `~/.office-addin-dev-certs/ca.crt`, l'ouvrir, puis Réglages → Profil téléchargé →
Installer, et enfin Réglages → Général → Informations → Réglages des certificats → activer la
confiance totale. `dev:outlook` sert alors aussi le téléphone sans avertissement.

### Hygiène, à vérifier à chaque démarrage

```sh
# Le taskpane ne doit PAS porter les en-têtes d'isolation, sinon office.js est bloqué
curl -s -D- -o/dev/null https://localhost:5173/outlook.html | grep -ic cross-origin   # 0

# La PWA doit les porter, sinon le microphone et Whisper cassent sur iPhone
curl -s -D- -o/dev/null https://localhost:5173/ | grep -ic cross-origin               # 2
```

---

## 2. Sideload dans Outlook

Le manifeste de développement est écrit par `dev:outlook` dans `.outlook/manifest.dev.xml`
(ignoré par git : il porte un hôte propre à la machine). Il a **son propre identifiant et son
propre libellé de ruban, « Vers Notion (dev) »** : Outlook indexe un complément sur son
identifiant, donc partager celui de la production ferait que la version de développement
remplace la vraie dans le ruban, silencieusement.

Pour un autre hôte : `npm run outlook:manifest -- notes.mosaicfin.com prod`.

| Client | Chemin |
| --- | --- |
| Outlook sur le web | Paramètres → Compléments → *Mes compléments* → *Ajouter un complément personnalisé* → *À partir d'un fichier* → `.outlook/manifest.dev.xml` |
| Nouvel Outlook Windows | idem, depuis le panneau Compléments |
| Outlook classique Windows | partage réseau comme catalogue de confiance, ou `npx office-addin-debugging start .outlook/manifest.dev.xml` |
| Outlook Mac | copier le manifeste dans `~/Library/Containers/com.microsoft.Outlook/Data/Documents/wef` |

Puis ouvrir un mail en lecture : le bouton **Vers Notion (dev)** apparaît dans le ruban.

À ce stade, sans application Entra configurée, le panneau n'a pas encore de jeton Microsoft et
les appels partent avec le repli `x-user-email` de la PWA. C'est voulu : les phases 1 à 3 se
développent sans Entra.

---

## 3. Les quatre parcours de la spécification

Chacun est le test indépendant de son user story. À faire dans Outlook sur le web d'abord,
puis dans les trois autres clients pour la convergence.

### US1 — classer en deux clics

Ouvrir un mail d'un contact présent dans Contacts → bouton *Vers Notion* → le contact est
coché, avec nom et société → *Créer la note* → ouvrir le lien.

Attendu : une page dans Notes, `Interlocuteur` = ce contact, `Source` = `Email`,
`Statut IA` = `À traiter`, le fil entier dans le corps, un callout par message, du plus ancien
au plus récent.

### US2 — interlocuteur inconnu

Ouvrir un mail d'une adresse absente de Contacts → la ligne est marquée *Nouveau contact*,
dépliable, email prérempli → décocher d'abord, vérifier que l'envoi reste possible → recocher,
laisser le nom vide, vérifier que le bouton est désactivé → remplir, envoyer.

Attendu : le contact existe dans Contacts **avec son email**, et la note lui est liée.

### US3 — reprendre une conversation

Classer un fil, répondre au mail (ou se l'envoyer), rouvrir le panneau sur le même fil.

Attendu : *« Note existante, 1 nouveau message »* et un lien. Après *Enrichir* : la note
contient l'ancien et le nouveau, **une seule fois chacun** ; `Statut IA` est repassé à
`À traiter` ; l'auteur du premier envoi est toujours là, le second s'est ajouté.

Rouvrir sans nouveau message → *« Note à jour »*, aucun bouton d'envoi.

### US4 — ne rien perdre

Remplir un formulaire de nouveau contact, couper le réseau, envoyer.

Attendu : message en français disant que c'est le réseau, formulaire intact, *Réessayer*
aboutit une fois le réseau revenu, et **aucun doublon** — ni de contact, ni de note.

---

## 4. Vérifications sans interface

```sh
# 401 sans identité, sur les cinq points d'entrée.
# Pas de corps sur le GET : le pont de développement ne peut pas construire une
# requête GET avec un corps, et rend 500 avant d'atteindre la route.
check() { printf '%-5s %-36s → ' "$1" "$2"
  curl -s -o/dev/null -w '%{http_code}\n' -X "$1" "https://localhost:5173$2" \
    ${3:+-H 'Content-Type: application/json'} ${3:+--data "$3"}; }
check GET   "/api/outlook/notes?conversationId=x"
check POST  "/api/outlook/notes"            '{}'
check PATCH "/api/outlook/notes"            '{}'
check POST  "/api/outlook/contacts"         '{}'
check POST  "/api/outlook/contacts/match"   '{}'
# attendu : 401 partout

# Et le cas qui compte vraiment : un faux jeton accompagné d'une adresse
# autorisée ne doit JAMAIS passer.
curl -s -o/dev/null -w '%{http_code}\n' -X POST https://localhost:5173/api/outlook/contacts/match \
  -H 'Authorization: Bearer forge' -H 'x-user-email: theo@gouman.fr' \
  -H 'Content-Type: application/json' --data '{"addresses":["a@b.fr"]}'
# attendu : 401
```

```sh
# Idempotence : vingt créations de la même conversation
for i in $(seq 20); do
  curl -ks -X POST https://localhost:5173/api/outlook/notes \
    -H 'Content-Type: application/json' -H 'x-user-email: theo@gouman.fr' \
    -d '{"conversationId":"QS-TEST-001","contactIds":["<id>"],
         "messages":[{"id":"m1","receivedAt":"2026-10-03T10:00:00Z",
                      "from":{"name":"T","address":"t@x.fr"},"text":"essai","attachmentNames":[]}]}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id"), d.get("duplicate"))'
done
# attendu : le même id vingt fois, duplicate=true à partir du second
```

```sh
# Aucun secret dans le bundle livré (SC-003)
npm run build
grep -rIlE 'ntn_|secret|NOTION_TOKEN' dist/ || echo "aucun secret — OK"
```

```sh
# Aucune journalisation du contenu des mails (principe VIII)
grep -rn 'console\.' functions/ | grep -iE 'text|body|message|transcript' || echo "aucune trace — OK"
```

---

## 4 bis. Déploiement sur Vercel

Le complément ne peut pas être servi depuis `localhost` vers Outlook sur le web : Chrome le
bloque par Local Network Access depuis la version 141, et Safari a sa propre restriction
réseau local (research G-2). Une origine publique est la seule voie fiable.

### Variables à poser sur Vercel

**Indispensables, sans valeur par défaut utilisable :**

| Variable | Valeur | Pourquoi |
| --- | --- | --- |
| `NOTION_TOKEN` | le jeton d'intégration | **Secret.** Sans lui, toute route rend 500. |
| `NOTION_CONTACTS_DB` | `d0311be1…` | — |
| `NOTION_NOTES_DB` | `dacdfdfe…` | — |
| `NOTES_PROP_CLIENT_ID` | `ID client` | Sa valeur par défaut est **vide**, et une colonne vide désactive silencieusement la déduplication : les doublons reviennent sans le moindre message. C'est la seule de la liste dont l'oubli ne se voit pas. |

**Indispensables au moment du *build*,** parce que Vite les inscrit dans le bundle. Absentes,
le panneau affiche « Complément non configuré » :

| Variable | Valeur |
| --- | --- |
| `VITE_ENTRA_CLIENT_ID` | `62caaa98-3734-4094-b9b4-bbe925fc1c7d` |
| `VITE_ENTRA_AUTHORITY` | `https://login.microsoftonline.com/common` |
| `VITE_ENTRA_API_SCOPE` | `api://62caaa98-3734-4094-b9b4-bbe925fc1c7d/access_as_user` |

**Déjà posées** : `ENTRA_API_CLIENT_ID`, `ENTRA_TENANT_IDS`.

**Facultatives** : toutes les autres `*_PROP_*`, `INTERNAL_DOMAINS` et `VITE_WHISPER_MODEL` ont
dans le code une valeur par défaut qui correspond au schéma réel. `CONTACTS_PROP_COMPANY_ROLLUP`
est à laisser **non posée** : sa valeur par défaut désigne une colonne qui n'existe pas, et la
poser ne ferait que figer l'erreur (research A-3).

### Avant de déployer : les routes démarrent-elles sous Node ?

Vite et Vercel ne résolvent pas les imports de la même façon. Le résolveur de Vite fait
correspondre un import relatif sans extension à un fichier `.ts` ; Node, exécutant le résultat
compilé d'un paquet en `"type": "module"`, exige l'extension écrite. Une route peut donc servir
parfaitement en `npm run dev` et répondre 500 en production avec `ERR_MODULE_NOT_FOUND`. C'est
arrivé, sur les huit routes à la fois.

```sh
npm run typecheck    # moduleResolution nodenext : refuse un import relatif sans extension
npm run check:api    # transpile puis importe les huit routes avec le vrai résolveur de Node
```

Le premier est la vraie garde : il refuse l'erreur à la compilation, et `npm run build`
l'exécute. Le second la vérifie avec le résolveur de Node plutôt qu'avec celui de Vite.

### Le contrôle à ne pas sauter au premier déploiement

`vercel.json` applique les en-têtes d'isolation partout **sauf** sur `/outlook`, par une
expression à négation. Les deux façons de se tromper sont silencieuses : trop large et
office.js est bloqué dans le taskpane, trop étroite et Whisper ne démarre plus sur l'iPhone.

```sh
# Doit montrer les deux en-têtes
curl -sD- -o/dev/null https://mosaicref.vercel.app/ | grep -i cross-origin
# Ne doit en montrer aucun
curl -sD- -o/dev/null https://mosaicref.vercel.app/outlook.html | grep -i cross-origin
```

### Manifeste de production

```sh
npm run outlook:manifest:prod     # écrit .outlook/manifest.xml
npx office-addin-manifest validate .outlook/manifest.xml
```

Son identifiant (`3cb13804-…`) diffère de celui du manifeste de développement
(`9f2e4c71-…`), et son bouton s'appelle « Vers Notion » et non « Vers Notion (dev) » : les deux
peuvent cohabiter dans le même Outlook sans se remplacer l'un l'autre.

---

## 5. Non-régression de la dictée

À faire après **chaque** phase qui touche `functions/_lib/` ou `vite.config.ts`, et sans
exception après la migration vers Vercel.

1. Sur l'iPhone, ouvrir la PWA installée — pas Safari, l'app installée : c'est là que le
   service worker est le plus ancien.
2. Dicter 15 secondes, choisir un contact, passer l'écran des fichiers, laisser partir.
3. Vérifier dans Notion : la note existe, `Source` = `Dictée`, `Interlocuteur` renseigné,
   `Transcription brute` remplie.
4. Vérifier que `/` porte toujours COOP `same-origin` et COEP `require-corp` — sans eux,
   Whisper ne démarre pas.
5. Vérifier que `/outlook.html` ne les porte pas.

Un échec ici arrête la phase, quoi qu'il en coûte au calendrier : la dictée est en service.
