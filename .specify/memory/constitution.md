<!--
Sync Impact Report — à retirer avant de committer l'amendement
Version : aucune → 1.0.0 (adoption initiale)
Principes ajoutés : I à VIII (les huit du brief Outlook, portés sur tout le dépôt)
Sections ajoutées : Contraintes produit et interface ; Workflow de développement ; Gouvernance
Sections retirées : aucune
TODO reportés : aucun
-->

# Constitution SecondCerveau

Le dépôt porte deux outils qui alimentent la même base Notes de Mosaic : la PWA de dictée
vocale et le complément Outlook. Ces principes valent pour les deux et passent avant toute
décision technique.

## Core Principles

### I. Aucun secret côté client

Le token Notion, les clés IA et les secrets Entra VIVENT uniquement en variables
d'environnement serveur. Aucun fichier livré au navigateur NE CONTIENT de secret, ni en
production ni en développement.

Vérifiable : une recherche de motif de clé dans le bundle de production ne renvoie rien.

Raison : le dépôt est public, et tout ce qui atteint le navigateur est lisible par quiconque
ouvre l'application.

### II. Notion est la source de vérité

Aucune base métier parallèle. Un stockage annexe N'EST admis que pour du cache ou des traces
techniques, et DOIT pouvoir être effacé sans perdre de donnée métier.

Vérifiable : vider tout stockage local ne fait perdre aucune donnée déjà confirmée par Notion.

### III. Une seule base Notes

La dictée et le mail écrivent dans la même base. L'origine est une propriété, jamais une base
séparée.

Raison : l'historique d'un contact n'a de valeur que s'il est complet en un seul endroit.

### IV. Toute route API est authentifiée

Une requête sans identité vérifiée EST rejetée en 401, quelle que soit la route et quel que
soit l'outil appelant.

Vérifiable : un appel sans en-tête d'identité ni jeton renvoie 401 sur chacune des routes.

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

Le contenu d'une dictée ou d'un mail N'EST jamais journalisé côté serveur. Il transite vers
Notion et nulle part ailleurs.

Raison : le consentement administrateur du complément porte sur l'accès aux mails ; ce qui
n'est pas conservé n'a pas à être protégé.

## Contraintes produit et interface

- L'interface est en français, et suit la direction artistique Mosaic : palette, Lora, niveau
  de mouvement 1.
- La transcription d'une dictée se fait sur l'appareil. L'audio ne quitte pas le téléphone ;
  seul le texte part.
- Les deux outils sont indépendants : fronts séparés, routes API séparées. Ils ne partagent
  que les briques serveur de `functions/_lib` (client Notion, utilisateurs, authentification)
  et la base Notes. Une modification destinée à l'un NE MODIFIE PAS une route de l'autre.

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
principes I, IV, V et VI, qui sont ceux dont la violation est silencieuse.

**Version**: 1.0.0 | **Ratified**: 2026-10-03 | **Last Amended**: 2026-10-03
