# CMP-F4 — Passage Compliance (A14) du lot F4

Branche `feat/f4-profil-designations-comptes`. Statut : recommandation, en attente d'arbitrage HUMAN sur les points marqués Q. Limites : Bash indisponible, donc `git diff origin/staging...HEAD` non exécuté (fichiers lus dans l'arbre courant, périmètre = ceux nommés dans la demande) ; tests non lus ni exécutés ; aucun texte BCEAO consulté.

## Verdict : ROUGE conditionnel (1 écart bloquant la livraison de l'écran Comptes, le reste réservé)

Aucun COMPLIANCE_BLOCK sur q166 ni sur `/users/directory`. Un écart fonctionnel de conformité sur UsersAdmin (CMP-F4-01).

## 1. q166 (DECISION-080) — `ProcessService.setResponsibilities`

| Exigence DECISION-080 | Constat | Preuve |
| --- | --- | --- |
| Champion seulement | Conforme : propriétaire et N-1 restent refusés pour soi (I-R1 intacte) | ProcessService.ts:240 |
| Structure à une personne | Conforme : double confirmation acceptée seulement si politique tenant `DOUBLE_CONFIRMATION` ET personne d'autre ne détient `process.responsibility.assign` (hors acteur et auteurs) ; défaut `REFUSE` ; sans porte câblée, refus (fail closed) | ProcessService.ts:243-252 ; SelfValidationGate.ts:46-68 ; server.ts:251-260 |
| Double confirmation | Conforme : 1er appel 409 `GOVERNANCE_CONFIRMATION_REQUIRED`, renvoi avec `governanceConfirmation` | SelfValidationGate.ts:61-67 ; processes.routes.ts:35-42,87-94 |
| Motif | Conforme : `isAcceptableReason` côté serveur, motif dans `audit.reason` et `newValue.selfValidation.reason` | selfValidation.ts:33,47 ; ProcessService.ts:282 |
| Marqueur « sans validation indépendante » tracé | Conforme dans l'audit : `governance_exception = noSelfValidation` + `otherValidatorExists:false` | ProcessService.ts:284 ; SelfValidationGate.ts:70-71 |

Réserves (non bloquantes, hors décision) :
- CMP-F4-02 : la trace d'audit est écrite après l'écriture du processus, hors transaction (`this.audit.record` après `processes.setResponsibilities`). Même classe que CMP-PNL-01 (principe 23). Acceptable en staging ; condition de production si `DOUBLE_CONFIRMATION` est activé (ProcessService.ts:266-285).
- CMP-F4-03 : le marqueur n'est pas relu à l'affichage. Ni `processes.routes.ts` ni `ProcessResponsibilitiesCard.tsx` n'exposent l'indépendance de la désignation (q142, `GovernanceExceptionLookup`). Le champion auto-désigné s'affiche comme un champion ordinaire. Q HUMAN : l'affichage du marqueur sur la fiche processus est-il voulu en F4 ?
- CMP-F4-04 : la politique de revue par un tiers (D5, liste des exceptions à revoir) est le contrôle détectif compensatoire ; reste conditionnée à CMP-BLK-D5-01 (D6) avant activation en production.

## 2. Écrans

- OrganizationProfilePage.tsx : conforme. Taille, classification, écarts, régime « seul » viennent du serveur ; motif obligatoire à la soumission (l. 177,193) et au rejet (l. 206,211) ; libellés « Version NON appliquée » et « Appliquée seul » fidèles à DECISION-078 (q157). Réserve mineure : « sur 4 » écrit en dur (l. 116) ; constante affichée, à tirer de la réponse serveur ou à confirmer (CMP-F4-05, faible).
- DesignationsPage.tsx : conforme. Motif obligatoire à la désignation et à la fin (l. 95,105) ; libellé « rien n'est retiré automatiquement à cette date » fidèle à q161 (DECISION-078) ; aucune règle recalculée (pas d'auto-désignation côté front, l. 65 renvoie au serveur).
- ProcessResponsibilitiesCard.tsx : conforme sur la double confirmation (dialogue ouvert uniquement sur le 409, libellé « Appliquer sans validation indépendante », motif obligatoire, GovernanceConfirm.tsx:40-62). Propositions de rapprochement jamais appliquées sans clic par compte (DECISION-075). Réserve : `isForbidden` avale l'erreur sans message (l. 52) ; si un 403 (auto-désignation refusée) n'est pas affiché ailleurs, l'utilisateur ne voit rien (CMP-F4-06, à vérifier sur `describeError`/gestionnaire global). Les noms s'affichent « Compte non listé » pour qui n'a pas le droit d'annuaire (ProcessesPage.tsx:92 ne charge qu'avec `canAssign`) : pas de donnée inventée, mais lecture dégradée.
- UsersAdmin.tsx :
  - CMP-F4-01 (écart) : la création d'un compte avec un rôle de groupe fixe exige un motif côté serveur (q44, UserService.ts:41,118 ; RoleService `groupReason`), l'écran n'a aucun champ motif (UsersAdmin.tsx:119-128, `usersApi.create` sans `reason`, users.ts:23-29 le permet). Le groupe fixe est proposé dans la liste de rôles (l. 125) : l'attribution d'un rôle de gouvernance sans motif est soit impossible, soit contournée. Action : champ motif obligatoire quand le rôle choisi est un groupe fixe ; le front ne décide pas lequel, il se fie au drapeau renvoyé par le serveur.
  - CMP-F4-07 : le texte l. 132 (« refuse tant qu'un successeur n'est pas en place (voir Désignations) ») est trompeur. DECISION-078 (D2c) : la suspension du dernier Risk Manager reste refusée, la passation à l'intérimaire ne couvre que le retrait de rôle (non suspension). Corriger le libellé.
  - Q HUMAN : suspension, réactivation, modification de nom n'ont ni motif ni exigence décidés (audit `reason: null`, UserService.ts:236,273,313). Aucune décision DECISION-074 à 080 ne l'impose ; principe 11 (désignations sensibles) pousse à un motif sur la suspension d'un compte à droits. À arbitrer, non constaté comme manquement.
  - Q HUMAN : changement de `displayName` modifie le rapprochement par nom du propriétaire historique (ProcessService.ts:290-296) : acceptable car jamais appliqué sans confirmation.

## 3. `GET /users/directory` — minimisation

Conforme : id + nom d'affichage seulement (pas d'e-mail ni de rôles), comptes actifs, tenant-scopé par `actor.tenantId`, permission = l'une de `user.read`, `process.responsibility.assign`, `designation.manage` (UserService.ts:44-45,174-183), borné à 500 (:46).
Réserves : CMP-F4-08 troncature silencieuse à 500 sans indication (l'écran ne le dit pas, alors qu'UsersAdmin signale ses 100) ; pas d'audit de consultation (non décidé, annuaire interne, Privacy à confirmer). Q HUMAN / Privacy (A15) : confirmer que l'exposition du nom à tout détenteur de `process.responsibility.assign` est acceptée (finalité : choisir un compte). Je ne tranche pas l'analyse données personnelles.

## 4. Questions pour HUMAN
1. Motif sur suspension/réactivation de compte : requis ou non ?
2. Affichage du marqueur q166 sur la fiche processus en F4 ou lot ultérieur ?
3. Politique de revue des exceptions : condition de production inchangée (D6 avant activation).
4. Privacy : avis A15 sur l'annuaire (finalité, plafond 500).

## 5. Revalidation
CMP-F4-01 et CMP-F4-07 corrigés + preuve (capture ou test d'écran) → revalidation Compliance. CMP-F4-02/03/06 : suivi, non bloquants pour staging.
