# CMP-governance-d6 — Revue Compliance A14 — Lot D6 « santé de la gouvernance »

Date : 2026-11-04 | Assessor : A14 (2e ligne) | Statut : PARTIALLY_COMPLIANT — CONDITIONAL

## 1. Périmètre, méthode, limites
- Sur résumé déclaré exact ; code non consulté (preuve niveau 2). Design Effectiveness seule ; Operating Effectiveness NOT_ASSESSED.
- Le texte de CMP-BLK-D5-01 / q172 n'est pas dans mon worktree ; je le lis tel que décrit (suivi des exceptions « sans seconde validation » pour les relecteurs).
- Applicabilité : la loi nationale de protection des données (formalité auprès de l'ARTCI, intérêt légitime) n'est pas vérifiée par moi ; je la signale sans conclure. BCEAO 017-12-2010 (piste d'audit au moins 10 ans, séparation des tâches) : version et applicabilité à confirmer.
- Trigger Matrix §64 : nouveau traitement de données (Compliance, Privacy, Risk, Audit = Oui) pour R3, R5, R6 ; Changement de rôle/gouvernance pour le panneau.

## 2. CMP-BLK-D5-01
LEVÉ pour le périmètre suivi : total, non revues, âge, retard et liste pour relecteurs répondent à la demande de visibilité (q168/q180). Réserves : (a) le suivi part de la « date de début de suivi » ; les exceptions antérieures sans seconde validation restent invisibles, ce que le panneau doit afficher explicitement (date de départ) ; (b) l'efficacité réelle (liste exploitée, relectures effectives) n'est pas prouvée.

## 3. Couverture des principes
- 16/19 évalués ; 3 non évaluables (COM-02, OWN-03 : données de fonctions absentes ; SOD-05 : croisement par dossier non construit) ; parties de RISK-01, ACC-01, OWN-01(d) non évaluables faute de seuils (q229).
- Suffisante pour une production en mode « assurance partielle », à deux conditions : chaque principe non évaluable ou partiel s'affiche NOT_ASSESSED / « non évaluable » (jamais vert, jamais exclu d'un total) ; aucun score global qui masque ces lacunes. Elle ne suffit pas pour prétendre à une couverture complète du catalogue A13.
- Le gap SOD-05 (séparation par dossier) est réel : le contrôle détectif GOV-SOD-01 « validateur = auteur sans marqueur » le compense partiellement mais est détectif, pas préventif ; échéance de construction à tracer.
- Statut ACCEPTED : valide si l'acceptation de principe (D5) est active, non expirée et couvre tous les objets de l'instantané. Tout nouvel objet apparu après l'instantané, ou acceptation expirée/révoquée, doit faire sortir le principe d'ACCEPTED. À prouver par test.
- Repli « Personne N » et comptages sans droit `audit.read` : conforme au moindre privilège.

## 4. R3 — Effacement de la date de dernière activité (5 ans après fin de compte)
Avis : principe conforme (minimisation, audit par compte). Réserves :
- CMP-D6-01 : sans planificateur, l'exécution dépend d'un appel manuel d'administration : risque de dépassement de rétention non détecté. Recommandation : déclenchement automatique (chaque nuit, q231, est approprié ; au minimum mensuel) ET trace de chaque exécution, même à zéro compte traité (acteur système, date, nombre). KRI : ancienneté de la dernière exécution.
- CMP-D6-02 : bornes 1–3650 jours : un plancher d'un jour permet une destruction quasi immédiate ; opération irréversible. Fixer un plancher raisonnable, changement journalisé avec motif et seconde validation (maker-checker), sans effet sur les effacements passés.
- CMP-D6-03 : confirmer que la donnée effacée n'appartient pas à la piste d'audit à conserver (10 ans si 017-12-2010 applicable) et que `audit_logs` n'est jamais modifié par la purge (append-only) ; l'entrée d'audit par compte ne doit pas recréer la donnée effacée.
- Dry-run / liste préalable recommandée avant la première exécution réelle ; validation HUMAN avant ce premier effacement irréversible.

## 5. R5 et R6
- CMP-D6-04 (bloquant) : texte « Vos données » en projet, DPO non validé, contact DPO non renseigné : l'obligation d'information ne peut être considérée satisfaite. Publication conditionnée à la validation DPO et au contact renseigné (q231).
- CMP-D6-05 (bloquant) : R6 intérêt légitime : exiger une analyse de proportionnalité documentée (finalité, nécessité, mise en balance, droit d'opposition). La formalité ARTCI n'est pas précisée : à faire vérifier par le DPO/PO avant production ; je ne la tranche pas. Revue Privacy A15 requise.

## 6. Constats complémentaires
- CMP-D6-06 (moyenne) : seuils q229 absents : RISK-01, ACC-01, OWN-01(d) restent partiels ; ne pas inventer de seuil par défaut.
- CMP-D6-07 (faible) : l'efficacité du panneau repose sur la qualité des données d'entrée (fonctions, marqueurs) ; prévoir un indicateur de fraîcheur des données par principe.

## 7. Conditions avant production
1. CMP-D6-04 et D6-05 : validation DPO du texte, contact renseigné, intérêt légitime documenté, position sur la formalité ARTCI consignée (revue A15).
2. Affichage explicite des non évaluables/partiels, sans score masquant ; date de début de suivi affichée (D5-01).
3. R3 : plancher du paramètre + maker-checker sur son changement (D6-02), confirmation périmètre audit (D6-03), plan de déclenchement régulier (D6-01) et validation HUMAN avant la première purge réelle.
4. Test prouvé : sortie d'ACCEPTED si nouvel objet ou acceptation expirée.
Non bloquants : D6-06 (réponse PO q229), D6-07, échéance SOD-05, COM-02, OWN-03.

## 8. Questions au PO (non tranchées)
q229 (seuils) ; q231 (déclenchement nocturne et contact DPO) ; plancher du paramètre de rétention ; formalité ARTCI ; échéance de construction de SOD-05.

Statut : PARTIALLY_COMPLIANT ; revalidation A14 requise sur preuves après conditions 1 à 4.
