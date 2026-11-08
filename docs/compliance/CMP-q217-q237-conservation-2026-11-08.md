# CMP : conservation du journal, des motifs et de l'identité (q217, q237, q245)

Date : 2026-11-08. Auteur : A14 (Compliance). Statut : réponse à la question de fait q245 de l'architecte. Aucun code, rien de commité.
Périmètre : lecture du dépôt uniquement (preuve niveau 2). Aucune source externe consultée.

## 1. Réponse à la question de fait

### 1.1 DECISION-038 n° 8 vise-t-elle le journal d'audit ?

**Le dépôt ne le dit pas.** Texte exact (`ACTION_ITEMS.md`, DECISION-038, point 8) : « Conservation 10 ans confirmée ; la durée doit rester CONFIGURABLE dans l'interface d'administration de l'application. »

Éléments de lecture :
- Le point 8 ne nomme aucun objet (ni évidences, ni journal).
- La seule mention de « 10 ans » dans le même fil est EVD §33 n° 5 (`ACTION_ITEMS.md`, vers la ligne 792) : « conservation 10 ans ; après une période cible de 1 an, archivage possible avec accès conservé ». Cela vise les **évidences**. La proximité (même lot de validations) rend la lecture « évidences » probable, sans la prouver.
- Rien dans DECISION-038 ne mentionne `audit_log`. Le journal n'a pas de durée décidée : ACT-072 option C (aucune purge, masquage à l'affichage) est la décision en vigueur.

Conclusion limitée aux textes lus : « la conservation 10 ans de DECISION-038 n° 8 vise très probablement les évidences ; elle ne fixe pas la durée du journal ». À trancher par le PO (voir section 4).

### 1.2 Existe-t-il un plancher réglementaire applicable au journal et aux motifs ?

Ce que le dépôt établit déjà :
- Prompt A14, §13 (`.claude/agents/compliance.md`, ligne 506) : pour les SFD concernés par l'Instruction BCEAO n° 017-12-2010, les éléments constitutifs de la **piste d'audit** sont prévus pour être conservés au moins dix ans. ACT-072 en tire un plancher de 10 ans.
- `docs/security/compliance-DECISION-040.md` ligne 21 et `docs/compliance/B6a-compliance-review.md` ligne 108 reprennent « 10 ans pour la piste d'audit » avec la mention « à confirmer par un juriste ».

