# Passage Compliance B-6a : Dispositif de gestion des risques versionné

**Agent** : A14 (Compliance, 2e ligne). **Date** : 2026-10-12. **Commit examiné** : `0a465fa` (HEAD 32b93ab).
**Périmètre** : spec `docs/architecture/RM-V1-B6-Dispositif-spec.md`, `RiskFrameworkService`, `PostgresRiskFrameworkRepository`, `domain/frameworkApproval.ts`, `riskFrameworks.routes.ts`, migration 055 (et son `.down.sql`), `fixedGroupPermissions`, `test/B6a.test.ts` (titres des tests seulement). Les tests n'ont pas été exécutés (pas de Bash).
**Référentiel** : contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §5/§8 (circuit unique, q62, q72, q75, q76), Decision Log jusqu'à DECISION-043, CLAUDE.md « Security-sensitive conventions ».
**Statut de cet avis** : recommandation. Aucun texte BCEAO n'a été consulté pour ce passage. Les références réglementaires (Instruction 017-12-2010 : séparation des tâches incompatibles, piste d'audit conservée 10 ans minimum, information fiable aux organes dirigeants) sont celles du cadre de travail du rôle, **à faire confirmer par les juristes de Djamo** avant toute affirmation d'obligation. Applicabilité : Djamo est traité comme fintech UEMOA ; l'agrément exact reste à confirmer (point déjà ouvert depuis DECISION-012). Les référentiels COSO ERM, ISO 31000 et Bâle ne sont cités ici que comme benchmarks.

## 1. Verdict

**CONFORME AVEC RÉSERVES.** Aucun COMPLIANCE_BLOCK, rien qui empêche le merge ni l'usage sur staging. Le socle de gouvernance est solide (maker-checker appliqué à trois niveaux, versions activées immuables et jamais supprimables, repli marqué, jamais de validation tacite). Les réserves se résument à ceci :

1. L'audit hors transaction (q90) est acceptable **pour staging**, avec conditions, et **à fermer avant la mise en production** au moins pour l'activation d'une version.
2. Un verrouillage de la gouvernance que l'on peut s'infliger soi-même avant B-12 (approbateur de type vote).
3. Trois points à encoder dans B-12 pour que le repli reste lisible : « et » dégradé, ratification, vote unique.

Conclusion limitée au périmètre examiné : B-6a seul. B-6b (source unique, instantané F-8) et B-6c/d ne sont pas évalués.

## 2. Ce qui est conforme (preuves lues)

