# RETEX — QA fonctionnelle Frontend GRC Tools sur Render

**Date : 2026-10-03**  
**Périmètre :** frontend React/Vite déployé sur Render, backend Render, API Neon, Google OAuth et navigation fonctionnelle.  
**Mode de recette :** lecture seule. Aucune donnée métier n’a été créée ou modifiée pendant l’audit.

## 1. Contexte

Après la mise en production du frontend GRC Tools sur Render, une recette fonctionnelle a été réalisée sur l’artefact publié afin de vérifier l’authentification, la navigation, les appels API, la connectivité backend et l’état des modules.

Le backend Render avait déjà été validé sur les endpoints /health et /ready, avec une connexion PostgreSQL opérationnelle.

## 2. Résultats de la QA

### 2.1 Fonctionnel

- frontend Render : HTTP 200 ;
- authentification Google utilisable lorsque la session Google est disponible ;
- interface authentifiée : « Session active » et « Accès authentifié » ;
- 11 entrées actives du menu testées : ouverture avec titre correspondant ;
- groupes de navigation dépliables ;
- panneau Feedback ouvrable ;
- /health : 200 ;
- /ready : 200 avec database: ok ;
- prérequête CORS : 204 ;
- aucune erreur console observée pendant le parcours ;
- aucune API frontend orpheline identifiée dans le code source.

## 3. Incident principal — 404 systématiques des API métier

### Symptôme

Les appels de lecture des pages actives échouent en 404. La recette a observé 18 réponses HTTP 404, concernant notamment les risques, grilles de cotation, appétence, contrôles, plans d’action, constats, rôles et feedback.

Aucun 400 ou 500 n’a été observé pendant cette recette.

### Cause identifiée

La variable VITE_API_BASE_URL intégrée au bundle frontend publié contient une barre oblique finale :

https://gouvernance-risk-control-tools.onrender.com/

Le client frontend ajoute ensuite des chemins commençant eux-mêmes par /api/v1/.

La concaténation produit donc //api/v1/... au lieu de /api/v1/....

Les prérequêtes CORS passent, mais les GET sont routés vers une URL qui ne correspond pas aux routes Express et retournent 404.

Le contrôle complémentaire avec le chemin normal /api/v1/... produit une réponse 401 sans authentification, ce qui confirme que les routes backend existent.

### Conséquences

- listes métier vides ;
- certaines valeurs affichées à zéro ;
- données métier non considérées comme chargées ;
- permissions non évaluables correctement tant que les requêtes n’atteignent pas les routes backend ;
- aucune action d’écriture soumise pendant la recette.

### Correctif attendu

Corriger VITE_API_BASE_URL dans Render en supprimant la barre oblique finale, puis reconstruire et redéployer le frontend.

La variable étant intégrée au bundle Vite au moment du build, un nouveau build/déploiement est nécessaire.

## 4. Écart observé entre le dépôt et l’artefact Render

La recette a identifié un écart apparent entre le code du dépôt et le bundle publié.

Le dépôt contient une navigation plus large que celle observée dans l’artefact Render. L’audit a notamment relevé des fonctionnalités présentes dans le dépôt mais absentes du bundle inspecté : Import Excel, référentiels, indicateurs, pilotage, tenant, marque, notifications et gouvernance.

Cet écart doit être traité comme une anomalie de déploiement/version à vérifier, et non comme une preuve que les fonctionnalités sont absentes du dépôt.

## 5. Navigation et routage

La navigation des pages actives fonctionne dans l’interface, mais elle est pilotée par l’état React et conserve l’URL racine /.

Il n’existe donc pas actuellement d’URL dédiée par module permettant un lien direct vers une page, un rafraîchissement directement sur une page donnée ou le partage d’une URL d’un écran métier.

Ce point est distinct des 404 API.

## 6. Modules non implémentés dans la navigation publiée

Neuf modules sont présentés comme « Module en préparation » :

1. Dispositif de risque
2. Plan de contrôle
3. Lignes de défense
4. KRI
5. KPI
6. Dashboards
7. Cycles de revue
8. Missions
9. Paramètres & référentiels

## 7. Parcours des 11 pages actives

| Module | Navigation | Problème observé |
|---|---|---|
| Cartographie | Page ouverte | Chargement des risques en 404 |
| Évaluations | Page ouverte | Grille active absente ; création désactivée |
| Appétence | Page ouverte | API en 404 ; aucune donnée |
| Grilles de cotation | Page ouverte | API en 404 ; aucune version |
| Registre | Page ouverte | API en 404 ; aucun risque |
| Contrôles | Page ouverte | Risques/contrôles en 404 |
| Exécutions & efficacité | Page ouverte | Contrôles en 404 |
| Plans d’action | Page ouverte | Lecture/actualisation en 404 |
| Constats & recommandations | Page ouverte | Missions/constats en 404 |
| IAM · Rôles | Page ouverte | Rôles/permissions en 404 |
| Feedback | Page ouverte | Liste en 404 ; formulaire accessible |

## 8. Autres anomalies

### Langue HTML

Le document HTML publié déclare lang="en" alors que l’interface est en français.

### Données RACI et commentaires

Le panneau Commentaires indique que la source métier n’est pas reliée. Le panneau RACI indique qu’aucune attribution n’est chargée. Ces constats restent à revalider après correction des appels API.

## 9. Limites de la recette

Les boutons de création et de mise à jour n’ont pas été soumis afin de ne pas écrire dans les données Render.

Restent donc à tester après correction de l’URL API : créations, mises à jour, suppressions éventuelles, permissions, 401/403 selon les rôles, cohérence des données après écriture et parcours métier complets.

## 10. Plan d’action recommandé

### P0 — Corriger la base API frontend

Supprimer la barre oblique finale de VITE_API_BASE_URL, reconstruire le frontend et redéployer.

### P1 — Refaire la recette

Rejouer les 11 parcours actifs et vérifier GET, écritures prévues, 401, 403, données affichées, erreurs console et erreurs réseau.

### P1 — Vérifier l’artefact Render

Comparer le commit réellement déployé et le contenu du bundle avec main afin d’expliquer l’écart entre les interfaces du dépôt et celles publiées.

### P2 — Corriger le routage frontend

Étudier l’introduction d’un routeur et d’URL dédiées par module si les liens profonds et le partage d’écrans sont requis.

### P2 — Corriger la déclaration de langue

Passer le document HTML en français avec lang="fr".

### P3 — Poursuivre l’implémentation des modules

Traiter progressivement les neuf modules encore en préparation.

## 11. Critère de sortie

La phase QA frontend pourra être considérée comme validée après correction de VITE_API_BASE_URL, nouveau build Render, disparition des 404 API, chargement effectif des données métier, validation des permissions, test des principales actions d’écriture et vérification de la cohérence entre le commit main attendu et l’artefact réellement servi.

## 12. Conclusion

La mise en ligne du frontend est opérationnelle sur le plan de l’accès, de la navigation et de la connectivité générale. L’anomalie bloquante identifiée pendant la recette concerne la construction de l’URL API dans le bundle publié : la barre oblique finale de VITE_API_BASE_URL provoque des requêtes en double slash et donc des 404 sur les routes métier.

Le correctif doit être appliqué dans la configuration Render, suivi d’un nouveau build et d’une nouvelle recette fonctionnelle.