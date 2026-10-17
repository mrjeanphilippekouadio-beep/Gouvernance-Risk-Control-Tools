# Passage Compliance A14 : B-6d, amorçage avec un seul Risk Manager et repli q100 (commit 9f53463)

Date : 2026-10-18. Déclencheur : spec B-6 §17 (A14 après B-6b et B-6d) et GRC Trigger Matrix, ligne « gouvernance des paramètres » (`product-manager.md` §64). B-6d est la seule exception à « jamais d'auto-approbation ».
Statut : recommandations de A14 (2e ligne), non arbitrées. Aucun texte BCEAO consulté : aucune obligation réglementaire n'est affirmée ni niée ; les exigences évaluées sont celles du contrat RM V1 (q62, q77, q83, q100 à q103, DECISION-040) et de la spec.
Périmètre lu : `RiskFrameworkService.ts` (bootstrapApprove, checkDeclaration, decide, resolveFor), `frameworkApproval.ts`, migration `062_risk_framework_bootstrap.sql`, `PostgresRiskFrameworkRepository` (recordBootstrapDecision, activate, readBootstrapFacts, latestBootstrapRequest), `RoleService.notifyBootstrapArrival`, câblage `server.ts` (l. 269, 276), catalogue de notifications, liste des tests de `B6d.test.ts` (titres seulement), spec §5.4.1, §5.6, §13, §17, A13 §7, DECISION-045 à 048, ACTION_ITEMS. Contrat : q77, q83 et DECISION-040/043 lus dans `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` (l. 141 à 145) ; le reste du §5 n'a pas été relu en entier. Je n'ai exécuté aucun test ni lu `git show` (outil Bash indisponible) ; je m'appuie sur les fichiers de la branche. Limites : conclusion limitée à ces pièces.

## 1. Verdict

**CONFORME AVEC RÉSERVES.** Aucun COMPLIANCE_BLOCK pour le merge ni pour staging.

Le COMPLIANCE_BLOCK annoncé dans `A14-review-B6b.md` (B-6b en production sans B-6d) est **levé pour ce qui est du code** : l'amorçage et le repli q100 existent, ferment la « période sans évaluation » et sont contrôlés sous verrou. Il **subsiste comme règle de livraison** : B-6b ne part pas en production sans B-6d dans la même livraison (section 5). Pas de nouvelle exigence réglementaire démontrée violée.

## 2. Q1 : l'amorçage est-il traçable et exploitable par un auditeur externe ?

