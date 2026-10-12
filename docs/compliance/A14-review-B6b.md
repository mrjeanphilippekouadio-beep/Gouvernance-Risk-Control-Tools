# Passage Compliance A14 : B-6b, branchement du Dispositif (commit 45cbd86, tête e25820f)

Date : 2026-10-12. Déclencheur : GRC Trigger Matrix, ligne « gouvernance des paramètres » (`product-manager.md` §64).
Statut : recommandations de A14 (2e ligne), non arbitrées. Aucun texte BCEAO consulté : aucune obligation réglementaire n'est affirmée, la qualification relève des juristes de Djamo.
Périmètre évalué : migration `059_risk_framework_branching.sql`, `RiskEvaluationService.create` (l. 194-234, 435-440, 635-657), spec B-6 §2.2, §8, §12.2, revue A13 (`docs/risk/A13-review-DECISION-044.md`), ACTION_ITEMS B-6b-01 à 03. Je n'ai pas relu les tests, ni les autres lecteurs de l'échelle. Pas de test exécuté. Limites : conclusion limitée à ces pièces.

## 1. Verdict

Conforme avec réserves. Aucun COMPLIANCE_BLOCK pour le merge ni pour staging. Trois conditions pour la production (section 5). Aucune exigence réglementaire n'est démontrée comme violée : ce sont des exigences internes de traçabilité (piste d'audit, preuve de la règle appliquée).

## 2. Traçabilité de l'instantané et du rattrapage

Conforme :
- À la création, la version, l'échelle (id et version) et les trois seuils sont figés par le service à partir de la version résolue ; le mode d'évaluation vient aussi de la version. Aucun repli vers `configs` à la création (sans Dispositif : refus). Les paramètres q91 ne sont pas copiés ; la FK vers une version immuable (trigger 056/059) suffit comme preuve.
- Le trigger `risk_framework_versions_guard` redéfini conserve la garde d'activation de 056 et le `search_path` (conforme CLAUDE.md, F-B6a-11). Les huit colonnes q91 sont dans `same_content`.
- La migration est idempotente et le rattrapage ne touche que les lignes à seuils vides.

Constats :

