# CMP-visibility-v4 — Revue Compliance A14 — Lot V4 « visibilité des ressources : cas administrateur »

Date : 2026-11-03 | Assessor : A14 (2e ligne) | Branche relue : feat/r1-visibility-v4
Statut : PARTIALLY_COMPLIANT — CONDITIONAL (conditions de production ci-dessous)

## 1. Périmètre, méthode, limites

- Exigences évaluées : DECISION-103 (q197 A3), DECISION-110 (q215), q174 (expiration), sur la base du résumé du développeur/orchestrateur déclaré exact.
- Preuves examinées : résumé de décision et de code seulement (niveau de preuve 2, Documentation). Le code de la branche feat/r1-visibility-v4 n'existe pas dans ce worktree : aucun test, aucune inspection du code, aucune reperformance (niveaux 3 à 5 non atteints).
- Le modèle CMP-visibility-v2 et la mémoire compliance.md étaient absents du worktree ; structure reprise des formats de l'agent (§73).
- Conclusion limitée à la conception décrite (Design Effectiveness) ; Operating Effectiveness : NOT_ASSESSED.
- Applicabilité : Instruction BCEAO 017-12-2010 (séparation des tâches incompatibles, piste d'audit conservée au moins 10 ans) citée comme référentiel prioritaire ; version en vigueur et applicabilité au SFD à vérifier avant toute conclusion réglementaire (règle §80). Aucun constat ci-dessous n'est qualifié REGULATORY_BREACH. ISO 27001 (contrôle d'accès, revue des droits d'accès) et COSO : benchmark/référentiel interne, non obligations.

## 2. Justification du passage (Trigger Matrix §64)

Ligne « Changement de rôle » : Compliance = Selon impact. Impact établi : création d'un droit d'accès privilégié aux contenus restreints (dont dossiers fraude/RH), avec dérogation à la séparation administrer/lire. Passage justifié. Lignes connexes : nouveau traitement de données (Privacy = Oui, voir CMP-V4-04 et 05).

## 3. Réponses aux questions

### 3.1 Séparation des tâches (administrer ≠ lire le métier)
Design : satisfaite pour le défaut (A1 : métadonnées seulement) et pour le circuit d'octroi (demandeur administrateur distinct du bénéficiaire ; confirmeur Comité/Audit non auteur, non bénéficiaire, non administrateur ; droit jamais porté par un rôle, donc pas d'héritage ni d'auto-attribution). Maker-checker conforme à la règle transverse du dépôt. Réserves : CMP-V4-03, V4-09. Effectiveness non vérifiée (aucun test vu).

### 3.2 Moindre privilège
Partiellement satisfait. Positif : refus par défaut, droit distinct, motif, expiration de la demande, révocation, fin automatique. Écarts : droit tout-ou-rien (tous contenus, y compris personnes nommées) sans périmètre ni durée maximale après confirmation (CMP-V4-02, V4-04).

### 3.3 Trace pour revue d'accès périodique
Suffisante pour reconstituer le cycle de vie de l'octroi (chaque étape au journal, même transaction). Insuffisante pour la revue d'accès : le résumé ne mentionne pas la journalisation des lectures effectuées sous ce droit (qui a lu quoi, quand). Sans elle, on ne peut pas prouver l'usage ni détecter l'abus (CMP-V4-05). Recertification périodique : OUI, recommandée (CMP-V4-02).

## 4. Constats

| ID | Sévérité | Constat | Action demandée |
|----|----------|---------|-----------------|
| CMP-V4-01 | Élevée (bloquant) | Point ouvert développeur : un rôle qui perd ses permissions d'administration (sans retrait du rôle au compte) laisse l'attribution « active » ; elle reprendrait effet si le compte redevenait administrateur. Contredit l'intention « fin automatique au retrait du dernier rôle d'administrateur » ; accès privilégié dormant. | Fin automatique aussi sur perte de la qualité effective d'administrateur (événement de retrait de permission d'un rôle), et/ou vérification de la qualité d'administrateur effective à chaque lecture (fail-closed). Journaliser la fin (acteur système, motif). Test de non-régression. |
| CMP-V4-02 | Moyenne | Aucune durée maximale ni recertification après confirmation (seule la demande non confirmée expire). Un droit permanent de lire tous les contenus contredit le moindre privilège. | Durée maximale à décider par PO ; à défaut, recertification au moins trimestrielle par Comité/Audit (non administrateur, non bénéficiaire) ; expiration automatique si non recertifié ; revue journalisée. |
| CMP-V4-03 | Moyenne | Indépendance : faire confirmer par l'Audit (3e ligne) rend l'Audit coresponsable d'une décision opérationnelle d'accès. Et collusion possible demandeur + confirmeur. | Question PO (§6). Journaliser et signaler tout couple demandeur/confirmeur récurrent (KRI). |
| CMP-V4-04 | Élevée | Une fois confirmé, lecture de tout, y compris dossiers « personnes nommées » (fraude, RH) : sensibilité maximale, aucun périmètre. Revue Privacy requise (§55). | Revue Privacy avant production ; envisager exclusion ou second niveau de confirmation pour les dossiers personnes nommées (décision PO). |
| CMP-V4-05 | Élevée (bloquant) | Pas de trace de lecture sous `resource.readall` mentionnée. | Journaliser chaque lecture de contenu restreint effectuée via ce droit (utilisateur, ressource, date, tenant_id) ; rétention alignée sur la durée de piste d'audit (10 ans si 017-12-2010 applicable) ; consultable par Audit. Revue Audit & Observability requise. |
| CMP-V4-06 | Moyenne | q215 : le motif visible du Comité/Audit (140 caractères en liste) repose sur une consigne en saisie ; le texte libre peut nommer la personne ou contenir une donnée sensible, et l'intégralité du motif est stockée. | Contrôle côté serveur impossible à garantir sur du texte libre : accepter le risque résiduel documenté, ou motifs par liste de catégories + texte limité ; jamais d'affichage du motif au bénéficiaire hors besoin. Avis Privacy. |
| CMP-V4-07 | Faible | Durée d'expiration de la demande (q174) non précisée dans le résumé ; événement d'expiration journalisé ? | Confirmer valeur configurée, acteur système, entrée d'audit même transaction. |
| CMP-V4-08 | Moyenne | Pas de circuit si aucun confirmeur éligible (Comité/Audit tous administrateurs, conflictés ou absents) ni procédure d'urgence. Risque de contournement hors système. | Question PO ; en attendant, aucune voie de contournement technique ne doit être ajoutée. |
| CMP-V4-09 | Faible | Tableau de bord GRC : badge dans la matrice des droits présent ; absence de vue/rapport des droits actifs, en attente, expirés, révoqués. | Vue ou export pour la revue périodique ; KRI : nombre de droits actifs, ancienneté, % recertifiés, lectures par droit. |

