# Revue A13 (Risk Manager) : DECISION-044, 2026-10-12

**Statut** : recommandations de A13, **non arbitrées**. Le PO (N0) décide.
**Sources lues** : `ACTION_ITEMS.md` (DECISION-044), spec B-6 à jour (§5.6, §14.2), `RoleService.ts`, `UserService.reactivate`, `ActionPlanService.resolveRecipients`, `RiskFrameworkService.decide`, `docs/security/B8-predeploy-checks.sql`.
**Distinction** : [Fait] vérifié dans le code ou la spec ; [Hypothèse] à vérifier ; [Avis] ma recommandation.
**Numérotation** : mes questions au PO sont notées `Q-A13-n` pour ne pas entrer en collision avec les q97+ de l'orchestrateur.

---

## 1. Interprétation de q82 et q83, avec I-D1 à I-D6

### 1.1 Verdict global

L'interprétation consignée est **fidèle sur la lettre mais incomplète sur les garde-fous**. Elle ne contredit aucun invariant, mais elle laisse trois trous que je propose de fermer sans changer la décision du PO : une fin réversible, une impossibilité invérifiable et une exception qui n'avertit personne quand Audit et le Comité sont vides.

### 1.2 q82 : « l'amorçage ne s'arrête pas tant que Comité ET Audit sont vides, pas de durée maximale »

- [Fait] Le PO retire ma recommandation de 90 jours (écart assumé, principe 33 : sa décision prime).
- [Avis] Une exception sans durée mais **avec une condition de fin d'événement** n'est pas une « exception permanente sans échéance » (mandat §32), à condition que trois choses existent : une liste fermée (q81, présente), une fin (q82), une trace (q83). Il manque un **signal d'ancienneté**. Je demande un KRI « âge de l'amorçage ouvert » (jours depuis la première décision BOOTSTRAP ou, à défaut, depuis la création du Dispositif initial) avec alerte au PO/HUMAN au-delà d'un seuil que le PO fixe. Ce n'est pas une durée maximale : c'est un voyant, qui ne bloque rien.