**C-B6b-01 (moyen) : un seuil rattrapé n'est pas identifiable comme tel, seulement comme « sans version ».** Pour un auditeur, `risk_framework_version_id IS NULL` signifie « antérieure au Dispositif », et c'est la seule marque. Elle distingue bien un vrai instantané d'un rattrapage, à condition que le service pose toujours la version. Trois limites :
1. Les trois origines d'un seuil sans version sont indiscernables : copie de `configs`, repli calculé `floor(P×I×15/25)` (avec `GREATEST(1, …)`, absent de la spec §8.1, sans effet sur 5/9/15/21), ou ligne insérée plus tard sans câblage (point 3). Or ce ne sont pas des preuves de même valeur.
2. Le rattrapage copie `configs` **tel qu'il est à la date de la migration**, pas tel qu'il était à la création de l'évaluation. Si le seuil a changé entre-temps, la valeur copiée n'est pas la règle qui s'appliquait. C'est une valeur de reprise, pas une preuve. La spec le dit pour la version (« on n'affirme pas une méthodologie qu'on ne peut pas prouver ») mais pas pour les seuils : les seuils rattrapés ressemblent à de vrais instantanés dans la table.
3. `RiskEvaluationService` ne fige que si `this.frameworks` est câblé (paramètre optionnel, motif CLAUDE.md). Sans lui, la création réussit sans instantané, et `resolveCommitteeEvaluationSettings` (l. 657) relit `configs` en direct pour la validation. En production, `server.ts` câble : c'est à vérifier par un test qui échoue si le câblage disparaît, sinon le défaut est silencieux.
Aucune trace d'audit du rattrapage lui-même n'existe (la migration n'écrit pas dans `audit_log`, ce qui est normal pour une migration, mais alors la trace doit être ailleurs).
Réserve de portée : en production il n'y a pas d'utilisateurs (DECISION-038 §9), la population rattrapée y est probablement vide. Sur staging elle ne l'est sans doute pas. À prouver par comptage, pas à supposer.

Demande : (a) HUMAN exécute avant production, lecture seule, et journalise : le nombre de lignes `risk_evaluations` sans version, ventilé par présence d'une ligne `configs` pour le tenant (copie ou repli). (b) Si le compte est supérieur à 0 en production, ajouter une colonne de provenance (`snapshot_source` : `FRAMEWORK`, `BACKFILL_CONFIG`, `BACKFILL_DEFAULT`, NULL interdit sauf lignes nouvelles non câblées) ; sinon, la documenter comme exception connue de staging. (c) Libellé d'affichage et de rapport : une évaluation sans version est « antérieure au Dispositif, seuils de reprise », jamais « conforme à la méthodologie X ». (d) Un test garantit que `server.ts` câble `frameworks` dans `RiskEvaluationService`.

## 3. Les points ouverts sont-ils bloquants ?

| Item | Qualification A14 | Bloquant avant production ? |
|---|---|---|
| B-6b-01 : `RatingScaleService.activateVersion` second écrivain | Écart à la règle « source unique » (spec §0 point 4, §3) et à CLAUDE.md (une activation de ce type est un effet terminal : permission dédiée, SEC-013). L'échelle déjà figée sur les évaluations et le trigger `rating_scales_framework_freeze` limitent l'impact sur les preuves existantes ; le risque porte sur les plafonds hérités (`resolveMaxScore`) et sur le miroir de statut, qui peuvent diverger du Dispositif. | **Oui, condition de production** : fermer, ou à défaut prouver que la route est inaccessible (permission non attribuée) et que tout appel est audité. Pas bloquant pour staging. Le fichier est resté hors du périmètre de l'agent : à confier à A06 avec une échéance. |
| B-6b-02 : inventaire des lecteurs incomplet | Bloque B-6c (retrait du contrôle de plafond inter-Dispositifs). Tant que `resolveMaxScore` lit « l'échelle ACTIVE », un seul Dispositif cohérent suffit. | Non pour B-6b en production **tant qu'il n'y a qu'un Dispositif** et que B-6c n'est pas livré ; oui pour B-6c. Garder le test de précondition « inventaire vide ». |
| B-6b-03 : avertissement R2 absent | A13 (R2) demandait un avertissement, pas un plafond. Le champ est obligatoire et saisi explicitement, validé contre n² ; la décision reste tracée par la demande d'activation et son approbation par un tiers. | Non. Compensation : le motif de la demande d'activation doit citer le seuil « faible » s'il dépasse la borne haute de la bande la plus basse (à confirmer par A13, non implémenté à ma connaissance). |

## 4. Gouvernance des paramètres (lacunes)

1. **Versions déjà ACTIVE avec `low_criticality_threshold` NULL.** Acceptable parce que fail-closed (tout cumul RO + Exécuteur passe par l'exception approuvée), mais seulement si B-5 le code ainsi. Condition portée à B-5 : un test explicite « NULL = exception approuvée ». Sans lui, NULL peut être lu comme « pas de limite ». Je signale aussi qu'une version ACTIVE ne peut plus être corrigée (immuable) : renseigner le seuil exige une v2 par le circuit normal, avec les conséquences q86/q93.
2. **`delegation_max_days` NULL.** Cohérent avec A13 R5 si B-5 exige toujours une date de fin. Même condition de test.
3. **`mastery_authoritative_source = FIRST_LINE`.** A13 (R4 ii) demande de marquer le Dispositif « indépendance réduite sur la Maîtrise » à l'approbation. Je n'ai pas vu où c'est fait : à vérifier, sinon écart de B-1. Rapprochement avec mon principe 9 (saisie de 1re ligne = contribution, pas cotation qui fait foi).
4. **Paramètres sans lecteur livré** (`hybrid_policy_enabled`, `committee_vote_rule`, `risk_owner_executor_cumul_allowed`…) : acceptés par la spec. Risque : un Dispositif approuvé affiche un réglage qui n'a aucun effet. L'écran de création doit le dire (lot F). Sinon, forme de « compliance by assertion » côté client.
5. **Fermeture des écrivains conditionnée au câblage** (paramètre optionnel) : même test de câblage que le point C-B6b-01 (d), pour `ConfigService` et `RiskAppetiteService`.
6. **Période sans évaluation (q86).** Elle doit se terminer. En production, B-6d doit partir avant ou avec B-6b (un seul RM, q93). Je vérifie seulement la précondition, pas son état : B-6d n'est pas encore livré selon le journal. Déployer B-6b sans B-6d en production = COMPLIANCE_BLOCK (la période sans évaluation n'a pas de fin).
7. **Rien à ajouter** sur : immuabilité, `search_path`, contraintes CHECK, absence de DELETE, audit transactionnel du Dispositif (q90, acquis en B-6a).

## 5. Conditions avant production

1. B-6d déployé avant ou avec B-6b (spec §8.0).
2. Comptage journalisé par HUMAN des évaluations rattrapées ; colonne de provenance si le compte est supérieur à 0 (C-B6b-01).
3. B-6b-01 fermé, ou compensation prouvée. Test de câblage `server.ts` en place.
Requêtes pré-déploiement déjà demandées (n° 8, 9, 10 de `B8-predeploy-checks.sql`) : inchangées.

## 6. Questions pour HUMAN (PO)

- **Q-A14-B6b-1.** Faut-il une colonne de provenance du seuil (`snapshot_source`) dès maintenant (nouvelle migration), ou accepte-t-on « sans version = antérieure, seuils de reprise » tant que la population de production est vide ? Recommandation A14 : décider après le comptage ; colonne seulement si le compte est supérieur à 0.
- **Q-A14-B6b-2.** B-6b-01 : échéance avant la première mise en production ? Recommandation : oui, condition de production.
- **Q-A14-B6b-3.** Les rapports aux autorités ou à l'audit doivent-ils présenter les évaluations sans version comme « antérieures au Dispositif » sans conclure sur leur conformité méthodologique ? Recommandation : oui. Les juristes de Djamo confirment si un texte l'impose.

## 7. Actions à porter dans ACTION_ITEMS (règle 7bis, par l'orchestrateur)

C-B6b-01 (HUMAN, comptage ; A06, test de câblage) ; condition prod B-6b-01 (A06) ; vérification R4(ii) marquage `FIRST_LINE` (A13/A06) ; test NULL fail-closed (B-5, A06).