| Attente | Constat | Preuve |
|---|---|---|
| Maker-checker de l'activation | Décideur ≠ demandeur, ≠ auteur de la version, membre actif du groupe Risk Manager, l'administrateur seul jamais décideur. Contrôle en service **et** en base pour demandeur ≠ décideur | `decide()` (l. 355-417), `authorsOf` (l. 489), CHECK `risk_framework_change_requests_maker_checker` (055 l. 107) |
| Droit dédié pour l'acte terminal | `riskframework.activate` distinct de `update` ; abandon d'un brouillon sous `riskframework.archive` ; aucun champ `status` accepté (`.strict()` zod, whitelist `PARAM_KEYS`, `DRAFT_COLUMNS`) | service l. 266-281, routes l. 21-30 |
| Attribution forcée côté serveur | `requestedBy`, `decidedBy`, `createdBy`, `lastEditedBy` jamais lus du corps | routes l. 55-59, test « never reads an attribution field » |
| Immuabilité d'une version activée | Trigger : seule la transition ACTIVE vers ARCHIVED, contenu inchangé, motif et auteur d'archivage obligatoires ; PENDING figée ; DELETE et TRUNCATE refusés ; `REVOKE DELETE, TRUNCATE` | 055 l. 146-204, l. 262-263 |
| Conservation des versions archivées | Aucune voie de suppression (ni service, ni trigger, ni droit SQL). Échelle référencée par une version non brouillon : contenu et suppression douce gelés | 055 l. 238-258 |
| Demandes append-only | Une seule transition PENDING vers une décision ; contenu de la demande intangible ; une seule demande PENDING par Dispositif et type | 055 l. 207-229, l. 113 |
| Traçabilité de la décision | `decided_by`, `decided_at`, `decision_regime`, `decider_group`, `decision_comment`, `ratification_status` écrits **dans la transaction de l'action** ; la version activée porte `activated_at` et `activation_request_id` ; l'ancienne version porte `archived_by` et « remplacée par vN » | `recordDecision` (repository l. 430-503) |
| Audit de chaque transition | CREATE, UPDATE, STATUS_CHANGE (activation, abandon, retrait), SUBMIT, APPROVE, REJECT ; l'activation journalise la version précédente complète et la nouvelle avec régime et id de demande | service l. 198-418, spec §13 |
| Atomicité de la bascule | Réservation `FOR UPDATE`, archivage de l'ancienne, activation, miroir des échelles, défaut du tenant : une seule transaction | repository l. 430-503 |
| Fail-closed | Vote requis : 409, demande reste PENDING ; plus personne pour décider : PENDING + alerte NO_DECIDER, pas de validation tacite ; auto-proposition refusée dès la demande hors vote du Comité (q65) ; sous-catégorie d'appétence refusée si le dépôt n'est pas câblé | service l. 305-326, l. 379-382 |
| Repli marqué (q62, q72) | Groupe sollicité seulement s'il a au moins 2 éligibles ; repli RM : commentaire obligatoire, `ratification_status = PENDING`, Audit notifié | `frameworkApproval.ts`, service l. 383-415 |
| Moindre privilège des groupes fixes | RISK_MANAGER : 6 droits ; Comité et Audit : lecture seule | `fixedGroupPermissions.ts` l. 22-38 |

## 3. Écarts et réserves

Gravité : MOYEN = à traiter avant production ou avant B-12 ; FAIBLE = à traiter au fil des lots ; INFO = à connaître.

### C-B6a-01 | MOYEN | Audit écrit hors transaction (q90) : conséquences plus larges que « un log manquant »

