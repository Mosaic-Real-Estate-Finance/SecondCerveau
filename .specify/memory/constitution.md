<!--
Sync Impact Report
Version : 1.0.0 → 2.0.0 (MAJEUR : le principe II est redéfini de façon incompatible,
et le chemin d'identification x-user-email admis par IV disparaît)
Principes modifiés :
  - II. Notion est la source de vérité → même titre, stockage annexe Redis admis pour
    l'état opérationnel, appel en attente conservé en entier jusqu'à la décision
  - IV. Toute route API est authentifiée → même titre, trois preuves nommées (signature
    HMAC du webhook, session PWA ouverte par code email, jeton Microsoft du complément)
  - VIII. Minimisation des données → étendu aux réunions, exception unique bornée par II
Sections modifiées : Contraintes produit et interface (trois outils, routes /api/readai/*)
Sections ajoutées : aucune
Sections retirées : aucune
Templates : plan, spec et tasks lisent la constitution à l'exécution, aucun à modifier
TODO reportés : aucun
-->

# Constitution SecondCerveau

Le dépôt porte trois outils qui alimentent la même base Notes de Mosaic : la PWA de dictée
vocale, le complément Outlook et la synchronisation Read AI. Ces principes valent pour les
trois et passent avant toute décision technique.

## Core Principles

### I. Aucun secret côté client

Le token Notion, les clés IA et les secrets Entra VIVENT uniquement en variables
d'environnement serveur. Aucun fichier livré au navigateur NE CONTIENT de secret, ni en
production ni en développement.

Vérifiable : une recherche de motif de clé dans le bundle de production ne renvoie rien.

Raison : le dépôt est public, et tout ce qui atteint le navigateur est lisible par quiconque
ouvre l'application.

### II. Notion est la source de vérité

Aucune base métier parallèle. Notion EST la seule source de vérité pour tout ce qui a été
validé : notes, contacts, sociétés.

Un stockage annexe Redis EST admis pour l'état opérationnel, et pour lui seul : file
d'attente des appels à valider, liste d'exclusion, abonnements push, codes de connexion et
sessions révoquées, identifiants de dédoublonnage et verrous. Tout autre stockage annexe N'EST
admis que pour du cache ou des traces techniques, et DOIT pouvoir être effacé sans perdre de
donnée métier.

Un appel en attente de validation VIT dans Redis en entier, contenu compris (résumé et
transcription), jusqu'à la décision d'un utilisateur. Il EST supprimé dès que sa note est
créée dans Notion ou que l'appel est écarté. Seuls les champs nécessaires à la création de la
note y sont conservés, jamais le payload brut.

Vérifiable : vider le stockage local ne fait perdre aucune donnée confirmée par Notion ; après
la création d'une note issue de la file, la clé de l'appel n'existe plus dans Redis.

Raison : un appel ne peut rien écrire dans Notion tant qu'une personne n'a pas été
reconnue ; il doit donc attendre quelque part, et ce quelque part ne doit pas devenir une
seconde base.

### III. Une seule base Notes

La dictée, le mail et la réunion écrivent dans la même base. L'origine est une propriété, jamais une base
séparée.

Raison : l'historique d'un contact n'a de valeur que s'il est complet en un seul endroit.

### IV. Toute route API est authentifiée

Une requête sans identité vérifiée EST rejetée en 401, quelle que soit la route et quel que
soit l'outil appelant. Chaque appelant présente une preuve, jamais une simple déclaration :

- la PWA : une session ouverte par un code à usage unique reçu par email, portée par un
  cookie `HttpOnly` signé côté serveur ;
- le complément Outlook : un jeton d'accès Microsoft vérifié (signature, émetteur, audience,
  locataire) ;
- le webhook Read AI : la signature HMAC-SHA256 du corps brut, comparée à temps constant.
  C'est un serveur, pas une personne : il n'ouvre aucune session.

Un en-tête qui se contente de nommer un utilisateur (l'ancien `x-user-email`) N'EST PAS une
preuve et N'OUVRE aucune route.

Vérifiable : un appel sans session, sans jeton ou sans signature valide renvoie 401 sur chacune
des routes ; un en-tête `x-user-email` seul ne suffit plus.

### V. Écritures idempotentes

Un envoi rejoué NE CRÉE PAS un second enregistrement. La clé de déduplication est explicite et
stockée dans Notion : l'identifiant de conversation pour un mail, l'identifiant de note pour
une dictée.

Vérifiable : deux envois successifs du même objet laissent une seule page dans Notes.

### VI. Aucune perte silencieuse

Rien n'est tenu pour envoyé avant la confirmation de Notion. L'enregistrement audio ou la
saisie SURVIT à l'échec, l'utilisateur VOIT l'erreur, et il PEUT réessayer.

Vérifiable : couper le réseau pendant un envoi laisse la donnée en place et un bouton pour
réessayer.

### VII. Sobriété API

Notion accepte environ trois requêtes par seconde. Pas d'appel par ligne de liste ; les
agrégats passent par des rollups.

Vérifiable : afficher la liste des contacts coûte un nombre de requêtes constant, indépendant
du nombre de contacts.

### VIII. Minimisation des données

Le contenu d'une dictée, d'un mail ou d'une réunion N'EST jamais journalisé côté serveur. Pour
une réunion, cela couvre le résumé, la transcription, et le nom comme l'email de chaque
participant. Ce contenu transite vers Notion et nulle part ailleurs.

Seule exception : le stockage temporaire d'un appel en attente de validation, borné par le
principe II (champs nécessaires seulement, supprimé dès la décision).

Vérifiable : aucun journal serveur ne contient de texte de réunion, de nom ni d'adresse de
participant ; les journaux citent des identifiants techniques et des statuts.

Raison : le consentement administrateur du complément porte sur l'accès aux mails, et les
réunions contiennent les propos des clients ; ce qui n'est pas conservé n'a pas à être protégé.

## Contraintes produit et interface

- L'interface est en français, et suit la direction artistique Mosaic : palette, Lora, niveau
  de mouvement 1.
- La transcription d'une dictée se fait sur l'appareil. L'audio ne quitte pas le téléphone ;
  seul le texte part.
- Le dépôt porte trois outils indépendants : la dictée (`/api/*` historiques), le complément
  Outlook (`/api/outlook/*`) et la synchronisation Read AI (`/api/readai/*`). Ils partagent
  les briques serveur de `functions/_lib` (client Notion, utilisateurs, authentification,
  contacts, blocs) et la base Notes. La synchronisation Read AI partage en outre le front de
  la PWA pour son écran « À valider ». Une modification destinée à l'un NE MODIFIE PAS le
  comportement d'une route d'un autre, à l'exception de l'authentification commune décidée
  au principe IV.

## Workflow de développement

- Le développement suit la séquence spec-driven : constitution, spécification, clarification,
  plan, tâches, implémentation, convergence.
- Toute affirmation sur le schéma Notion EST vérifiée en lecture contre la base réelle avant
  d'être codée. Les noms de colonnes supposés sont une source d'échec avérée.
- Une feature est terminée quand sa grille de convergence passe en entier ET que l'autre outil
  ne présente aucune régression.

## Governance

Cette constitution prime sur les habitudes de code et sur les préférences individuelles. Tout
écart DOIT être justifié dans le plan de la feature concernée, ou corrigé.

Amendement : un changement de principe passe par une mise à jour de ce document, décrite dans
son Sync Impact Report, avant d'être appliqué au code.

Versionnage sémantique de ce document : MAJEUR pour le retrait ou la redéfinition
incompatible d'un principe, MINEUR pour l'ajout d'un principe ou d'une section, CORRECTIF pour
une clarification sans portée nouvelle.

Revue de conformité : la grille de convergence de chaque feature vérifie au minimum les
principes I, IV, V, VI et VIII, qui sont ceux dont la violation est silencieuse.

**Version**: 2.0.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-08