Conforme :
- **Marquage.** `decision_regime = 'BOOTSTRAP'` sur la demande, sur l'événement d'audit `STATUS_CHANGE` de la version (`new.decisionRegime`, `requestId`) et sur `APPROVE`. Le CHECK `bootstrap_shape_check` borne le régime (ACTIVATE_VERSION, APPROVED, `decided_by = requested_by`, groupe RM, pas de ratification, pas de cause de repli, commentaire et justification non nuls). Le CHECK `bootstrap_just_regime_check` lie régime et justification. Les deux sont NOT VALID : ils s'appliquent aux nouvelles lignes (voir C-B6d-07).
- **Motif structuré (q83).** `askedUserId` (utilisateur actif du tenant détenant une permission d'administrateur), `askedOn` (date valide, pas dans le futur), `outcome` (texte obligatoire, 500 caractères), plus `comment` obligatoire. Tous côté serveur ; `decidedBy` est forcé à `actor.userId`, et l'amorçage n'est ouvert qu'au demandeur.
- **Valeurs libres figées (I-D8, A13 §7.1).** `freeParameters` : taille d'échelle, appétences, seuil « faible », durée de délégation, seuil Comité de traitement, plus `lowThresholdToExamine` (R2, sans refus). Elles sont posées par le serveur à partir de la version, jamais du corps de la requête, et stockées dans `bootstrap_justification` et dans l'audit transactionnel (q90). Aucun plafond, conformément à A13. Mon avis : suffisant pour I-D8.
- **Périmètre fermé.** Premier Dispositif du tenant seulement, valeurs par défaut du contrat (`contractDefaultViolations`), pas d'auto-proposition, circuit non fonctionnel, RM unique, fin non posée : tout relu sous le verrou du tenant, puis répété par la garde SQL de version (premier Dispositif, fin non posée). Aucune ratification (q83), cohérent avec le contrat.
- **Consultation.** `GET /change-requests?regime=BOOTSTRAP` sous `riskframework.read`, détenue par Comité et Audit (`fixedGroupPermissions.ts`) : un auditeur peut lister les décisions avec leurs valeurs figées.
- **Notification.** `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` obligatoire au catalogue (q99), envoyée après commit aux membres actifs d'Audit et du Comité, et à tout nouveau membre qui y entre (`RoleService.notifyBootstrapArrival`, aussi `UserService.reactivate`), sans condition de fin d'amorçage. Groupes vides : personne d'autre (q103, choix du PO, appliqué tel quel).

Réserves :

**C-B6d-01 (moyen) : la fin d'amorçage est datée mais pas prouvable dans sa cause.** `tenants.risk_framework_bootstrap_ended_at` est posée par trigger, protégée contre toute modification (42501), sans ligne d'audit propre (spec §5.6 point 5, §13). Pour un auditeur externe :
1. Le marqueur dit « quand », pas « par quelle affectation ou quel utilisateur ». La corrélation se fait par horodatage avec `ROLE_CHANGE`, dont l'audit est écrit hors transaction (AUD-D044, ouvert) : la ligne peut manquer.
2. Pour les tenants déjà « fonctionnels » à la migration, la date posée est celle de la migration, pas celle de la fin réelle (« l'historique n'est pas reconstitué »). Une date de reprise se lit comme une date d'événement.
3. Deux chemins ne posent pas le marqueur (limite documentée) : changement de `roles.system_group`, réactivation d'un rôle désactivé. L'amorçage reste alors « ouvert » en base alors qu'un circuit fonctionne. Le service le refuse tout de même (`CIRCUIT_FUNCTIONAL` sous verrou), mais la fin n'est pas mémorisée, donc pas définitive (q102) : si le second membre repart, l'amorçage pourrait se rouvrir par ce chemin.
Demande (A06/A07, avant d'appliquer 062 : elle n'a jamais été appliquée hors PG16 local, donc sans migration supplémentaire) : (a) mémoriser la cause, par exemple l'identifiant de l'affectation ou de l'utilisateur qui a déclenché le trigger, ou la valeur `MIGRATION_062` pour la reprise, dans une colonne jumelle du marqueur (mêmes règles d'immuabilité) ; (b) un test qui échoue si le trigger de fin n'écrit pas la cause ; (c) une ligne d'`ACTION_ITEMS` « procédure HUMAN : en cas de changement de `system_group` ou de réactivation de rôle, vérifier le marqueur » tant que (3) n'est pas couvert. Preuve de fin : « marqueur + cause + ROLE_CHANGE correspondant », jamais le marqueur seul.