**Référence** : invariant 7 / q12 du contrat, spec §13 « Écart connu », Compliance B-8 (même écart déjà suivi comme lot transverse), principe 6 de ma mémoire (`audit_log` append-only, piste d'audit).

**Constats** :
- L'action (décision, activation, archivage) est validée, puis l'audit est écrit. Si l'audit échoue, l'erreur est renvoyée au client **alors que l'action est appliquée** (service l. 403-407). Un client qui retente reçoit 409 « déjà traitée » sans comprendre.
- Conséquence non mentionnée dans la spec : l'exception remonte **avant** les notifications (l. 409-415). Donc, après un échec d'audit, ni le demandeur ni **Audit** ne sont prévenus. La notification « Audit prévenu chaque fois qu'il n'est pas lui-même décideur » (q34, q56) saute silencieusement dans le cas où la piste est déjà dégradée. Même chose à la soumission (SUBMIT en échec : pas de notification `CHANGE_PENDING`).
- Le contrôle d'indépendance « auteur de la version » (l. 489-497) s'appuie sur les entrées CREATE/UPDATE du journal. Une entrée UPDATE perdue rend l'auteur invisible ; seul `last_edited_by` (le dernier éditeur) le rattrape. Un échec d'audit peut donc, dans un cas étroit, affaiblir le maker-checker.

**Facteurs atténuants** : pour l'activation, l'information essentielle (qui a demandé, qui a décidé, quand, selon quel régime, avec quel commentaire, quelle version remplace laquelle) est dans des lignes immuables écrites **dans la transaction** ; la perte de l'entrée `audit_log` ne fait donc pas perdre la décision, elle fait perdre la piste centralisée et la comparaison ancien/nouveau (reconstituable depuis les versions immuables). Pas d'utilisateur en production (DECISION-038 §9, d'après la spec).

**Recommandation** (réponse à q90) : **accepter pour staging**, avec ces conditions, puis fermer avant la production :
1. Envoyer les notifications d'Audit et du demandeur **même si l'audit a échoué** (les isoler dans un `finally` ou les placer avant l'écriture de l'audit), puisqu'elles sont « au mieux ». À corriger dans le prochain lot A06, coût faible.
2. Ajouter à `B8-predeploy-checks.sql` (ou équivalent) une requête de réconciliation : demandes `APPROVED`/`REJECTED`/`WITHDRAWN` et versions `ACTIVE`/`ARCHIVED` sans ligne `audit_log` correspondante. Alerte A23, comme pour le contrôle n°7 de B-8.
3. Poser une ligne `ACTION_ITEMS.md` avec owner et échéance pour le lot transverse « audit dans la même transaction » (règle 7bis). Une acceptation sans échéance n'est pas une acceptation.
4. **Condition de mise en production** : pour l'activation et l'archivage d'une version, écrire la ligne d'audit dans la **même transaction** que la bascule (le dépôt a déjà son client transactionnel, `recordDecision`). C'est le seul événement de B-6a où la perte de la piste est à la fois rare, grave et facile à éviter. Le reste (brouillons, identité) peut attendre le lot transverse.

### C-B6a-02 | MOYEN | Verrouillage de la gouvernance par un approbateur « vote » avant B-12 (q87)

**Référence** : spec §14 Q2, contrat §5 (circuit), q75.

**Constat** : la demande qui exige un vote reste PENDING (fail-closed, conforme à q87). Mais rien n'empêche aujourd'hui un Risk Manager de **faire approuver** une version v2 avec `changeApprover = COMMITTEE`, `AUDIT` ou `AUDIT_AND_COMMITTEE`. Dès que le Comité ou Audit compte au moins 2 éligibles, **toute modification suivante, y compris le retour à `RISK_MANAGER`**, exige un vote qui n'existe pas. La méthodologie est alors gelée, sans issue applicative (la seule sortie est une intervention base de données, donc hors circuit). C'est l'inverse de la gouvernance voulue : un mécanisme de contrôle qui bloque la correction d'un risque ou d'un changement réglementaire.

**Recommandation** : accepter la mise en attente fail-closed (q87), **et** refuser en B-6a, à la demande d'activation, tout `changeApprover` autre que `RISK_MANAGER` tant que B-12 n'est pas livré (message : « disponible avec le vote du Comité »). C'est cohérent avec l'esprit « en faire moins » de q87/q92 et ne coûte qu'une garde dans `requestActivation`. À défaut, mettre un avertissement explicite dans l'interface et prévoir une procédure d'urgence documentée (approbation par repli RM si le vote reste sans réponse après un délai fixé par le PO). Ajouter aussi un indicateur d'**ancienneté des demandes PENDING** (voir C-B6a-05).

### C-B6a-03 | MOYEN (latent, à encoder dans B-12) | « Audit et Comité » dégradé sans marquage ; ratification impossible en l'état

**Référence** : écart déclaré par A06 ; spec §14 Q3 ; contrat q62, q64, q73, DECISION-040 (ma mémoire, principe 15).

**Constat** :
1. `AUDIT_AND_COMMITTEE` avec un seul groupe éligible : seul ce groupe vote (`frameworkApproval.ts` l. 32-35). Le choix « les deux contrôlent » devient un contrôle simple, **sans trace que le double contrôle a été dégradé**. Le résultat de `resolveDecider` ne distingue pas « les deux groupes votent » de « un seul groupe a pu voter ». Quand B-12 branchera le vote, la décision sera écrite `NORMAL`, alors que l'intention du client (double validation) n'est pas respectée.
2. Si le groupe unique est **Audit**, c'est la 3e ligne qui décide seule : il faut le marquage « prise par la 3e ligne » (q64) et le repli en ratification (q62/q76).
3. Le cas « aucun groupe éligible » vers le repli RM, avec commentaire obligatoire et ratification en attente, est conforme.
4. La table n'a pas de place pour la ratification : le CHECK `ratification_status = 'PENDING'` n'accepte aucune autre valeur et le trigger interdit toute mise à jour d'une demande non PENDING (055 l. 212). La ratification a posteriori (q62, q74) ne pourra donc pas être inscrite sur la même ligne : B-12 devra créer une table ou un événement de ratification append-only, ou assouplir la migration.

**Écart déclaré par A06 (comportement « un seul groupe éligible vote »)** : acceptable **comme repli** si, et seulement si, la décision est marquée dégradée. Je ne le tiens pas pour non conforme, car le contrat (q69, q72) autorise déjà de « sauter le maillon indisponible » en repli marqué.

**Recommandation** : en B-12, `resolveDecider` doit renvoyer pour `AUDIT_AND_COMMITTEE` un indicateur `degraded: true` (groupes demandés ≠ groupes sollicités) ; la décision est alors écrite `FALLBACK` (ou un régime `PARTIAL`), le groupe manquant est notifié, la ratification est ouverte pour ce groupe, et la vue Comité/Audit affiche « contrôle double dégradé ». Définir dès maintenant (ligne `ACTION_ITEMS.md`) le modèle de ratification append-only. Aucune action requise sur B-6a, hors consigner la contrainte.

### C-B6a-04 | FAIBLE | Retrait (WITHDRAWN) sans décideur : conforme, avec trois points d'attention

**Écart déclaré par A06** : une demande retirée n'a pas de décideur. **Avis : conforme.** Un retrait n'est pas une décision ; la contrainte `risk_framework_change_requests_decision_check` l'impose en base (WITHDRAWN : `decided_by` NULL, `decision_regime` NULL), le retrait est réservé au demandeur (service l. 343), la version revient en brouillon et la ligne reste dans l'historique.

Points d'attention :
1. Le motif de retrait est **facultatif** (l. 345). Je recommande de le rendre obligatoire : retirer une demande est une décision de gouvernance du demandeur (et c'est la seule issue pour une demande en attente d'un vote inexistant). Coût faible.
2. L'identité de la personne qui retire n'est pas dans la ligne (le CHECK interdit `decided_by`). Elle ressort de `requested_by` (retrait réservé au demandeur) et de l'audit `STATUS_CHANGE`. Acceptable ; documenter dans la spec.
3. Un refus ou un retrait suivi d'une nouvelle soumission du même contenu n'est pas signalé à l'approbateur suivant (spec §4 : « le refus n'est pas compté comme un échec »). Risque de recherche d'un décideur plus favorable. Recommandation : afficher dans la nouvelle demande l'historique des refus/retraits de la même version (lien vers les demandes précédentes) et suivre un KRI « nombre de soumissions par version ».

### C-B6a-05 | FAIBLE | Alerte « plus personne pour décider » (q75) : non persistante

**Référence** : contrat q75 (« une alerte visible de tous les membres Risk Manager et un indicateur la suit »).

**Constat** : `NO_DECIDER` n'est émis qu'à la création de la demande (service l. 319-322). Si les décideurs disparaissent **après** (RM suspendu, révoqué), aucune alerte. Il n'existe pas d'indicateur d'ancienneté ni de volume des demandes PENDING ou en attente de vote.
**Recommandation** : un indicateur « demandes PENDING par ancienneté et par motif d'attente (vote, aucun décideur) », alimentant le tableau de bord GRC ; relance de l'alerte à chaque lecture de la liste ou par tâche planifiée. Non bloquant.

### C-B6a-06 | FAIBLE | Commentaire d'approbation facultatif en régime normal

**Référence** : contrat « Le motif est obligatoire et tracé » (circuit unique) ; mon principe sur les décisions sensibles : motif, approbateur distinct, audit.

**Constat** : le commentaire n'est obligatoire que pour un refus et pour un repli (l. 384). Une approbation « normale » de changement de seuils d'appétence ou de seuils Comité peut être validée sans aucun motif.
**Recommandation** : exiger un commentaire pour toute décision, ou au minimum pour toute approbation modifiant un seuil Comité, un seuil d'appétence ou l'approbateur. Un motif d'approbation est la première chose qu'un auditeur ou un contrôleur demandera.

### C-B6a-07 | FAIBLE | Défense en profondeur : l'activation n'est pas liée en base à une approbation d'un tiers

**Constat** : le trigger autorise PENDING vers ACTIVE avec seulement `activated_at` renseigné. `activation_request_id` est nullable, sans FK ni contrôle. Un accès SQL ou un bug applicatif futur (B-6b, B-12) pourrait activer une version sans demande approuvée par un tiers, ou ramener PENDING vers DRAFT sans demande REJECTED/WITHDRAWN. Le maker-checker repose alors sur le service seul pour ce chemin (il est bien en base pour la demande, pas pour la version).
**Recommandation** : dans le trigger, exiger pour `NEW.status = 'ACTIVE'` que `activation_request_id` désigne une demande `APPROVED` de la même version dont `decided_by <> requested_by` (sauf BOOTSTRAP). Ajout compatible avec l'idempotence de 055 (nouvelle migration 05x, `CREATE OR REPLACE FUNCTION`). Non bloquant ; à faire en B-6b, quand le Dispositif devient source unique.

### C-B6a-08 | FAIBLE | `.down.sql` : détruit l'historique de gouvernance

`055_risk_frameworks.down.sql` fait `DROP TABLE` des trois tables. Une fois qu'une version a été activée, ce script détruit l'historique des méthodologies et des décisions (conservation attendue, cf. 10 ans cités pour la piste d'audit, **à confirmer par un juriste**). Les triggers de TRUNCATE ne protègent pas contre `DROP TABLE`.
**Recommandation** : ajouter en tête du `.down.sql` un en-tête « Ne jamais exécuter sur un environnement où une version a été activée, sauf export préalable des trois tables archivé et validé ». Et laisser le propriétaire de base en dehors des droits de `grc_app_runtime`. Ne pas confondre : cet écart ne concerne pas le fonctionnement normal.

### C-B6a-09 | INFO | Couverture de tests des cas de gouvernance

D'après les titres de `test/B6a.test.ts`, ne sont pas couverts : échec d'écriture de l'audit après décision (comportement et notifications), `AUDIT_AND_COMMITTEE` avec un seul groupe éligible, refus (`reject`) d'une demande qui exige un vote (409), retrait sans motif, approbation sans commentaire, perte de décideur après création. À transmettre à A08 (cas limites inter-modules, hors périmètre A06 niveau 1).

## 4. Réponse point par point aux sujets demandés

| Sujet | Avis |
|---|---|
| Séparation des tâches / maker-checker | Conforme. Trois niveaux (service, auteur par audit + `last_edited_by`, CHECK en base pour le demandeur). Réserves C-B6a-01 (dépendance à l'audit), C-B6a-07 (version non liée en base). Cumul RM + administrateur : traité en tant que RM (q63), conforme au contrat |
| Traçabilité des transitions | Conforme pour les données métier (lignes immuables dans la transaction). Écart sur la piste centrale : C-B6a-01 |
| Immuabilité des versions activées | Conforme, défense en profondeur correcte (service, trigger, REVOKE, gel de l'échelle). Réserve C-B6a-07 |
| Conservation des versions archivées | Conforme (aucun chemin de suppression). Réserve C-B6a-08 sur le `.down.sql` |
| Rôle du Comité et d'Audit | Conforme en B-6a : Audit prévenu, jamais décideur ici ; aucune permission d'écriture pour Comité/Audit. Le rôle décisionnaire est entièrement renvoyé à B-12 : C-B6a-02, C-B6a-03 |
| q87 (demande en attente tant que le vote n'existe pas) | Conforme (fail-closed, jamais de validation tacite). À durcir par la garde de C-B6a-02 |
| Écart A06 n°1 : WITHDRAWN sans décideur | Conforme, voir C-B6a-04 |
| Écart A06 n°2 : « et » avec un seul groupe | Acceptable comme repli seulement si marqué dégradé, voir C-B6a-03. Aucun groupe éligible vers le repli RM : conforme |
| Écart A06 n°3 : audit hors transaction (q90) | Accepté pour staging avec conditions, à fermer avant production pour l'activation, voir C-B6a-01 |

## 5. Questions PO à enjeu de conformité

| Question | Enjeu | Recommandation Compliance |
|---|---|---|
| **q87** attente d'un vote inexistant | Gouvernance : verrouillage possible (C-B6a-02) | Accepter le fail-closed, **refuser tout approbateur autre que `RISK_MANAGER` jusqu'à B-12** |
| **q90** audit hors transaction | Piste d'audit (C-B6a-01) | Accepter pour staging, avec les conditions 1 à 3 ; **condition de production** : audit de l'activation dans la transaction (condition 4). Ne pas en faire une exception permanente |
| **q92** auto-proposition désactivée jusqu'à B-12 | Auto-validation : risque maîtrisé | Accepter. Conforme à q65 et au fail-closed. Aucune réserve |
| **q91** paramètres reportés aux lots consommateurs | Faible. Les versions archivées reçoivent a posteriori la valeur par défaut du contrat | Accepter, à condition que chaque migration le documente (valeur par défaut = comportement implicite antérieur) et que le gel d'une version archivée soit réaffirmé par un test |
| **q88** ordre des votes « et » (Comité puis Audit) | Indépendance d'Audit : un vote d'Audit après le Comité fait de la 3e ligne un coauteur de la décision | Décision du PO. Si Comité puis Audit : la voix d'Audit doit être marquée « 3e ligne », avec dégradation marquée (C-B6a-03). Éviter qu'Audit vote en premier ou seul sans ratification |
| **q89** règle d'approbation du Dispositif quitté ou cible (B-6c) | Contournement : rattacher un Processus à un Dispositif moins exigeant évite un vote | La recommandation d'A05 (règle du **Dispositif cible**) est insuffisante seule. Je recommande **la plus exigeante des deux règles** ; à défaut, les deux approbations. Mise en œuvre B-6c |
| **q86** fenêtre de bascule (B-6b) | Continuité : aucune évaluation tant que le Dispositif n'est pas activé. Traçabilité des évaluations historiques | Accepter tant qu'il n'y a pas d'utilisateurs réels, avec une procédure de bascule écrite et sa preuve (activation du « Dispositif initial » par un RM, décision d'un second RM). Point de vigilance pour B-6b : ne pas rattacher silencieusement les évaluations antérieures au Dispositif par défaut (spec §9) ; les marquer « antérieures au Dispositif » (version inconnue), faute de quoi on affirme une méthodologie qu'on ne peut pas prouver |
| **q81-q83** amorçage q77 (B-6d) | Seule exception écrite à « jamais d'auto-approbation » : séparation des tâches. Le premier Dispositif fixe aussi les seuils Comité et l'approbateur | Voir ci-dessous |

### Détail q81-q83 (amorçage)

L'exception est un **auto-contrôle** à la création du cadre qui régira tous les autres contrôles. Je recommande :

1. **D'abord, ne pas l'ouvrir si Djamo a au moins deux Risk Managers au démarrage.** Dans ce cas, l'exception est inutile : un second RM décide. Demander au PO combien de RM actifs Djamo aura à la mise en production. La production n'a pas d'utilisateurs : sur staging, désigner un second RM de test suffit. B-6d peut donc rester non développé tant qu'aucun client n'a un seul RM.
2. **q81 (périmètre)** : la recommandation de l'orchestrateur est bonne (activation du premier Dispositif seulement, plus les désignations de B-5 ; auto-proposition et droits d'Audit exclus). J'ajoute : **le Dispositif amorcé reprend les valeurs par défaut du contrat** (seuils Comité 5/9/15/21 pour une échelle 5x5, `committee_evaluation_enforced = true`, `change_approver = RISK_MANAGER`, `self_proposal_allowed = false`). Toute valeur plus laxiste suit le circuit normal. Sinon, un RM seul pourrait fixer un seuil Comité qui rend le Comité sans objet.
3. **q82 (fin)** : l'exception doit **s'éteindre**, pas seulement être « non bloquante » : fin dès qu'un 2e RM, un membre d'Audit ou du Comité existe, et au plus tard 90 jours (si `tenants.created_at` existe) ; après quoi, attente avec alerte (q75).
4. **q83 (ratification)** : « non bloquante » est acceptable si la ratification a un **délai et un responsable**, un indicateur « décisions BOOTSTRAP non ratifiées », et si un refus de ratification rouvre le dossier. Commentaire de décision obligatoire. Régime `BOOTSTRAP` visible dans la vue Comité/Audit.
5. Hors périmètre B-6a, mais lié : les questions q79 (droits de configuration = administrateur ?) et q80 (admin + Comité), déjà posées, doivent être arbitrées avant B-6b, car elles déterminent qui peut contourner la règle q51 par la voie des rôles.

## 6. Actions demandées

| N° | Action | Owner | Échéance proposée |
|---|---|---|---|
| A-1 | Notifications Audit/demandeur indépendantes de l'écriture de l'audit (C-B6a-01.1) | A06 | prochain lot B-6 |
| A-2 | Requête de réconciliation « décision/activation sans audit » (C-B6a-01.2) | A06 / A23 | avant staging utilisateur |
| A-3 | Ligne ACTION_ITEMS pour l'audit dans la transaction, avec l'activation traitée avant production (C-B6a-01.3-4) | Orchestrateur | à ouvrir immédiatement |
| A-4 | Garde `changeApprover = RISK_MANAGER` seulement jusqu'à B-12 (C-B6a-02) ; décision HUMAN sur q87 | HUMAN, A06 | avant staging utilisateur |
| A-5 | Modèle de ratification append-only et marquage « double contrôle dégradé » (C-B6a-03) | A05 | avant B-12 |
| A-6 | Motif de retrait et d'approbation obligatoires ; historique des refus visible (C-B6a-04, 06) | A06 | lot B-6 suivant |
| A-7 | Trigger : activation liée à une demande APPROVED par un tiers (C-B6a-07) | A07 | B-6b |
| A-8 | En-tête d'avertissement du `.down.sql` (C-B6a-08) | A07 | immédiat |
| A-9 | Tests des cas de C-B6a-09 | A08 | passage QA B-6a |
| A-10 | HUMAN : arbitrer q81-q83, q86-q92 (section 5) | HUMAN | selon calendrier lots |
| A-11 | Juristes Djamo : confirmer agrément, durée de conservation de la piste d'audit, séparation des tâches applicable | Juristes Djamo | avant production |

## 7. Limites de la conclusion

- Périmètre : B-6a, code et migration 055 lus ; tests non exécutés ; aucune base réelle ; interface non examinée.
- Période : état du dépôt au commit `0a465fa`.
- Aucun texte BCEAO, Commission Bancaire ou CENTIF n'a été consulté ; les attentes réglementaires sont citées comme principes à faire valider par un juriste.
- Les mesures de B-6b (source unique, fermeture des écritures concurrentes, instantané F-8) conditionnent l'effet réel du Dispositif ; je ne conclus pas sur elles.
- Pas de revue Privacy (aucune donnée personnelle nouvelle, hors identifiants d'utilisateurs dans les traces) ni Risk (cotation non modifiée).
