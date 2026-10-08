# RM V1 — Séquence des actions à venir (sur la base du §17)

**Statut** : PROPOSITION de l'Architecte (A05), 2026-10-08. Ce document ne contient ni code ni migration.
**Sources** : le contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` (§17 et §18), DECISION-009 à 016, les lignes « Ouvert » de `ACTION_ITEMS.md`, le plan `RM-V1-Lots-contrat-amende.md` et `README.md`.

**Règles valables pour chaque étape de code**
- Branche partie de `staging` et PR vers `staging`. Jamais de commit direct sur `main`.
- Consigne ponytail.
- `npm run typecheck && npm test` (backend) et `npm run build` (frontend) passent avant de déclarer le lot terminé.
- Un agent crée la migration mais ne l'applique jamais. Elle est appliquée par le workflow `migrate.yml` après un merge validé par HUMAN (DECISION-009).
- Le numéro de migration est revérifié au moment d'écrire : le prochain numéro libre est aujourd'hui **047**.
- Dès que deux agents A06 travaillent en parallèle, chacun a son propre worktree (conflits attendus sur `server.ts` et `permissions.ts`).
- Chaque lot rend son gate du §18, puis attend le gate humain.

## 1. Les phases du §17 : fait, ce qui change, ce qui reste

| Phase §17 | Fait | Ce qui change (contrat amendé, DECISION-014/015/016) | Reste |
|---|---|---|---|
| 0 Trace | Contrat dans le repo, Decision Log tenu | DECISION-016 et Q9 ne sont pas encore reportés dans le contrat (§6, §8, §10). OD-1, OD-2, OD-3 et OD-6 sont dépassées par l'amendement mais toujours marquées « Ouvert » | Étapes 1 et 2 |
| 1 Maquette | Écrans RM des Lots 1-4/C construits. Figma abandonné, la référence est l'artefact `grc-review.html`. Aucune maquette Penpot n'est tracée dans le dépôt | Nouvelle étape UX : **parcours global du Dispositif** (en cours chez A04) avant F-1/F-2 | Étape 4 |
| 2 Lots | B-0 à B-7, F-1 et F-2 cadrés (`RM-V1-Lots-contrat-amende.md`) | DECISION-016 ajoute **B-8 Groupes** et **B-9 Échelle (F-13)**, change l'approbateur de B-6 et débloque B-7 (Q9) et B-1 (Q10) | Ce document |
| 3 Fondations front | Pages Évaluations, Appétence, Grilles et Décision de traitement, en staging et en production (PR #120) | Aucun changement | `RealtimeClient` non vérifié : étape 19 |
| 4 Parcours | Inhérent, Maîtrise et Résiduel avec un seul évaluateur ; appétence ; Treatment Decision ; seuils Comité configurables (Lots A/B/C) | La saisie dépend du mode (B-1). La Treatment Decision est enregistrée par le RO ou le DEL (B-7). Le validateur doit être hors de tous les auteurs (B-1). Les seuils sont figés dans un instantané (B-6, F-8) | Identification par Processus (B-5), Traitement, Suivi, Réévaluation, Cartographie/Risk 360 : étape 18 |
| 5 Transverses | Permissions et audit append-only en place | Le Dispositif devient persistant (B-6), avec groupes (B-8), échelle (B-9), contributions (B-3), signalement (B-4) et fenêtre de refus (DECISION-011) | Étapes 6 à 17. Meeting : aucun lot cadré |
| 6 Temps réel | — | Aucun changement, c'est la couche finale | Étape 19 |
| 7 QA et gates | QA et Security faits sur les lots déjà livrés | Compliance s'ajoute pour les lots qui touchent la séparation des tâches ou les données (B-1, B-4, B-5, B-6, B-8) | Étapes 20 et 21 |

## 2. Séquence unique

Statut d'une étape :
- **PRÊT** : ne dépend d'aucun arbitrage ouvert. Pour du code, il faut seulement le go de lancement du PO (règle 7bis).
- **PO** : attend un arbitrage du PO, numéroté P1 à P6 au §3.
- **TIERS** : attend une action de HUMAN ou des juristes.

| # | Étape | Dépend de | Qui | Gate de sortie | Statut |
|---|---|---|---|---|---|
| 1 | **Balayage léger et hygiène du suivi.** Sur `git status`, l'écart entre `staging` et `main` et les PR Dependabot ouvertes, ACTION_ITEMS ne contient aucune ligne : on vérifie et on ne trace que ce qui est réel. On passe OD-1, OD-2, OD-3, OD-6 et CHALLENGE-001 (règle MIN, §5) à « caduc/résolu », chaque fois avec sa référence. Chaque « attente PO » devient une ligne (7bis) | — | A02 | — | PRÊT |
| 2 | **Reporter DECISION-016 et Q9 dans le contrat** : §6 (même taille d'échelle 3/4/5/6, 7 axes au maximum, un descriptif par niveau et par axe, saisis à la création du Dispositif), §8 (le RO enregistre la Treatment Decision), §10 (groupes ; approbateur configurable Audit ou Comité, à la place de « Comité ») | — | A13 rédige, HUMAN valide le texte | Validation PO du texte | PRÊT |
| 3 | **Arbitrage groupé P1 à P6**, avec une entrée au Decision Log pour chacun | — | HUMAN (appui A05, A13) | Decision Log | PO |
| 4 | **UX : parcours global du Dispositif** (création avec échelle, axes et descriptifs ; groupes ; désignations ; mode), puis validation A13, faisabilité A05 et GO PO | 2 | A04, A13, A05, HUMAN | GO PO | En cours |
| 5 | **Décisions HUMAN hors RM, à mener en parallèle** : go de merge de la PR « 403 ne consomment plus le quota » ; protection de la branche `main` (ligne @security du 2026-09-30) ; région Neon contre Render, plan Render payant, protection et rétention de la base de production ; quota Drive. Mise à jour de la section « État actuel » du `README.md` (datée du 2026-09-29, elle annonce 30 migrations alors qu'il y en a 46) | — | HUMAN ; A26 pour le README | — | TIERS ; README PRÊT |
| 6 | **B-0** : `risk.owner.assign` et refus de l'auto-désignation (sans migration). Le refus strict reste compatible avec toute réponse à P3. Revoir les droits en staging et en production (SQL appliqué par HUMAN) | — | A06 ; HUMAN pour les droits | QA, Security | PRÊT |
| 7 | **B-8 Groupes fixes**, construit sur `roles`/`user_roles` (013). Trois groupes par tenant, non supprimables : Risk Manager, Risk Committee, Audit. Le retrait du dernier membre du groupe Risk Manager est refusé. Les groupes-départements attendent P4 | 2 | A06, A07 | QA, Security, Compliance | PRÊT (sans la partie départements) |
| 8 | **B-9 Échelle (F-13)** : taille de 3 à 6, identique pour la probabilité et pour chaque axe ; 7 axes au maximum ; un descriptif par niveau et par axe. Les règles s'appliquent aux **nouvelles** versions seulement, car les versions ACTIVE et ARCHIVED restent immuables (R-01). A07 vérifie les données existantes | 2 | A06, A07 | QA, Security, validation A13 | PRÊT |
| 9 | **B-6 Dispositif** : plan inchangé, avec une FK vers la version d'échelle (B-9) et le correctif F-8. L'approbateur d'activation appartient au groupe configuré (Audit ou Comité) et diffère du demandeur. Cette règle remplace `riskframework.activate.committee` | 3 (P1, P6), 7, 8 | A06, A07 | QA, Security, Compliance | PO |
| 10 | **B-5 Attribution RO/DEL/EXEC** : l'approbation est donnée par le groupe Risk Manager. La règle du plafond de cumul se branche dès que B-6 est mergé | 3 (P3, P4), 7 | A06, A07 | QA, Security, Compliance | PO |
| 11 | **DECISION-011, fenêtre de refus** : cadrage, puis revues Security et Privacy avant tout code, puis backend (la réponse 403 porte la permission manquante ; une route liste les détenteurs actifs du tenant avec nom et e-mail seulement) | 7 | A05, A10, A24, puis A06 | Security, Privacy, puis QA | PRÊT (cadrage) |
| 11a | **EVD-0 Import Excel d'évidences, arbitrages** : décisions §33 du CDC qui reviennent au PO (3, 4, 5, 8, 9, 10, 11, 12, 14), avec avis Security, Privacy et Compliance sur le cadrage `EVD-Import-Excel-cadrage.md`. Piste parallèle, **hors chemin critique RM** | — | HUMAN ; A10, A24, A14 | Decision Log | PO |
| 11b | **EVD-1 Socle preuve xlsx** (S) : xlsx dans l'allowlist, SHA-256/taille/MIME, doublon par hash, `getContent`, audit du téléchargement, `evidence.download` (HUMAN l'accorde par SQL aux rôles qui ont `evidence.read`) | 11a (décisions 1, 2, 5, 9) | A06, A07 ; HUMAN pour les droits | QA, Security, Compliance | PO |
| 11c | **EVD-2 Analyse (S) puis EVD-3 Dataset et versions de schéma (M)** | 11b | A06, A07 | QA, Security | PO |
| 11d | **EVD-4 Import, records JSONB et lineage** (M) | 11c ; décisions 10, 11 | A06, A07 | QA, Security, Privacy, Compliance | PO |
| 11e | **EVD-5 Assistant d'import frontend** (M) | 11d ; maquette A04 | dev-frontend | QA, Security | Après 11d |
| 12 | **B-2 Hybride** : retirer `process.evaluationmode.set` (F-10). Ne pas activer Hybride en production avant B-1 | 3 (P1, P2), 9, 10 | A06, A07 | QA, Security | PO |
| 13 | **B-1 Saisie selon le mode** : corrige F-12 et le commentaire « moyenne » (le code applique `Math.min`) ; A08 adapte les fixtures. Avant le déploiement, HUMAN complète les données (OD-8, reformulée : Processus avec un RO, contrôles avec un EXEC relié) | 3 (P5), 9, 10 | A06, A07 ; HUMAN pour les données | QA, Security, Compliance | PO |
| 14 | **B-7 Treatment Decision réalignée** : le RO ou le DEL effectif enregistre la décision ; recommandation non contraignante de l'équipe risque (sans migration) | 10 | A06 | QA, Security | PRÊT après 10 |
| 15 | **F-1 Frontend, contexte et refus** : Dispositif en lecture seule, mode effectif, provenance des saisies, badges de cumul, fenêtre DECISION-011 | 4, 9, 10, 11 | dev-frontend | QA (comparaison avec la maquette), Security, Privacy | Après 4 |
| 16 | **B-3 puis F-2 Contributions.** OD-4 (qui statue sur une contribution) est toujours ouverte dans ACTION_ITEMS et bloque B-3 | 4, 10, 13, OD-4 | A06, A07, puis dev-frontend | QA, Security | PO (OD-4) |
| 17 | **B-4 Signalement confidentiel ou nominatif** : avis des juristes internes, PRIVACY_ASSESSMENT et décision DPIA, reste d'OD-5 | DECISION-012 | A06, A07 | QA, Security, Privacy, Compliance | TIERS |
| 18 | **Fin de la Phase 4**, avec un cadrage A05 au moment venu et sans anticipation : Traitement, Suivi, Réévaluation, champs Analyse (OD-10, OD-11), Meeting. Cartographie/Risk 360 exige d'abord la matrice PRIV-CH-DASH-001 et l'affichage du statut de l'évaluation source (RISK_BLOCK) | 13 | A05, A13, A04, A06 | QA, Security, Privacy | Plus tard |
| 19 | **Phase 6 temps réel**, inchangée : contrat événementiel, WebSocket, resynchronisation REST, tests | 18 | A05, A06, dev-frontend | QA realtime | Plus tard |
| 20 | **Phase 7** : QA fonctionnelle, QA UX, QA sécurité, QA historique ; campagne de tests de sécurité de l'audit externe (point 3, non lancée) ; validations A13, A04 et A05 ; GO PO ; validation de staging | 19 | A08, A10, A14, A23, HUMAN | Gates §18 | Plus tard |
| 21 | **Préparation de la production** : PR `staging` → `main` (A22) ; migrations par le workflow avec approbation HUMAN | 5, 20 | A22, A09, HUMAN | GO PO | TIERS |

**Peut partir tout de suite** : 1, 2, 4 (déjà en cours), 6, 7 (hors départements), 8 et le cadrage de 11. Pour le code (6, 7, 8), il faut le go de lancement du PO, puisque la ligne ACTION_ITEMS du plan de lots le réserve.

**Chemin critique** : 2 → 3 → 7/8 → 9 → 10 → 13 → 16. L'étape 4 doit être terminée avant 15 et 16.

**Piste EVD (11a à 11e)** : elle ne dépend que d'Evidence et de ControlExecution, qui existent déjà. Elle ne dépend ni de B-8 (les permissions passent par les rôles existants), ni de DECISION-011, ni des notifications de DECISION-017 (l'import est synchrone). S'il n'y a qu'un seul A06, elle passe après le chemin critique. En parallèle, il faut un worktree dédié, et le numéro de migration se revérifie à la fusion, puisque B-8, B-9 et B-6 en consomment. Elle peut aller en production sans attendre l'étape 20 : il suffit de ses propres gates puis de l'étape 21.

## 3. Arbitrages PO ouverts et étapes qu'ils débloquent

| P | Question | Recommandation A05 | Débloque |
|---|---|---|---|
| P1 | Le mode par défaut est-il porté par le Dispositif ? | Oui. `Config.evaluationMode` devient obsolète sans être supprimé | 9, 12 |
| P2 | La validation d'un changement de mode revient-elle à la fonction risque (avec retrait de `process.evaluationmode.set`) ? | Oui | 12 |
| P3 | L'auto-désignation est-elle strictement interdite (DECISION-013 reformulée) ? | Oui, conformément à l'invariant 5 | 10 |
| P4 | Un Processus est-il rattaché à un groupe-département ? | Oui, par une FK simple vers le groupe, si le PO veut que le système vérifie la « direction » ; sinon la permission suffit | 7 (départements), 10 |
| P5 | Un membre du groupe Risk Manager qui est aussi RO, DEL ou EXEC peut-il saisir ou revoir ce risque ? | Non : garde de service, cumul marqué | 13 |
| P6 | Que faire si le groupe approbateur choisi (Audit ou Comité) est vide ? | Refuser de le choisir comme approbateur, et refuser l'activation tant qu'il est vide | 9 |

Le Risk Manager arbitre séparément F-9 (surcharge d'appétence) et les valeurs par défaut de B-6, avant le merge de l'étape 9.

## 4. Commentaire d'architecture sur le contrat amendé

Un point est **bloquant pour les étapes 8 et 9 uniquement** : le contrat ne reflète pas encore DECISION-016.
- Le §10 classe les échelles comme « déjà paramétrables » hors du Dispositif. Il donne le Comité comme approbateur.
- Le §8 dit encore « qui la propose reste à trancher ».

L'étape 2 lève ce blocage. Le reste de la séquence n'en dépend pas.
