# A13 — SEC-B6C-02 : comparaison score / seuil d'appétence (lot B-6c)

Date : 2026-11-08. Statut : position A13. Pas de décision PO requise (voir 3).

## 1. Le constat est fondé (lecture du code, sans exécution)

- Fait, `DashboardService.getAppetiteVsResidual` (l.705-730) : le seuil vient de `resolveApplicableVersion(processId)`, soit la version applicable aujourd'hui au processus. Le groupe est clé sur cette version. `s.score` (score de la dernière évaluation, calculé sur l'échelle de la version de CETTE évaluation) y est comparé (l.750, l.757). L'instantané de l'évaluation (`riskFrameworkVersionId`, seuils copiés) n'est pas lu. Après un rattachement F1 (5×5) vers F2 (6×6, seuil 30), un 20/25 est comparé à 30 : le dépassement disparaît (sous-déclaration). Le sens inverse (6×6 vers 5×5) sur-déclare.
- Fait, Risk 360 (`RiskDeviceViewService.currentFromFramework`, l.148-180) : même résolution, mais le résultat ne sert qu'à `appetite.currentThreshold`. Les champs `appliedThreshold`, `suggestedThreshold` et `exceeded` viennent de l'instantané de l'évaluation (l.246-251). Donc Risk 360 ne fait pas disparaître le dépassement ; le défaut est un seuil « actuel » affiché sans indiquer son échelle, qui induit en erreur un lecteur ou le frontend qui le comparerait au score. Gravité moindre que le tableau de bord.
- Hypothèse : l'alerte du tableau de bord (l.436) ne compare pas de seuil (message sur `residualScore` seul) ; à confirmer par A06 pendant le correctif.
- Appréciation : sous-évaluation silencieuse d'un dépassement d'appétence sur la vue exécutive, déclenchée par un acte courant (rattachement). Cotation du risque métier : LOW en probabilité (il faut deux Dispositifs d'échelles différentes et un rattachement), mais impact sur un contrôle exécutif (le dépassement est précisément ce que la vue doit montrer). Je recommande de le traiter AVANT production B-6c, comme demandé par Security.

## 2. Règle correcte : seuil de la version de l'évaluation (instantané), jamais de normalisation

- Un score et un seuil ne se comparent que sur la même échelle. L'instantané F-8 (spec §8.1, invariant 9) fige la version, l'échelle et les seuils à la création de l'évaluation. La spec §8.1 l.439 prend déjà `version.appetiteThresholds` DE L'ÉVALUATION pour l'appétence suggérée ; §11.1 / l.514 dit que les évaluations existantes gardent leur version et ne sont ni recalculées ni réaffectées. DECISION-044 / I-C1 retire le plafond parce qu'aucune garde ne lit « l'échelle la plus récente » : cela suppose que chaque seuil n'est appliqué qu'aux évaluations de sa propre version.
- La phrase spec §7 / l.458 (« le seuil applicable vient de la version applicable au risque ») vaut pour la cotation d'une NOUVELLE évaluation, et pour Risk 360 en l'absence d'évaluation. Elle ne doit pas être lue pour comparer un score déjà calculé.
- Normalisation écartée : 20/25 = 80 % et 30/36 = 83 % ne sont pas équivalents (les bandes de criticité ne sont pas linéaires, les descriptifs des niveaux diffèrent par Dispositif, DECISION-016). Ce serait inventer une méthode de cotation, ce que le mandat interdit (§5).
- Règle à coder :
  1. Dashboard : grouper et comparer par `evaluation.riskFrameworkVersionId`, avec le seuil lu dans `version.appetiteThresholds` de CETTE version (`findAppetite`), ou mieux les seuils copiés. Chaque ligne reste étiquetée par sa version (le champ `frameworkVersionId` existe déjà).
  2. Évaluation sans version (antérieure au Dispositif, NULL) : chemin historique existant, marquée « antérieure au Dispositif », jamais rattachée.
  3. Version de l'évaluation sans entrée d'appétence pour la sous-catégorie : seuil `null`, ligne « non évaluable », jamais « respecté ».
  4. Quand la version de l'évaluation diffère de la version applicable : ajouter l'indicateur « réévaluation requise : Dispositif modifié » (information, jamais un blocage, principe 9). Ne pas masquer l'écart d'échelle.
  5. Risk 360 : `currentThreshold` porte la version et la taille d'échelle de sa source ; ne jamais le présenter comme comparable à un score d'une autre échelle. `exceeded` reste celui de l'instantané.
- Test de régression (celui proposé par Security) : évaluation 20 sur 5×5, processus rattaché à F2 6×6 seuil 30 : dépassement toujours signalé contre le seuil de F1, ligne marquée « réévaluation requise ».

## 3. Règle déjà décidée : correctif technique, pas de question cockpit

Les principes (instantané, historique non réécrit, pas de recalcul) sont décidés (F-8, invariant 9, B-6c q89/q90, DECISION-044). Le correctif ne fait que les appliquer à deux vues. À router vers A06 (A05 informé : la phrase spec §7 l.458 et §9 l.458 à préciser). Une seule micro-décision de présentation reste (point 4 de la règle : libellé du signal « réévaluation requise ») : rédaction A04/A06, pas une décision PO. Question PO seulement si l'on voulait imposer une réévaluation après rattachement : je ne la recommande pas (effet de bord lourd, contredit « aucune réaffectation » de l'actuel q89).

## 4. I-C2 : une campagne de revue mêle des Dispositifs

Avis : limite acceptable en B-6c, à condition de ne pas l'aggraver. Je maintiens ma position (revue DECISION-044 §I-C2) et la précise après ce constat :
- Pas de gel du Dispositif par campagne (cela créerait un second mode de rattachement et contredirait q89).
- Mais la vue de campagne et toute agrégation de campagne (scores moyens, maximum, nombre de dépassements) ne doivent JAMAIS combiner des scores d'échelles différentes : même règle que le point 2 (regrouper par version de l'évaluation, ou afficher la version par ligne et ne pas agréger entre versions). C'est le même défaut que SEC-B6C-02 transposé aux campagnes.
- À acter quand le lien évaluation / campagne sera créé (aujourd'hui inexistant, donc aucune exposition actuelle) ; l'ajouter comme prérequis de ce lot. KRI suggéré : nombre de processus rattachés à un autre Dispositif en cours de campagne.

Positions non arbitrées par le PO ; aucune décision nouvelle demandée.