Ce qui n'est **pas** établi :
1. **Applicabilité.** L'Instruction 017-12-2010 vise les SFD (microfinance). Rien dans le dépôt ne démontre que Djamo relève du régime SFD plutôt que de celui d'un établissement de monnaie électronique ou de paiement. Reprendre ce plancher pour Djamo sans cette démonstration serait du framework shopping. Statut : **à confirmer par le juriste** (régime d'agrément de Djamo, texte applicable).
2. **Objet visé.** Dans l'Instruction, la piste d'audit désigne la chaîne transaction, chronologie, pièce d'origine, traitement, comptabilité (compliance.md §13). Un journal d'accès et de changements de visibilité d'un **outil GRC interne** n'est pas une transaction financière. Qu'il tombe dans la « piste d'audit » réglementaire est une interprétation non confirmée. Statut : **à confirmer par le juriste ou le DPO**.
3. **Plancher propre aux EME ou établissements de paiement, et obligations LBC/FT de conservation.** Je n'en cite aucun faute de texte vérifié dans le dépôt. Statut : **à confirmer par le juriste**. Ces obligations, si elles existent, portent a priori sur les données clients et transactions du produit Djamo, pas sur l'outil GRC.
4. **Droit des données personnelles.** Le dépôt retient la loi ivoirienne n° 2013-450 sous supervision ARTCI (`ACT-072-cadrage-propose.md`, section 1, d'après privacy.md) ; proportionnalité de la durée non vérifiée (R6 de CMP-governance-d6, toujours ouvert). Statut : **DPO**.

Résumé : plancher de 10 ans = **hypothèse de travail du dépôt, applicabilité et périmètre non confirmés**. Pour les motifs et le nom, aucun plancher spécifique n'est établi.

## 2. Risque de conflit

| Décision | Conflit avec un plancher de 10 ans s'il s'applique au journal | Gravité |
|---|---|---|
| q217 (motif conservé 1 an, option A de l'architecte) | Oui, **si** le motif fait partie des « éléments constitutifs » de la piste. Le texte du motif serait effacé à 1 an ; la ligne d'audit (qui, quand, quoi, avant, après, référence) reste. Un contrôleur pourrait y voir une justification perdue. | Moyenne : dépend de l'objet visé (point 1.2.2) |
| q237 (pseudonymisation du nom et de l'e-mail après D) | Oui, si D < plancher **et** si l'identité de l'auteur est exigée pour reconstituer la piste. La pseudonymisation est irréversible (pas de table de correspondance conservée) : « qui » devient non reconstituable. | Moyenne à forte si D < 10 ans |
| q237 option B (sans limite) | Pas de conflit avec le plancher. Conflit potentiel avec la proportionnalité de la loi 2013-450 (DPO). | Faible côté plancher |
| q217 si le motif est hors piste réglementaire | Aucun conflit. | Aucune |

Points de vigilance indépendants du plancher :
- La pseudonymisation de l'identité (option A de q237) ne doit pas toucher `audit_log.user_id` : le pseudonyme doit rester **stable** pour que la piste garde sa valeur de preuve (cohérent avec le cadrage, section 3).
- Le test de conflit n'a de sens que si D et la durée du journal sont fixées ensemble. Le texte R5 actuel (« aucune durée fixée ») ne contredit rien tant qu'aucune purge n'est lancée ; la mécanique à `NULL` par défaut de l'architecte est fail-closed et acceptable en l'état.
- Cohérence interne : q237 A dit « alignée sur le journal d'audit ». Tant que le journal n'a pas de durée, cette règle signifie « sans limite » ; une durée D plus courte qu'une durée de journal future rompt l'alignement.

## 3. Décidé par le dépôt, et reste à confirmer

Décidé :
- Journal d'audit en ajout seul, sans purge (ACT-072 option C ; CLAUDE.md).
- Motifs de visibilité : 1 an, configurable (DECISION-110, q217).
- Nom et rôles alignés sur le journal, durée à fixer avec le DPO (DECISION-116, q237 A).
- EVD : 10 ans, archivage possible après 1 an, durée configurable (EVD §33 n° 5, DECISION-038 n° 8 au mieux).
- Plancher 10 ans pour la piste d'audit SFD : repris dans compliance.md §13, **non vérifié pour Djamo**.

À confirmer :
- Régime réglementaire de Djamo (SFD, EME, établissement de paiement, autre) : juriste.
- Le journal d'accès GRC entre-t-il dans la piste d'audit réglementaire, et si oui, le motif en fait-il partie : juriste.
- Plancher spécifique à l'activité de Djamo et obligations LBC/FT de conservation : juriste.
- Proportionnalité de D et durée du journal vis-à-vis de la loi 2013-450 / ARTCI : DPO.

## 4. Question PO recommandée

Une seule question est nécessaire, en remplacement de q245 telle que formulée par l'architecte (elle demandait aussi « le plancher éventuel à confirmer par A14 » : A14 ne peut pas le confirmer, c'est un point juriste).

**Titre : Quelle durée de conservation pour le journal d'audit de l'outil, et à quel texte la rattache-t-on ?**

Contexte : DECISION-038 n° 8 (« 10 ans, configurable ») ne dit pas si elle vise les évidences ou le journal. De cette réponse dépendent q217 (motif 1 an) et q237 (durée D du nom).

Options :
- **A (reco) : 10 ans pour le journal, plancher de la durée configurable, y compris le motif et l'identité du pseudonyme.** Le journal reste sans purge d'ici là (statu quo ACT-072 C). Les motifs hors du journal (option A de l'architecte) sont conservés 1 an en conformité avec q217 ; la ligne d'audit garde la preuve qu'un motif a existé. Réserve : le juriste confirme que le texte du motif n'est pas un élément de la piste. Pour l'identité, D n'est fixée qu'avec le DPO et au plus tôt après 10 ans si l'identité de l'auteur est exigée.
- B : 10 ans pour les évidences seulement ; durée du journal fixée plus tard avec le juriste. Aucun blocage immédiat, mais q237 reste suspendue (« aligné sur le journal » n'a pas de valeur).
- C : sans limite pour le journal (statu quo), jusqu'à avis juridique.

Reco : **A** pour la durée, avec la confirmation juriste en prérequis de toute purge. Dans tous les cas, **aucune purge de motif ou d'identité ne se lance avant l'avis du juriste et du DPO** ; la mécanique à `NULL` par défaut peut être construite.

Pas de question supplémentaire à créer pour le plancher : il devient un item juriste/DPO (owner HUMAN), à tracer par l'orchestrateur dans `ACTION_ITEMS.md`.

## 5. Limites

- Aucun texte réglementaire lu à la source ; seules les références déjà présentes dans le dépôt sont reprises.
- Je n'ai pas lu le contenu de `SHARED_LOG.md` autour de DECISION-038 (aucune occurrence du mot dans ce fichier).
- Conclusion limitée au périmètre : q217, q237, q245 ; ne vaut pas avis juridique.
