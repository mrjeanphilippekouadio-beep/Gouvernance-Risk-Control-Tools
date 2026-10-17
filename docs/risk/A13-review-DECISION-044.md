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

---

## 6. Arbitrages complémentaires (A13, 2026-10-12) : F-D044-08 et I-D7

**Statut** : recommandations A13 ; le PO reste décideur. Sources relues : `RoleService.ts` (`isCommitteeRole` l. 51, `assertCumulRules` l. 377-385, `assignToUser` l. 455-458), retest A10 F-D044-01 (F-D044-08), DECISION-044 points 4-5, DECISION-046 points 2 et 4.

### 6.1 F-D044-08 (a) : q58, cumul Comité + Audit interdit par le tenant

- [Fait] `assertCumulRules` définit le côté Audit par les pouvoirs effectifs (`AUDIT` ou `audit.*`) mais le côté Comité par le seul groupe. La règle est donc déjà asymétrique : elle regarde la substance d'un côté et l'étiquette de l'autre.
- [Fait, A10] Le groupe Audit + un rôle ordinaire `riskevaluation.validate.committee` passe ; avec le groupe Comité, il est refusé. Le réglage du tenant est contourné.
- **Verdict : OUI, étendre à `isCommitteeRole`, dans les deux sens** (assignation et élargissement de rôle, comme le demande A10).
- Justification (séparation des fonctions) : le réglage existe pour que celui qui valide en Comité ne soit pas celui qui contrôle a posteriori. Cette incompatibilité tient aux pouvoirs, pas au nom du groupe. Laisser l'étiquette seule revient à offrir à chacun un contournement par un rôle ordinaire, que q94 a déjà fermé pour le Risk Manager. Garder une définition de « membre du Comité » par règle fabriquerait des Comités différents selon le contrôle regardé.
- Risque de sur-blocage : faible. La règle ne joue que si le tenant a choisi d'interdire (défaut : autorisé, q58). L'extension durcit un choix du client, elle n'en crée pas un. Aucun risque d'affaiblir un contrôle.
- Limites à signaler à A06 (non bloquantes) : (i) pas de rétroactivité, les cumuls Comité-par-pouvoirs + Audit déjà en place ne sont pas touchés ; si le tenant a interdit le cumul, les repérer par une lecture seule du type de la requête 8, nettoyage tracé par HUMAN ; (ii) `assertReactivable` ne contrôle pas q58 (déjà noté en 3.2 point 4) : sans effet nouveau, à traiter en même temps si le coût est nul.
- **Relève-t-il du PO ? Non.** Ce n'est pas un nouveau choix de gouvernance : q58 et q94 emploient le même mot « Comité », et la définition par les pouvoirs a été retenue pour q94 et q80. Aligner q58 est de la cohérence d'implémentation. À consigner pour information dans le Decision Log, sans question.

### 6.2 F-D044-08 (b) : q65, notification `COMMITTEE_MEMBER_ADDED` aux membres d'Audit

- [Fait] `assignToUser` ne notifie que si `role.systemGroup === "RISK_COMMITTEE"`. Une entrée par un rôle ordinaire portant un pouvoir de validation Comité ne notifie personne (0 notification, PoC A10).
- **Verdict : OUI, étendre à `isCommitteeRole`.**
- Justification (détection a posteriori) : q65 est un contrôle détectif, et seul celui-là prévient Audit qu'une personne vient de recevoir le pouvoir de valider. Si la voie la plus discrète (le rôle ordinaire) est la seule qui ne déclenche rien, le contrôle ne couvre que le chemin que personne n'emprunterait pour contourner. Une notification en trop coûte une ligne ; une entrée sans notification se détecte tard ou jamais.
- Deux précisions à transmettre à A06 pour que le contrôle soit complet :
  1. **Élargissement d'un rôle ordinaire déjà détenu** : ajouter un pouvoir Comité à un rôle existant fait entrer ses titulaires au Comité sans aucune assignation. Si la notification est liée à `assignToUser`, ce chemin reste muet. Soit notifier à l'élargissement (une notification par titulaire nouvellement concerné, ou une seule nommant le rôle), soit l'écrire explicitement hors périmètre avec sa justification. Je recommande de le couvrir.
  2. **Anti-doublon** : notifier à la transition « n'était pas membre du Comité, l'est maintenant » (état avant/après, comme le fait déjà `createsAdminCommitteeCumul`), pas à chaque rôle supplémentaire d'un membre déjà au Comité.