## 5. Conditions avant mise en production

BLOCK (release conditions) :
1. CMP-V4-01 corrigé et testé : fin automatique ou neutralisation immédiate sur perte effective de la qualité d'administrateur (retrait de permissions du rôle compris). Preuve : test automatisé + revalidation A14.
2. CMP-V4-05 : journalisation des lectures sous `resource.readall`, avec preuve d'exécution (test + échantillon d'entrées). Revue A23 (Audit & Observability).
3. Revue Privacy (A15) sur CMP-V4-04 et CMP-V4-06 réalisée et consignée.
4. Décision PO explicite sur CMP-V4-02 (durée max / recertification) tracée comme item ACTION_ITEMS owner HUMAN (règle 7bis du CLAUDE.md).

Recommandé sans blocage : CMP-V4-07, V4-08, V4-09 ; revue Security (A10) du chemin d'octroi (maker-checker, tenant_id, non-usage d'un champ d'attribution client) ; revue Risk (A13) du risque résiduel (cotation hors périmètre A14).
Revalidation A14 requise après correction : oui (REVALIDATION_REQUIRED).

## 6. Questions au PO (non tranchées)

1. Le droit confirmé doit-il avoir une durée maximale renouvelable, ou une recertification périodique (quelle périodicité) ?
2. Les dossiers « personnes nommées » restent-ils lisibles dès la confirmation, ou exigent-ils une confirmation distincte ou une exclusion ?
3. L'Audit (3e ligne) doit-il confirmer les octrois, ou ce rôle revient-il au Comité seul ?
4. Que se passe-t-il s'il n'existe aucun confirmeur éligible, et existe-t-il un besoin d'accès d'urgence ?