**I-D1, sens de « fin ».**
- [Fait] La lecture littérale (un seul membre Audit/Comité clôt) produit un tenant **bloqué** (1 RM + 1 membre d'Audit : Audit non sollicitable < 2, q72 ; pas de second RM ; q75 attente avec alerte). Le blocage est fail-closed, donc sûr, mais il pousse à contourner (compte fantôme, intervention en base).
- [Avis] Ne pas changer la règle du PO en silence (principe 37). Poser une question fermée **Q-A13-2** :
  - Option A (littérale, spec actuelle) : fin dès le premier membre actif d'Audit/Comité. Blocage possible, signalé par q75. Moins de souplesse, aucune fenêtre d'auto-approbation après l'arrivée d'un tiers.
  - Option B : fin quand un circuit est **opérable** (second RM actif, ou au moins 2 membres éligibles à Audit ou au Comité). Pas de blocage, mais l'auto-approbation persiste tant qu'un seul membre d'Audit existe, alors que ce tiers peut déjà lire la vue.
  - Option C (A + issue prévue) : fin littérale, mais la notification de blocage nomme explicitement les deux sorties (désigner un second RM, ajouter un second membre au groupe présent). Aucun changement de règle.
  - **Recommandation : A+C.** La règle du PO respecte l'invariant « un tiers prend connaissance » et le blocage est un coût de gouvernance acceptable et visible. B recrée une auto-approbation en présence d'un tiers.

**I-D3, fin définitive ou réversible.**
- [Avis] **Définitive**, à confirmer (recommandation A05 reprise). Raison de séparation des tâches : si l'amorçage se rouvre quand le dernier membre d'Audit/Comité ou le second RM part, un RM (ou un administrateur cumulant) peut le **rouvrir à volonté** en suspendant ou révoquant ce tiers, puis s'auto-approuver. C'est le contournement le plus bon marché du dispositif. La fin doit être **mémorisée** (marqueur de tenant `bootstrap_ended_at` posé par la première transition de fin, ou calcul sur l'historique `user_roles` en soft-delete comme le propose A05), jamais recalculée sur l'état courant des groupes.
- Pour l'activation du premier Dispositif la question ne se pose pas (une seule fois par tenant, garantie en base). Elle se pose pour les désignations B-5.
- [Hypothèse] La « réouverture contrôlée de BOOTSTRAP en base » de la spec (§1, B-6d) ne doit pas, elle non plus, rouvrir l'exception : c'est le CHECK 056 qui est remplacé, pas le droit.

**I-D2, « créer d'abord un autre utilisateur du groupe risque » (q83).**
- [Fait] Le RM n'a pas `user.create` (droit d'administrateur, q79). La lecture littérale est donc matériellement impossible pour lui seul.
- [Avis] Je **confirme la lecture déclarative** (le RM fait demander la désignation à un administrateur ; s'il n'y arrive pas, il le déclare), avec renforcement :
  1. motif **structuré et obligatoire** : à qui la demande a été faite (administrateur nommé), à quelle date, et pourquoi elle n'a pas abouti. Un motif libre « impossible » est une case à cocher ;
  2. **tiers prévenu même si Audit et Comité sont vides** : notification aux administrateurs du tenant autres que le RM, et signalement à HUMAN. Sans cela, l'exception est invisible tant que personne n'est dans les groupes (même défaut que N7 d'avant) ;
  3. l'exception ne lève **que** la règle « décideur ≠ demandeur ». Tous les autres invariants restent : pas d'auto-proposition (q65), pas de droits d'Audit (q67), plafonds de cumul RO + EXEC et DEL + EXEC de B-5, motif et audit transactionnel (q90) ;
  4. le tout reste **non vérifiable par le système** : le risque résiduel est accepté par le PO, pas par moi.

**I-D4, pas de ratification (q83) contre q62.**
- [Avis] **Je confirme que q83 l'emporte sur q62 pour le seul régime BOOTSTRAP** : c'est une décision explicite du PO, et q62 vise le repli, pas l'amorçage. Mais la ratification était le seul contrôle détectif prévu. Sa suppression laisse une seule mesure : la vue + la notification d'arrivée (`RISK_FRAMEWORK_BOOTSTRAP_NOTICE`). Je demande donc qu'elles soient réellement tracées : la notification lue/non lue est conservée, et le KRI « décisions BOOTSTRAP non consultées par au moins un membre d'Audit ou du Comité » existe, sans en faire une ratification bloquante. Risque accepté à acter par le PO : le premier Dispositif et les premières désignations d'un RM seul ne sont revus par personne s'il n'y a ni Audit ni Comité intéressé.

**I-D5, valeurs du Dispositif amorcé.**
- [Avis] L'invariant 8 **ne couvre pas** ce point : il interdit de paramétrer la séparation des tâches, pas le choix d'un seuil Comité bas ou de `committee_evaluation_enforced = false`. Un RM seul, sans contrôle, peut donc choisir la méthodologie qui évitera plus tard tout Comité. **Q-A13-3** (question PO fermée) :
  - Option A : le Dispositif activé par amorçage doit porter les valeurs par défaut du contrat ou plus strictes (5/9/15/21, `enforced = true`, approbateur RISK_MANAGER) ; toute valeur plus laxiste passe par une v2 au circuit normal ;
  - Option B : aucune restriction, trace seule.
  - **Recommandation : A** (recommandation A14, pas de coût de blocage car le défaut est le comportement attendu). Limite : un RM seul ne pourrait pas activer un Dispositif laxiste, donc il devrait attendre un tiers, ce qui est voulu.

**I-D6, notification d'arrivée.** Oui, obligatoire au catalogue comme les quatre de q95 (la détection a posteriori en dépend, cf. I-D4).

### 1.3 Ce qui reste ambigu et part en question au PO

- **Q-A13-2** (I-D1) et **Q-A13-3** (I-D5) ci-dessus.
- **Q-A13-4**, tiers prévenu de l'amorçage quand Audit et le Comité sont vides : (A) administrateurs du tenant autres que le RM + HUMAN ; (B) HUMAN seul ; (C) personne. **Recommandation : A.** Un administrateur ne décide rien (q80), il est seulement informé.

---

## 2. Version ACTIVE héritée avec approbateur COMMITTEE ou AUDIT

### 2.1 Constat

- [Fait] `RiskFrameworkService.decide()` résout le circuit à partir de la version ACTIVE en vigueur (`changeApprover`). Si le résultat est un VOTE, il répond `ConflictError` (409), **y compris pour un refus** (le chemin `REJECTED` passe par `resolveFor`). Seul le demandeur peut retirer.
- [Fait] Le trigger d'immuabilité (spec §6) interdit de modifier une version ACTIVE autre que le passage à ARCHIVED. L'« intervention en base » n'est donc pas un simple UPDATE : il faudrait **désactiver le trigger**, hors audit applicatif. C'est pire que le gel lui-même.
- [Fait] Depuis q87, aucune nouvelle version avec un tel approbateur ne peut être créée (le brouillon copié force RISK_MANAGER, spec). La population concernée est donc **finie et fermée** : seules les versions créées avant le correctif q87.
- [Hypothèse] En production, cette population est vide (pas d'utilisateurs, DECISION-038 §9, et aucun Dispositif activé avant B-6b). Sur staging, elle peut être non vide.

### 2.2 Recommandation (hiérarchisée)

1. **Obligatoire, coût nul : requête de repérage pré-déploiement**, lecture seule, exécutée par HUMAN et journalisée (même convention que `docs/security/B8-predeploy-checks.sql`) :
   `SELECT tenant_id, framework_id, id, version_number, change_approver FROM risk_framework_versions WHERE status IN ('ACTIVE','PENDING_APPROVAL') AND change_approver <> 'RISK_MANAGER';`
   Résultat attendu : 0 ligne. À ajouter aux contrôles pré-déploiement de B-6b.
2. **Si 0 ligne : rien d'autre.** Ne pas coder un garde-fou pour un cas vide ; risque résiduel **très faible**.
3. **Si ≥ 1 ligne : garde-fou applicatif minimal**, et pas de correction en base. Tant que B-12 n'est pas livré, une version ACTIVE héritée COMMITTEE/AUDIT se résout vers le repli **existant** `FALLBACK` (RM tiers non concerné, commentaire obligatoire, ratification PENDING, Audit/Comité prévenus), avec une cause enregistrée `LEGACY_APPROVER_PRE_B12` (même principe que F-B6a-05 : tracer la cause). Aucun nouveau régime de décision, jamais `NORMAL`. Le garde-fou disparaît à la livraison de B-12.
4. **Rejeté : l'intervention en base** (trigger désactivé, version modifiée sans trace). Rejeté aussi : traiter silencieusement l'approbateur hérité comme `RISK_MANAGER` en régime `NORMAL` (affaiblissement tacite d'un contrôle choisi par le client, principe 9 et mandat §33).

### 2.3 Risque résiduel

| Cas | Risque résiduel |
|---|---|
| 0 ligne, repérage fait | Très faible (population vide, création fermée par q87) |
| ≥ 1 ligne, garde-fou FALLBACK | Faible à moyen : double contrôle dégradé mais marqué, tracé, ratifiable |
| ≥ 1 ligne, rien | **Moyen à élevé** : Dispositif gelé, pression vers une intervention sans trace sur une table immuable |

Le choix 3 dégrade un contrôle que le PO avait choisi (Comité/Audit), donc c'est une décision PO : **Q-A13-1** (fermée) : (A) repérage seul et traitement au cas par cas si une ligne apparaît ; (B) repérage + garde-fou FALLBACK décrit ci-dessus ; (C) rien. **Recommandation : A, avec B préparé et activé seulement si le repérage renvoie une ligne.** C'est la ligne « pas de code spéculatif » (ponytail) sans laisser le gel sans issue.

---

## 3. Revue risque du lot fusionné (Trigger Matrix : Changement de rôle = Risk Oui)

### 3.1 Synthèse

| Point | Contrôle présent | Risque résiduel | Verdict |
|---|---|---|---|
| q94 RM + Comité interdit | Affectation, mise à jour de rôle, réactivation refusées [Fait] | Faible à moyen (cumuls actifs existants, impasse de réactivation, contournement par droits hérités [Hypothèse]) | Accepté sous conditions |
| q80 admin + Comité autorisé | Motif obligatoire, tiers prévenu, marquage [Fait] | **Moyen** : trou G1 (droits d'Audit appliqués sans contrôle par un admin + Comité), tiers prévenu inexistant si groupes vides | Correctif demandé |
| q79 `config.manage` = admin | Ajouté à `ADMIN_PERMISSIONS` [Fait]; détection #9 | Faible à moyen (effets de bord opérationnels, non rétroactif) | Accepté sous conditions |
| q84 destinataires d'action | Responsable + propriétaire et supérieur des risques couverts, dédoublonnés [Fait] | Faible (échec silencieux, périmètre limité) | Accepté ; q96 recommandée oui |

### 3.2 q94 : Risk Manager + Comité interdit

- [Fait] `assertNoCumul` couvre aussi le chemin partagé de mise à jour de rôle. `UserService.reactivate` appelle `assertReactivable` (refuse un cumul interdit antérieur). Cohérent avec ma recommandation de ne pas laisser ressusciter silencieusement un cumul interdit. Le contrôle F-B8b-02 (ligne « un RM + Comité n'est pas indépendant ») devient redondant mais sans danger.
- Risques et demandes :
  1. **Cumuls actifs existants** (non suspendus) : non traités par le code, seulement par la requête #8 du pré-déploiement. Demande : nettoyage tracé par HUMAN **avant** production, et défense en profondeur en B-12 : le calcul des éligibles au vote exclut toute personne qui cumule encore RM + Comité, quel que soit l'état de nettoyage.
  2. **Impasse de réactivation** : un utilisateur suspendu portant le cumul ne peut plus être réactivé tant qu'un des deux rôles n'est pas retiré. [Hypothèse] La sortie existe (révoquer un des deux rôles puis réactiver) : à faire tester par A08 sur un utilisateur **suspendu**, y compris quand c'est le dernier RM (règle « jamais vide ») et la règle du « dernier rôle actif ».
  3. **Droits hérités** [Hypothèse, A10] : `assertNoCumul` lit les rôles RBAC (`user_roles`). Les permissions effectives incluent aussi les anciens droits `users.roles` (SEC-005). Vérifier qu'un droit d'équivalent Comité ne peut pas être porté par cette voie. Non confirmé, à vérifier.
  4. `assertReactivable` ne contrôle pas le réglage de tenant « Comité + Audit interdit » (q58). Impact faible, à signaler.

### 3.3 q80 : administrateur + Comité autorisé mais marqué

- [Fait] `createsAdminCommitteeCumul` impose un motif, notifie les détenteurs de `rolegroup.audit.validate`, `isAdminAndCommittee` expose le marquage. Même mécanisme que q63.
- **G1, trou de séparation des tâches (le plus important du lot).** [Fait] `changeAuditGroupPermissions` ne met la modification en attente de validation que si l'auteur est **Risk Manager** (`systemGroup === "RISK_MANAGER"`). Un administrateur + Comité (non RM, désormais légal) applique donc **directement** une modification des droits d'Audit : aucune validation par un tiers, alors que q80 pose qu'un administrateur ne ratifie jamais un changement de droits qu'il a appliqué, et qu'un membre du Comité est précisément l'un des validateurs de ce flux. **Demande à A06/A10** : étendre la condition de mise en attente à l'appartenance au Comité (`RISK_COMMITTEE`). L'auteur reste exclu de la décision par `requestedBy`. Risque après correctif : faible.
- **G2, exclusion au vote (B-12).** « L'administrateur ne vote ni ne ratifie jamais une demande qu'il a faite ou un changement de droits qu'il a appliqué » doit être calculée par B-12 à partir de l'audit (entrées `ROLE_CHANGE`/`PERMISSION_CHANGE` dont `userId` = l'administrateur, sur les groupes concernés), pas à partir d'un champ à renseigner. À inscrire au cahier de B-12.
- **G3, tiers prévenu inexistant** quand Audit et le Comité sont vides : la notification part à des détenteurs de `audit.validate`, donc à personne. Même remède que Q-A13-4 (administrateurs autres + HUMAN).
- **G4, collusion croisée** : deux administrateurs peuvent s'affecter mutuellement le Comité (l'auto-affectation est interdite, pas la réciprocité). Mitigation : marquage + tiers prévenu (G3) + KRI « nombre de cumuls administrateur + groupe de gouvernance ». [Avis] suffisant pour la V1.
- **G5, administrateur + Audit** : [Fait] non interdit ni marqué (garde seulement : on ne modifie pas les droits d'un groupe auquel on appartient). Cumul plus sensible que administrateur + Comité (l'administrateur peut affecter des membres à Audit et modifier la composition de celui qui le contrôle). Déjà signalé DECISION-043. **Q-A13-5** (fermée) : (A) même traitement que q80 (motif, tiers prévenu, marquage) ; (B) interdire ; (C) rien. **Recommandation : A.**
- Détail : l'événement `ADMIN_RISK_MANAGER_CUMUL` est réutilisé pour le cas Comité, avec un message différent. Un KRI ou un filtre par type d'événement ne les distinguera pas. Mineur : un type dédié ou un champ `cumulKind`.

### 3.4 q79 : `config.manage` compte comme droit d'administrateur

- [Fait] `config.manage` n'est dans aucun groupe fixe (`fixedGroupPermissions`) : les Risk Managers ne deviennent pas tous administrateurs. [Fait] Il protège la gestion des tenants, modules, référentiels réglementaires, catégories de risque et l'**import Excel de risques**.
- Risques :
  1. **Non rétroactif** : les personnes qui détiennent déjà `config.manage` et sont RM ou Comité ne sont pas marquées après coup. La requête #9 les repère (`admin_before_q79` = faux signifie « concerné seulement depuis q79 »). Demande : marquage et motif posés à posteriori par HUMAN, tracés. Population probablement vide en production.
  2. **Effet de bord opérationnel** : si un RM a besoin d'importer des risques ou de gérer les catégories (taxonomie qui alimente l'appétence), il doit détenir `config.manage` et devient administrateur + RM marqué. Le marquage perd sa valeur de signal s'il est banal. [Avis, non bloquant] Question au PO : **Q-A13-6** (fermée) : (A) laisser en l'état ; (B) séparer des permissions dédiées (`riskimport.run`, `riskcategory.manage`) pour que le métier risque n'ait pas besoin du droit administrateur. **Recommandation : A pour le lot actuel, B à cadrer si le marquage devient fréquent** (KRI : nombre de cumuls marqués).
  3. Cohérent avec ma recommandation du 2026-10-11 : `config.update` (méthodologie, tenue par le groupe Risk Manager) ne compte pas.

### 3.5 q84 : destinataires des alertes d'action

- [Fait] `resolveRecipients` : responsable + propriétaire et supérieur de chaque risque couvert (source RISK et liens RISK), archivés exclus, dédoublonnés ; sans dépôt de risques : responsable seul. Les notifications sont par destinataire (un échec n'arrête pas les suivants). Aucun enjeu de séparation des tâches : c'est de l'escalade de responsabilité, cohérente avec « le propriétaire est redevable du traitement » (ISO 31000, avec la réserve de sourcing déjà posée).
- Risques résiduels :
  1. **Échec silencieux** : si la résolution du risque échoue, l'erreur est journalisée (`console.error`) et seul le responsable est alerté. Un retard d'action peut donc ne pas remonter au propriétaire sans trace visible. Demande légère : compteur ou audit de l'échec de résolution, et test d'un dépôt qui échoue.
  2. **Périmètre** : une action dont la source est FINDING, ANOMALY ou CONTROL et qui couvre des risques par un autre chemin (liens de contrôle) n'alerte pas leurs propriétaires. Conforme à la lettre de q84 (« risque couvert par l'action »), à signaler comme limite.
  3. **Propriétaire absent ou égal au responsable** : si le superviseur est vide et que le propriétaire est aussi le responsable, aucune alerte indépendante. Mineur, à surveiller par KRI « actions en retard sans destinataire indépendant ».
- **q96 (ouverte).** [Fait] `Kri.riskId` est le lien principal obligatoire (ACT-130) : un KRI a donc toujours un risque. [Avis] **Oui, notifier aussi propriétaire et supérieur du risque du KRI**, pour une action dont la source est un KRI. Raisons : l'alerte de dépassement du KRI part déjà vers eux avec la même résolution ; l'action est la réponse à cette alerte ; un retard sur l'action est sinon connu du seul responsable, sans le propriétaire redevable du risque. Coût : une résolution KRI → risque dans `resolveRecipients`. Si le KRI n'a pas de risque exploitable, repli sur le responsable seul. À poser au PO comme question fermée (le PO a déjà la q96 ouverte) : (A) oui [recommandée] ; (B) non, responsable seul.

### 3.6 Risque de séparation des tâches non couvert (liste)

1. **G1** : administrateur + Comité applique seul des droits d'Audit (correctif demandé).
2. Amorçage : sans tiers prévenu si groupes vides (I-D2, G3).
3. Fin d'amorçage réversible (I-D3) : contournement bon marché.
4. Administrateur + Audit non encadré (G5).
5. Droits hérités (`users.roles`) hors du contrôle de cumul [Hypothèse, A10].
6. Cumuls RM + Comité actifs avant q94 et administrateurs `config.manage` préexistants non marqués : nettoyage HUMAN avant production.

---

## 4. Questions de la spec §14.2 adressées à A13

### B-6b, paramètres q91

- **R1.** Non, rester sur la liste de q91 : statuts de contribution (B-3) et mode d'appétence/surcharge (F-9) restent dans leur lot. **Réserve** : tant que le mode d'appétence reste dans `configs`, il est modifiable hors du circuit d'approbation du Dispositif. [Fait] Aucun code ne le lit aujourd'hui (spec §3) : risque nul pour l'instant. À l'arbitrage F-9, il rejoint le Dispositif, et l'invariant 8 (une surcharge ne fait jamais disparaître un dépassement) s'applique. Non bloquant.
- **R2.** Seuil « faible » : proposer une valeur, **sans la pré-remplir silencieusement**. Valeur suggérée : borne haute de la bande de criticité la plus basse. Le champ reste obligatoire, saisi explicitement. [Avis] Un avertissement (non bloquant, motif attendu) si la valeur dépasse cette borne : un seuil « faible » plus haut élargit l'exception de cumul RO + Exécuteur. Le PO veut un dispositif configurable (principe 29), donc pas de plafond dur.
- **R3.** Oui, **« interdit » est la seule alternative**, dans la direction stricte. Une troisième valeur « toujours autorisé » abaisserait un invariant (principe 28, principe 24). Nuance à garder dans le libellé : `true` pour RO + EXEC veut dire « autorisé jusqu'au seuil faible, exception approuvée au-delà », pas « autorisé partout ». DEL + EXEC : `true` n'enlève jamais « le délégué ne valide pas sa propre exécution ».
- **R4.** Deux valeurs (`RISK_TEAM`, `FIRST_LINE`) suffisent pour la V1 : ce sont les deux seuls saisissants possibles de la Maîtrise (équipe risque ou 1re ligne). Pas d'autre valeur à ajouter maintenant. Conditions : (i) avec `FIRST_LINE`, la revue par une 2e personne reste un invariant et non un paramètre (principe 19) ; (ii) marquer le Dispositif « indépendance réduite sur la Maîtrise » à l'approbation, visible dans les écrans et à la validation ; (iii) conserver les deux saisies quand deux acteurs notent la même cellule (principe 20, pas de moyenne). Une valeur « le propriétaire saisit » (ma recommandation du 2026-10-08) n'est pas reprise : le PO a fait de la Maîtrise un paramètre (DECISION-015).
- **R5.** Oui, B-5 doit **exiger une date de fin sur chaque délégation datée**. `delegation_max_days = NULL` veut dire « pas de plafond fixé par le client », pas « délégation sans fin » : une délégation sans date de fin est une exception permanente sans échéance (mandat §32). Le plafond peut rester libre, la date jamais. Signal : KRI sur les délégations arrivant à échéance.

### B-6c

- **I-C1.** **Confirmé.** Comparer les seuils d'une version à l'échelle d'un autre Dispositif n'a pas de sens méthodologique : la comparabilité de la Cartographie passe par les bandes de chaque échelle, pas par un plafond commun. Condition : le retrait n'a lieu que lorsque l'inventaire des lecteurs hérités est vide, avec le test de précondition prévu. Pas de réserve de risque au-delà.
- **I-C2.** **Confirmé** (pas de gel par `ReviewCycle` en B-6c). Chaque évaluation fige sa version à la création (F-8), donc l'historique n'est jamais réécrit. Risque résiduel : une même campagne peut contenir des évaluations de Dispositifs différents si un Processus change en cours de cycle. Mitigation : afficher la version par évaluation dans la vue de campagne. À revoir quand le lien évaluation ↔ campagne existera.
- **I-C3** (information). D'accord avec A14 sur le risque d'évasion (rattacher un Processus à un Dispositif moins exigeant pour éviter un vote). Théorique tant que seul RISK_MANAGER est possible (q87). À traiter en B-12, avec le KRI « changements de Dispositif de Processus vers une règle moins exigeante ».

---

## 5. Récapitulatif des demandes

**À A06/A10** : G1 (condition de mise en attente étendue au Comité) ; vérification des droits hérités ; échec silencieux de `resolveRecipients` ; test de réactivation d'un utilisateur suspendu cumulant.
**À A05 (spec B-6)** : I-D3 fin définitive et mémorisée ; I-D2 motif structuré ; notification de l'amorçage vers les administrateurs et HUMAN si groupes vides ; l'exception ne lève que « décideur ≠ demandeur » ; exclusion de vote B-12 calculée depuis l'audit.
**À HUMAN avant production** : requêtes #8, #9 et celle du §2.2 ; nettoyage tracé.
**Questions PO (fermées, avec recommandation)** : Q-A13-1 (version héritée), Q-A13-2 (sens de « fin »), Q-A13-3 (valeurs de l'amorçage), Q-A13-4 (tiers prévenu), Q-A13-5 (administrateur + Audit), Q-A13-6 (`config.manage` et import), q96 (notifier le propriétaire du risque du KRI).