- [Hypothèse] L'évènement `COMMITTEE_MEMBER_ADDED` est au catalogue des notifications obligatoires (q85 les rend obligatoires). Le type reste inchangé, donc aucune modification du catalogue.
- **Relève-t-il du PO ? Non**, pour la même raison que 6.1. Le seul point où le PO pourrait avoir une préférence (notifier aussi à l'élargissement de rôle) est un détail d'exécution, pas une règle de gouvernance ; je ne l'élève pas.

### 6.3 I-D7 : lecture de q103 face à q101

Textes :
- q101 (PO) : « le risk manager continue de s'auto-approuver et l'auditeur est informé » ; l'amorçage ne se termine que quand un circuit fonctionne (second RM actif ou ≥ 2 membres éligibles au Comité ou à l'Audit, q72).
- q103 (PO) : « les actions sont journalisées pour consultation dès que l'un des groupes Audit et/ou Comité est supérieur à un membre ».

Analyse :
- [Fait] q101 suppose qu'un auditeur **unique** est informé. Il y a donc au moins une information avant « > 1 membre ». Une lecture de q103 qui ouvre la consultation seulement à « > 1 membre » ne contredit pas q101 mot à mot (information par notification, consultation de la vue plus tard), mais elle produirait un auditeur prévenu qui ne peut pas ouvrir le journal de ce dont on le prévient. Une information qu'on ne peut pas vérifier n'est pas un contrôle détectif.
- [Fait] Le seuil « > 1 membre » de q103 coïncide avec la condition de fin de q101 (≥ 2 membres éligibles d'un des deux groupes). Les deux textes décrivent donc le même moment : la fin de l'amorçage.
- **Verdict : je confirme la lecture de l'orchestrateur, avec une nuance.**
  1. Information et consultation ouvertes dès le **premier** membre actif d'Audit ou du Comité. C'est la lecture qui n'affaiblit aucun contrôle : elle donne plus de visibilité à un tiers, jamais moins, et ne confère à l'auditeur aucun droit nouveau (le rôle Audit a déjà `audit.read`).
  2. « > 1 membre » est la condition de **fin** de l'amorçage, pas le début de la consultation.
  3. Quand les deux groupes sont vides, aucune notification (q103, voulu par le PO) ; les décisions sont journalisées dès la première et deviennent consultables à l'arrivée du premier membre, y compris pour ce qui s'est passé avant (c'est déjà le texte de DECISION-044 point 4 : « dès l'ajout de leurs membres »).
- **Nuance (à transmettre à A05/A06)** : « supérieur à un membre » doit se compter en membres **éligibles et actifs** (non suspendus, hors cumul interdit, hors personnes exclues par q72), pas en lignes de `user_roles`. Sinon un groupe de deux comptes dont un suspendu mettrait fin à l'amorçage alors que le circuit ne peut pas voter. Cette précision est ma rédaction (mémoire principe 37), pas une décision du PO.
- **Les deux réponses sont-elles inconciliables ? Non.** Elles se concilient dès que l'on sépare l'**ouverture** de la consultation (dès le premier membre) de la **fin** de l'amorçage (> 1 éligible). Seule une lecture littérale de q103 comme « pas de consultation avant 2 membres » les mettrait en tension avec l'esprit de q101. Dans ce cas, le changement est minime : restreindre l'accès à la vue, sans toucher la journalisation ni la notification.
- **Relève-t-il du PO ? Pas obligatoirement.** Je recommande de consigner la lecture comme interprétation validée par A13 dans le Decision Log. Si l'orchestrateur veut une couverture totale, une confirmation d'une ligne au PO suffit (« la consultation du journal d'amorçage est ouverte dès le premier membre d'Audit ou du Comité ; l'amorçage se termine à 2 membres éligibles »), mais elle ne doit pas bloquer B-6d.

### 6.4 Récapitulatif

| Point | Verdict | PO ? |
|---|---|---|
| F-D044-08 (a) q58 | Étendre à `isCommitteeRole`, deux sens, assignation et élargissement | Non (information Decision Log) |
| F-D044-08 (b) q65 | Étendre à `isCommitteeRole`, y compris à l'élargissement de rôle, anti-doublon par transition | Non |
| I-D7 | Lecture orchestrateur confirmée ; « > 1 » = fin de l'amorçage, compté en éligibles actifs | Non bloquant ; confirmation d'une ligne facultative |

Actions : A06 (q58, q65, éventuellement `assertReactivable`), A05 (formulation « éligibles actifs » dans B-6d). Aucun nouveau risque identifié ; le risque résiduel de F-D044-08 reste **faible** (CVSS A10 2,2) et passe à **très faible** après correctif.

---

## 7. I-D8 / I-D9 (2026-10-18)

**Statut** : positions A13. Le PO (N0) reste décideur final ; rien ci-dessous ne modifie q98 ni q83. Sources relues : spec B-6 §5.6 points 2, 6, 7 et §14.2 (I-D8, I-D9), DECISION-045 point 3, DECISION-044 (q81-q83), DECISION-046 (q101-q103), §1.2 de la présente revue.

### 7.1 I-D8 : q98 et les paramètres sans valeur par défaut au contrat

**Faits** : [Fait] q98 impose « uniquement les valeurs par défaut du contrat ». [Fait] Pour l'échelle, l'appétence, le seuil « faible », la durée de délégation et le seuil Comité de traitement, le contrat ne donne aucune valeur (« fixés à la création / par le client ») ; une contrainte par défaut est donc matériellement impossible, et le seuil « faible » est obligatoire sans défaut (B-6b). [Fait] Le premier Dispositif d'un RM seul n'est revu par personne tant qu'Audit et Comité sont vides (q103, accepté par le PO).

**Position** :
- Lecture A05 **fidèle** : q98 vise à empêcher qu'un RM seul choisisse une méthodologie plus laxiste que celle que le contrat a posée. Là où le contrat a posé une valeur, elle est imposée ; là où il n'en a pas posé, il n'y a pas de référence contre laquelle contraindre. Inventer un plafond (appétence maximale, seuil « faible » maximal) serait créer une règle de gouvernance que le PO n'a pas prise (mandat §5, principe 29 : le Dispositif est configurable par le client).
- **L'exposition est réelle mais bornée** : (i) un seuil « faible » élevé élargit l'exception de cumul RO + Exécuteur (R2) ; (ii) une appétence haute fait paraître acceptables des Résiduels qui ne le seraient pas ; (iii) l'ISO 31000 (6.3, appétence et critères de risque fixés par l'organisation, avec la réserve de sourcing du principe 16) et le COSO ERM (appétence arrêtée par la gouvernance, pas par l'opérateur) vont dans le sens d'une visibilité pour les instances, pas d'une valeur imposée. (iv) Bornes : c'est une activation unique par tenant (q102), et les évaluations figent leur version à la création (F-8) : les évaluations faites sous le Dispositif amorcé gardent ses valeurs jusqu'à leur clôture, même après une v2 [Hypothèse à vérifier par A06, cohérente avec F-8].
- Ce qui manque n'est donc pas une contrainte mais de la **visibilité** : l'information q101 (« l'auditeur est informé ») ne vaut contrôle que si le tiers voit ce qui a été fixé librement.

**Verdict : tranché par A13 (interprétation du contrat, sans changer q98). Acceptable, avec trois conditions de traçabilité, aucune bloquante.**
Règle à appliquer par A06 :
1. **Ne pas étendre `contractDefaultViolations`** aux cinq paramètres libres. Aucun plafond.
2. **Figer et exposer les valeurs libres** : `bootstrap_justification` (ou le payload d'audit de la décision BOOTSTRAP) enregistre la taille d'échelle, `appetite_thresholds`, `low_criticality_threshold`, `delegation_max_days` (NULL inclus) et `committee_treatment_min_score`. La route de consultation `change-requests?regime=BOOTSTRAP` et `RISK_FRAMEWORK_BOOTSTRAP_NOTICE` les affichent, pour que le premier membre d'Audit/Comité arrivé puisse les juger.
3. **Signaler sans bloquer** : l'avertissement R2 (seuil « faible » au-dessus de la borne haute de la bande de criticité la plus basse) est repris dans la notice et dans la vue BOOTSTRAP comme « valeur à examiner ». Aucun refus.
4. KRI (lot KRI, pas B-6d) : part des Dispositifs amorcés dont une valeur libre dépasse la référence R2 ; ancienneté de l'amorçage (déjà demandé).

**Risque résiduel** : faible à moyen tant que Audit et Comité sont vides (revue par personne, accepté par le PO via q103), faible dès qu'un tiers est arrivé et peut lire les valeurs ; correction ensuite par une v2 au circuit normal.
**Question PO** : aucune requise. Pour information au Decision Log : « I-D8 : q98 lu comme ne contraignant que les paramètres ayant une défaut au contrat ; valeurs libres tracées et affichées, sans plafond ». Si le PO veut un plafond (appétence ou seuil « faible »), c'est une décision nouvelle, pas une lecture de q98.

### 7.2 I-D9 : un RM administrateur se nomme « administrateur sollicité »

**Faits** : [Fait] L'exception q83 est acceptée par le PO parce que le RM n'a pas `user.create` (droit d'administrateur, q79) : il ne peut pas créer lui-même un second membre, donc il le fait demander. [Fait] Un RM qui cumule administrateur + RM (autorisé et marqué, q63) a `user.create`. [Fait] Le système ne peut pas vérifier l'impossibilité déclarée (I-D2 point 4).

**Position** :
- Si le RM se nomme lui-même dans `askedUserId`, la « demande à un tiers » devient une **déclaration de non-action sur soi-même** : une même personne demande, refuse (ou n'agit pas) et décide, sans qu'aucun tiers ne figure au dossier. C'est la définition de ce que la séparation des tâches (mandat §43) interdit : créer le besoin, attester son impossibilité et en tirer seul le bénéfice (s'auto-approuver).
- La prémisse de q83 (impossibilité faute de droit) **n'existe pas** pour l'administrateur : pour lui la lecture littérale (« créer d'abord un autre utilisateur du groupe risque ») est possible. Lui laisser la voie déclarative revient à étendre l'exception à un cas que le PO n'a pas visé, et en rend la justification invérifiable.
- Contre-argument de A05 : l'organisation qui n'a vraiment qu'une personne serait bloquée. Réponse : elle ne l'est pas, elle a deux sorties déjà existantes, sans règle nouvelle : (a) un autre administrateur du tenant (la demande est alors réelle et tracée) ; (b) la lecture littérale de q83, le RM administrateur crée le second membre du groupe risque (ce qui, dans ce cas seulement, met fin à l'amorçage, q101). Je reconnais le risque de compte de complaisance en (b) ; il n'est pas aggravé par cette règle (un administrateur peut déjà le faire aujourd'hui) et reste visible par le marquage q63 et la notification d'arrivée.
- Un blocage de l'amorçage pour un RM administrateur seul est **fail-closed, visible et sans contournement en base** : il vaut mieux qu'une auto-approbation sans tiers au dossier.

**Verdict : tranché par A13 (interprétation de q83 ; c'est un resserrement de la lecture A05, pas une décision PO). Oui, interdire.**
Règle à appliquer par A06 :
1. `justification.askedUserId` doit désigner un utilisateur du tenant, détenteur d'une permission d'administrateur (`ADMIN_PERMISSIONS`), **et différent du demandeur** (`askedUserId !== actor.userId`, comparé côté serveur, pas déduit du corps). Refus `ValidationError` avec un message qui nomme les deux sorties (autre administrateur, ou création d'un second membre du groupe risque).
2. Aucune autre modification de l'amorçage : un RM administrateur n'est pas exclu de l'amorçage, il doit seulement nommer un tiers. Le marquage administrateur + RM (q63) apparaît dans la notice BOOTSTRAP.
3. Test de niveau 1 : refus quand `askedUserId` = demandeur ; refus quand `askedUserId` n'est pas administrateur ; acceptation avec un autre administrateur.
4. Mettre à jour la ligne I-D9 de la spec §14.2 et §5.6 point 6 (supprimer « Il peut s'agir du demandeur lui-même »).

**Risque résiduel** : l'invérifiabilité de la demande reste (le tiers nommé n'atteste rien, I-D2 point 4) ; mais le dossier porte désormais deux personnes distinctes. Faible.
**Question PO** : aucune requise. Pour information au Decision Log, avec la conséquence : un tenant dont l'unique administrateur est aussi l'unique RM ne peut pas s'amorcer par déclaration ; il crée le second membre du groupe risque ou désigne un autre administrateur. Si le PO préfère maintenir la voie déclarative pour ce cas, c'est un assouplissement à lui seul d'acter.

### 7.3 Récapitulatif

| Point | Verdict | Règle pour A06 | PO ? |
|---|---|---|---|
| I-D8 | Acceptable, tranché A13 | Pas de plafond ; figer et afficher les 5 valeurs libres (justification, route BOOTSTRAP, notice) ; avertissement R2 non bloquant | Non (information) ; plafond = décision nouvelle du PO |
| I-D9 | Interdire, tranché A13 | `askedUserId` ≠ demandeur, côté serveur ; sorties nommées dans l'erreur | Non (information) ; assouplissement = PO |

---

## 8. F-B6d-02 (2026-10-18)

**Statut** : position A13, lecture du contrat et de q87/q100/DECISION-046 point 1. Le PO (N0) reste décideur final. Sources relues : `docs/security/review-B6d-2026-10-18.md` F-B6d-02, spec B-6 §5.3, §5.4, §5.4.1, DECISION-046, contrat §5 et §10 (circuit unique, q69), ma revue §2.

**Faits** : [Fait] q87 force `RISK_MANAGER` sur toute écriture de version, y compris la copie d'une source héritée (`createVersion`). [Fait] q100 replie une version ACTIVE héritée Comité/Audit vers un RM tiers, `FALLBACK`, ratification `PENDING`, cause `LEGACY_APPROVER_PRE_B12`. [Fait] La v2 approuvée en repli naît `RISK_MANAGER` : les demandes suivantes sont `NORMAL`, sans repli ni ratification, même après B-12. [Fait] La v1 reste en base (ARCHIVED, immuable) avec son `change_approver` d'origine, et l'audit de l'activation porte `bypassedGroups`. [Fait] Aucun retour arrière n'existe sur la ratification (C-B6d-05, B-12). [Hypothèse] La population est vide en production (requête n° 10, HUMAN, ouverte).

**Position (séparation des tâches).** Ce n'est pas conforme à l'intention, mais le défaut est dans la fin de vie, pas dans le comportement avant B-12.
- q87 répond à un seul problème : ne pas créer d'approbateur que personne ne peut exercer. Il ne dit pas que le Comité ou Audit cesse d'être approbateur. DECISION-046 point 1 dit « ne gèle pas… se replie… ratification ultérieure » : un contournement, pas une suppression. Il présuppose que l'approbateur choisi par le client reste l'approbateur de droit.
- Avant B-12, le tenant concerné se comporte comme tous les autres (RM seul, q87) : la perte n'ajoute aucune exposition pendant cette période. Le défaut est la fin : le choix de gouvernance du client (revue par un organe indépendant du RM) disparaît sans décision de personne et sans trace exploitable. C'est le « traitement silencieux en NORMAL » que j'avais rejeté (§2.2 point 4) : il réapparaît à la première activation.
- Option (a) du constat (conserver l'approbateur hérité sur la v2) : rejetée. Elle ouvre une exception dans le garde q87 décidé par le PO, ajoute du code à la zone sensible (création de version) pour une population probablement vide (ponytail), et fait dépendre un contrôle d'une copie plutôt que d'une décision. Option (c) seule (accepter) : insuffisante, car la ratification refusée ou ignorée n'aurait toujours aucun effet. La bonne cible est (b), à écrire avant d'oublier.
- Le rétablissement ne peut pas être automatique : une version ACTIVE est immuable, et rétablir Comité/Audit est un changement de gouvernance qui exige lui-même le circuit (et, pour l'approbateur, jamais le seul RM qui avait décidé en repli).

**Verdict : tranché A13, règle (interprétation du contrat, sans changer q87 ni q100).**
1. **A06 : rien à coder avant B-12** (ni exception q87, ni colonne, ni migration). Seul ajout facultatif, gratuit : écrire dans le payload d'audit de la décision de repli q100 la valeur complète de l'ancien `change_approver` (`legacyChangeApprover`), à côté de `bypassedGroups`. Non bloquant ; la v1 archivée reste la source de vérité.
2. **A05 : écrire dans la spec B-12** (lot suivant, avant son dispatch) : (i) à la livraison de B-12, pour chaque tenant dont une décision porte `fallback_cause = 'LEGACY_APPROVER_PRE_B12'`, lister l'approbateur d'origine (v1 archivée ou audit) et ouvrir une **demande de rétablissement** (changement de Dispositif ordinaire, résolue par le circuit, jamais décidée par le RM de la décision d'origine ni par son demandeur) ; (ii) ratification **refusée** => cette demande devient obligatoire et prioritaire ; ratification **acceptée** => le client confirme explicitement qu'il garde RISK_MANAGER, par une décision tracée (pas par défaut) ; (iii) tant que ni l'une ni l'autre n'est close, le tenant reste signalé « approbateur d'origine non rétabli » (vue décisions prises en l'absence, KRI d'ancienneté).
3. **Orchestrateur : tracer** un item ouvert (owner A05, échéance : spec B-12) et le lier à C-B6d-05 (même table de ratification). HUMAN : le résultat de la requête n° 10 conditionne la suite : **0 ligne** => point 1 (rien) et point 2 (une ligne de spec) suffisent, risque résiduel très faible ; **≥ 1 ligne** => point 2 devient bloquant pour la mise en production de B-12 sur ce tenant.
4. Régression côté A06 : aucune. Test d'acceptation B-12 (A05/A08) : v2 issue d'un repli q100 => B-12 produit la demande de rétablissement ; la ratification refusée la rend obligatoire.

**Risque résiduel** : très faible si la requête n° 10 renvoie 0 ligne ; faible (contrôle dégradé mais tracé, rétablissement prévu) sinon, tant que le point 2 n'est pas écrit ; moyen si le point 2 est oublié et que B-12 sort (contrôle choisi par le client perdu durablement).
**Question PO** : aucune requise (lecture du contrat, aucune décision PO modifiée). Pour information au Decision Log : « F-B6d-02 : la perte de l'approbateur d'origine après un repli q100 n'est pas voulue ; rétablissement ou confirmation explicite à traiter par B-12 ; rien à coder avant ». Si le PO veut au contraire que Comité/Audit ne reviennent jamais pour un tenant concerné, c'est une décision nouvelle à acter, avec confirmation du client.