**C-B6d-02 (moyen) : la vue « décisions prises en votre absence » n'est pas livrée.** Le contrat (q77, DECISION-040 : « tout nouvel utilisateur ajouté au Comité ou à Audit dispose d'une vue de toutes les décisions prises en son absence ») la promet ; la spec la renvoie au lot F. Aujourd'hui seule la route API existe. La notification est au mieux (échec journalisé, jamais fatal) et sans accusé : rien ne prouve que le premier membre a pris connaissance des valeurs libres. Ce n'est pas une ratification (le contrat n'en veut pas), mais l'« auditeur informé » (q101) reste déclaratif. Demande : (a) la vue (lot F) livrée avant l'arrivée du premier membre Audit ou Comité en production, ou, à défaut, une procédure écrite où HUMAN lui indique la route ; (b) pour une version ultérieure, une « prise de connaissance » tracée (qui, quand), distincte de la ratification, pour que l'information soit démontrable. Point (b) : suggestion, pas condition.

**C-B6d-03 (faible à moyen) : la déclaration n'est pas contestable.** (i) `askedUserId` n'est ni prévenu ni invité à confirmer ; le RM peut citer un administrateur qui n'a rien reçu. Le système ne peut pas vérifier l'impossibilité (A13 I-D2 point 4, accepté), mais il peut rendre la déclaration contestable en notifiant l'administrateur cité (information seule : « vous êtes cité comme sollicité le AAAA-MM-JJ »). (ii) Le texte de la notice ne reprend pas le motif (`outcome`, `askedOn`, administrateur cité), ni le marquage administrateur + RM que A13 §7.2 point 2 voulait y voir ; il renvoie à la consultation. Demande : notifier `askedUserId` (type existant ou catalogue) ; ajouter à la notice qui a décidé, la date, le motif et le cumul éventuel. Non bloquant.

**C-B6d-04 (faible, risque accepté par le PO) : amorçage sans ratification ni échéance, groupes vides non alertés.** Conforme au contrat (q83, q103). Je le note comme risque résiduel : tant qu'Audit et Comité sont vides, le premier Dispositif d'un RM seul n'est revu par personne, et aucun délai n'oblige à y mettre fin. Atténuations existantes : valeurs figées, route de consultation, correction par v2 au circuit normal. Je recommande l'indicateur d'ancienneté de l'amorçage déjà demandé par A13 (KRI, lot KRI), visible du Risk Manager, sans notification supplémentaire (q103 respectée).

## 3. Q2 : le repli q100, séparation des tâches et ratification

Conforme :
- **Séparation.** Le repli passe par `decide`, donc : `riskframework.activate`, membre RM actif, demandeur exclu, auteurs de la version exclus (journal d'audit, échelle en brouillon), version rejouée à l'approbation. L'administrateur seul ne décide jamais. L'amorçage ne s'applique jamais ici (une version ACTIVE existe).
- **Marquage.** `foldVoteBeforeB12` ne produit jamais `NORMAL` : régime `FALLBACK`, `ratification_status = PENDING`, `fallback_cause = LEGACY_APPROVER_PRE_B12`, `bypassedGroups` dans l'audit. Les CHECK interdisent une cause hors repli ratifiable. Commentaire obligatoire. Les groupes contournés sont prévenus avec Audit. Suffisant au regard du contrat (q62, q100).
- **Repérage.** Requête n° 10 présente dans `B8-predeploy-checks.sql` (attendu 0 ligne). Si elle renvoie 0, le repli ne peut pas se produire en production : le risque est alors celui du code mort.

**C-B6d-05 (moyen) : la ratification est promise, mais aucun mécanisme ne peut l'écrire avant B-12.** Déjà relevé en B-6a (la ligne de demande est append-only ; table dédiée à prévoir). Les décisions de repli s'accumulent en `PENDING` sans échéance (q74 : pas de délai). Je n'ai pas vérifié l'indicateur « décisions en attente de ratification » dans le code livré. Demande : (a) confirmer que l'indicateur existe (ou l'ajouter à l'API) ; (b) B-12 : ratification dans une table propre, avec le principe q73 (on ne ratifie pas ce à quoi on a pris part) ; (c) tant que B-12 n'existe pas, ne pas afficher « ratifiée » ou « en cours de ratification » : le libellé est « en attente de ratification ».

## 4. Autres constats

**C-B6d-06 (faible) : écart spec / code sur I-D9.** Le code refuse `askedUserId = actor.userId` (constante `BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF = false`) ; la spec §5.6 point 6 et §14.2 disent encore « il peut s'agir du demandeur lui-même ». Le code est du côté sûr. À aligner par A05 après la réponse q113. Si le PO assouplissait, la bascule de la constante ne suffirait pas : il faudrait marquer ces décisions « auto-désignées » dans la notice et l'audit.

**C-B6d-07 (faible) : 062 jamais appliquée hors PG16 local.** (i) Jouer d'abord sur une copie de la base de staging, avec contrôle du remplissage (`risk_framework_bootstrap_ended_at` posé pour les tenants à 2 membres). (ii) Les CHECK NOT VALID (`bootstrap_shape`, `bootstrap_just_regime`) ne sont jamais validés : prévoir, comme pour 061, un `VALIDATE CONSTRAINT` après contrôle des données. (iii) Garde de version redéfinie avec `search_path` (conforme CLAUDE.md) : rien à ajouter.

**C-B6d-08 (faible) : câblage de l'arrivée de membre.** `server.ts` passe bien `riskFrameworkRepository` à `RoleService` (l. 269) et `roleService` à `UserService` (l. 399). Mais le test de câblage B-6b-04 ne semble couvrir que les services de B-6b ; sans test, la perte de ce paramètre optionnel désactiverait la notice d'arrivée en silence (mon principe 19). Demande : étendre le test de câblage à `RoleService` (8e argument) et `RiskFrameworkService` (notifications).

Constats B-6b : (d) « test de câblage » de C-B6b-01 : un test existe pour B-6b (`B6bFollowups.test.ts`), point traité sous réserve que A08 le confirme.

## 5. Q3 : le COMPLIANCE_BLOCK est-il levé, et conditions avant production

Levé pour le code. Conditions restantes, toutes avant la première mise en production :
1. **Livraison conjointe** : B-6b et B-6d déployés ensemble (même `npm run migrate`, 059 à 062, même version du backend). Jamais B-6b seule.
2. **Requête n° 10** (`B8-predeploy-checks.sql`), exécutée par HUMAN et journalisée : attendu 0 ligne ; sinon, repli q100 à traiter avant production.
3. **Comptage DECISION-047** (évaluations sans version, par HUMAN) : toujours en attente ; si le compte est supérieur à 0, colonne de provenance à spécifier avant production.
4. **B-6b-01 / q108** (DECISION-048) : à revérifier dans la checklist (activateVersion refusé quand le Dispositif est branché) ; la revérification n'est pas faite par ce passage.
5. **q113** : voir section 6. Le code est du côté sûr ; mais si le cas de Djamo est « unique administrateur = unique Risk Manager » (q93), l'amorçage par déclaration est refusé et il faut un plan avant production (second administrateur désigné, ou second membre RM réel).
6. **C-B6d-01** (cause de fin, avant d'appliquer 062) et **C-B6d-07** (essai sur copie de staging).
7. **C-B6d-02** : vue « décisions prises en votre absence » ou procédure transitoire avant l'arrivée du premier membre Audit/Comité.
8. Passages A08 et A10 de B-6d : non relus ici ; leur résultat conditionne la production.
Non bloquants pour la production : C-B6d-03, -04, -05, -06, -08.

## 6. Q4 : q113 (I-D9), avis sur l'option recommandée par A13

**Avis A14 : je soutiens l'interdiction.** Raisons :
1. Séparation des tâches : sans tiers au dossier, la même personne exprime le besoin, atteste son impossibilité et en tire seule le bénéfice (s'auto-approuver). C'est ce que mes principes 9 à 11 refusent (désignation jamais auto-attribuée).
2. La prémisse de q83 (le RM ne peut pas créer d'utilisateur faute de droit) n'existe pas pour un RM administrateur : la déclaration serait invérifiable et sans objet.
3. Fail-closed et visible : le refus dit les deux sorties (autre administrateur ; second membre RM). Aucun contournement en base.
Point de vigilance : la sortie (b) (l'administrateur-RM crée lui-même le second RM) met fin à l'amorçage sans décision BOOTSTRAP, sans notice, sans motif ; si le second compte est fictif ou contrôlé par la même personne, c'est une auto-approbation silencieuse, moins traçable que l'amorçage. Atténuations existantes : motif obligatoire d'affectation, cumul administrateur + RM marqué et notifié (q63), `ROLE_CHANGE`. Elles ne servent que si Audit ou Comité existent. D'où ma préférence pour la sortie (a) : un second administrateur réel, nommé.
**Question fermée au PO (q113, recommandation A14 : oui) :** « Confirmez-vous qu'un Risk Manager qui est aussi administrateur ne peut pas se désigner lui-même comme administrateur sollicité ? Recommandation : oui, le cas échéant Djamo désigne avant production un second administrateur ou un second membre réel du groupe Risk Manager. »
Précision à vérifier par HUMAN : le cas de Djamo au démarrage (q93).

## 7. Questions pour HUMAN (PO)

- **Q-A14-B6d-1 (= q113).** Voir section 6. Recommandation : oui, interdire.
- **Q-A14-B6d-2.** La vue « décisions prises en votre absence » (lot F) est-elle livrée avant l'arrivée du premier membre Audit/Comité en production, avec à défaut une procédure écrite de HUMAN ? Recommandation : oui.

## 8. Actions pour ACTION_ITEMS (règle 7bis, à porter par l'orchestrateur)

C-B6d-01 (A06/A07 : cause de fin dans 062 avant application ; HUMAN : procédure) ; C-B6d-02 (Dev Frontend : vue ; HUMAN : procédure transitoire) ; C-B6d-03 (A06 : notifier l'administrateur cité, enrichir la notice) ; C-B6d-05 (A06 : indicateur ; B-12 : table de ratification) ; C-B6d-06 (A05 : aligner la spec après q113) ; C-B6d-07 (HUMAN/A07 : essai sur copie de staging, VALIDATE CONSTRAINT) ; C-B6d-08 (A06/A08 : test de câblage) ; conditions de production de la section 5.