## 8. Revalidation (2026-11-03, après DECISION-111)

Mode : résumé déclaré exact, code non consulté (preuve niveau 2) ; la levée porte sur la conception décrite, l'exécution reste à prouver par les tests annoncés.

| Condition / constat | Résultat | Motif |
|---|---|---|
| Cond. 1 / V4-01 | LEVÉE | Perte du dernier droit d'administration = fin définitive, test de régression annoncé. Vérifier que le test couvre aussi le retrait de permissions d'un rôle. |
| Cond. 2 / V4-05 | LEVÉE SOUS RÉSERVE | Audit READ par ressource et par liste, écrit avant la réponse, échec = refus (fail-closed) : conforme. Réserve : lectures d'éléments enfants (exécutions, preuves, mesures) non journalisées. |
| Cond. 4 / V4-02 | LEVÉE | 90 jours fixés à la confirmation, puis nouvelle demande et confirmation : équivaut à une recertification. |
| V4-04 | FERMÉ SOUS RÉSERVE | Exclusion des dossiers « personnes nommées » (q219) ; dépend de l'exactitude de leur qualification. |
| V4-08 | PARTIELLEMENT FERMÉ | Révocation par Comité/Audit (q222) et absence d'accès d'urgence assumée ; le cas « aucun confirmeur éligible » reste un refus, sans risque de contournement. |
| V4-03, 06, 07, 09 | OUVERTS | Inchangés (non traités par DECISION-111). |
| Cond. 3 (Privacy A15) | RESTE OUVERTE | Non mentionnée comme réalisée. |

Limites connues :
- Tableaux de bord (agrégats) : acceptable, pas de contenu restreint exposé, sous réserve qu'aucun agrégat ne permette d'identifier un dossier restreint.
- Lecture d'une ressource qui journalise aussi une lecture lors d'une modification de risque : acceptable (sur-journalisation, pas de perte de trace).
- Éléments enfants non journalisés : NON acceptable de façon permanente, car les preuves peuvent porter le contenu le plus sensible. Acceptable pour la production uniquement si (a) l'équipe démontre que `resource.readall` n'ouvre pas ces éléments au-delà de ce que voit l'administrateur sans le droit, ou (b) une action tracée avec échéance (CMP-V4-10) ajoute leur journalisation.

Reste avant production : (i) Privacy A15 consignée ; (ii) décision sur CMP-V4-10 (a ou b) ; (iii) paramètre de gouvernance des 90 jours : bornes min/max, modification réservée et journalisée (qui, avant/après, motif), sans effet rétroactif sur les droits déjà confirmés ; (iv) preuve d'exécution des tests (régression V4-01, échec d'audit = lecture refusée). Aucun COMPLIANCE_BLOCK tant que (i) à (iv) ne sont pas contredits. Revalidation finale A14 sur preuves après ces points.

## 7. Statut

PARTIALLY_COMPLIANT, EVIDENCE_REQUIRED sur l'exécution ; Operating Effectiveness NOT_ASSESSED ; pas de COMPLIANCE_BLOCK émis tant que le lot n'est pas déclaré prêt pour la production — les conditions 1 à 4 deviennent un COMPLIANCE_BLOCK si la mise en production est demandée sans elles.
