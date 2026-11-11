# A13 : valeurs de départ des Dispositifs par défaut Prudent, Standard, Léger (lot B-13)

- Auteur : A13 (Risk Manager), 2026-11-11
- Origine : `docs/ROADMAP-V1.md` ligne R1.5 / B-13. Lot de contenu, rien à coder ici.
- Statut : **PROPOSITION, à valider par le PO.** Aucun code, aucune migration modifiés.
- Sources lues : `docs/architecture/RM-V1-B6-Dispositif-spec.md` (§2.2, §2.3, §3, §5.6), migrations 018, 050, 055, 059, `backend/src/domain/entities/RatingScale.ts`, `backend/src/domain/ratingScaleRules.ts`, `docs/architecture/RM-V1-Contrat-etape2-PROJET.md` (§6 règles A/B/C, §7.2), `docs/risk/A13-seuils-panel-D6-2026-11-04.md`.
- Réserve de sourcing : je n'ai ni ISO 31000 ni COSO ERM complet sous les yeux. Les rapprochements ci-dessous sont paraphrasés et **à vérifier** avant toute citation. Aucune exigence réglementaire BCEAO, CENTIF ou autre n'est chiffrée ici : le contexte fintech UEMOA (LBC-FT, continuité du service de paiement, fonds clients) guide le choix des axes d'impact, pas des seuils numériques.

## 1. Fait, hypothèse, avis

- Fait : un Dispositif porte une identité (`name`, `description`, `is_default`) et, par version, 8 paramètres posés par 055 et 8 paramètres posés par 059, plus l'échelle référencée (`rating_scale_id`).
- Fait : l'échelle porte la taille n (3 à 6, carrée), les descriptifs de probabilité et d'impact, les axes d'impact (7 au plus) avec descriptif par niveau, les bandes de criticité, la vitesse, la persistance et l'échelle de maîtrise.
- Fait : pour activer une échelle, chaque niveau de la probabilité, de l'impact et de chaque axe doit avoir un descriptif non vide (`assertReadyToActivate`).
- Fait : avant B-12, `change_approver` ne peut valoir que `RISK_MANAGER` ; `self_proposal_allowed` ne peut pas valoir `true` ; `committee_vote_rule = CUSTOM` est refusé.
- Fait (spec §5.6 point 2, q98) : le **premier** Dispositif activé par amorçage doit porter exactement les valeurs par défaut du contrat, sinon la décision est refusée. Les valeurs contrôlées sont : mode CLASSIQUE, seuil Comité `floor(n²×15/25)`, obligation Comité vraie, approbateur `RISK_MANAGER`, auto-proposition fausse, deux cumuls vrais, Hybride faux, maîtrise `RISK_TEAM`, règle de vote `DEFAULT`.
- Hypothèse : `committee_treatment_min_score = NULL` signifie « fail-closed » comme écrit dans la spec. Je n'ai pas vérifié ce que cela produit à l'exécution (à confirmer par A06).
- Avis : toutes les valeurs ci-dessous. Ce sont des valeurs de départ, réglables par le client par une nouvelle version, jamais des normes.

## 2. Principe de construction

1. Les trois Dispositifs diffèrent par la finesse de l'échelle, la sévérité des seuils et la rigueur de la gouvernance. Ils ne diffèrent jamais par les invariants (séparation des tâches, traçabilité, jamais de validation tacite). Ces invariants ne sont pas des colonnes.
2. Le Comité est déclenché à partir du début de la bande « Critique » de chaque échelle. Un seul repère, lisible : bande, seuil Comité et seuil d'appétence « fort » s'alignent.
3. Standard égale les défauts du contrat. Léger s'en écarte uniquement par la taille de l'échelle (et reste compatible amorçage). Prudent est plus strict : il ne peut pas être le tout premier Dispositif d'un client à un seul Risk Manager (voir section 7).
4. COSO ERM : l'appétence et la tolérance sont définies avec la stratégie, puis déclinées en limites mesurables. ISO 31000 : les critères de risque sont définis avant l'évaluation, proportionnés à l'organisation, et révisés. D'où trois profils proportionnés plutôt qu'un seul modèle. (Références paraphrasées, à vérifier.)

## 3. Identité du Dispositif

| Champ | Prudent | Standard | Léger |
|---|---|---|---|
| `name` | Prudent | Standard | Léger |
| `description` | Échelle fine 6×6, 7 axes d'impact, double validation de rigueur élevée. Pour structure régulée, en croissance ou sensible au risque. | Échelle 5×5, 5 axes d'impact, valeurs par défaut du contrat. Pour une structure moyenne. | Échelle 4×4, 4 axes d'impact, gouvernance allégée. Pour une petite structure. |
| `is_default` | non | **oui (voir section 8)** | non |

## 4. Paramètres de la version (colonnes de `risk_framework_versions`)

Colonne « à la livraison » : valeur réellement acceptée par le service avant B-12.

| Champ | Prudent | Standard | Léger | Justification |
|---|---|---|---|---|
| `default_evaluation_mode` | CLASSIQUE | CLASSIQUE | CLASSIQUE | Défaut du contrat (DECISION-018 P1). PARTICIPATIF ajoute du tri de contributions : lourd pour une petite équipe, à activer plus tard par le client. |
| `committee_evaluation_min_score` | 15 (sur 36) | 15 (sur 25) | 9 (sur 16) | Début de la bande « Critique ». Standard et Léger = `floor(n²×15/25)` du contrat. Prudent est volontairement sous le défaut contractuel (21) : 15 = 42 % du maximum contre 60 %, donc plus de dossiers au Comité. |
| `committee_evaluation_enforced` | true | true | true | Défaut du contrat. Aucun profil ne désactive l'obligation. |
| `committee_treatment_min_score` | 9 | 15 | 9 | Début de la bande « Élevé » pour Prudent, début de « Critique » pour Standard et Léger. Hypothèse : la décision de traitement d'un risque élevé mérite un regard collectif en profil strict. À confirmer par A06 : effet de NULL. |
| `low_criticality_threshold` | 3 | 4 | 3 | Haut de la bande « Faible ». Obligatoire à la demande d'activation. Au-delà, le cumul Risk Owner + Exécuteur exige l'exception approuvée (B-5). |
| `appetite_thresholds` | voir section 6 | voir section 6 | voir section 6 | Entrées par sous-catégorie du client : valeurs données par famille. |
| `change_approver` (cible) | COMMITTEE | RISK_MANAGER | RISK_MANAGER | Standard et Léger : défaut du contrat (q26), Audit notifié. Prudent : le Comité décide les changements du cadre. |
| `change_approver` (à la livraison B-13) | **RISK_MANAGER** | RISK_MANAGER | RISK_MANAGER | q87 : tant que B-12 n'existe pas, toute autre valeur est refusée. La valeur cible de Prudent est à appliquer par une nouvelle version après B-12. |
| `self_proposal_allowed` | false | false | false | q92. Ne devient vrai que par vote du Comité (invariant). |
| `risk_owner_executor_cumul_allowed` | **false** | true | true | Prudent interdit le cumul Risk Owner + Exécuteur. Standard et Léger : défaut du contrat (autorisé jusqu'au seuil « faible », exception au-delà). Une petite structure n'a souvent pas les effectifs pour séparer. |
| `delegate_executor_cumul_allowed` | **false** | true | true | Même logique. « Le Délégué ne valide pas sa propre exécution » reste un invariant. |
| `delegation_max_days` | 30 | 90 | 180 | Le contrat dit « fixée par le client », sans valeur. Valeurs de départ : un mois (strict), un trimestre, un semestre. Hypothèse de calibrage, pas une norme. |
| `hybrid_policy_enabled` | false | false | false | Défaut du contrat. Le lecteur (B-2) n'existe pas encore : on n'active pas une politique que personne ne lit. |
| `mastery_authoritative_source` | RISK_TEAM | RISK_TEAM | RISK_TEAM | Défaut du contrat, aligné sur le principe de la 2e ligne qui fait foi. Le client en sous-effectif peut passer à `FIRST_LINE` (DECISION-015), avec seconde revue. |
| `committee_vote_rule` (cible) | C | DEFAULT | DEFAULT | Prudent : règle C Strict (unanimité, quorum des 2/3 des éligibles, 4 minimum, 15 jours). Standard et Léger : règle q61 (majorité des exprimés, au moins un vote d'un non concerné). Léger reste en DEFAULT pour rester compatible amorçage ; la règle A est proposée en option. |
| `committee_vote_rule` (à la livraison B-13) | DEFAULT recommandé | DEFAULT | DEFAULT | Les valeurs A/B/C sont acceptées par le schéma mais aucun code ne les lit avant B-12. À poser avec `change_approver`. |
| `committee_vote_custom` | NULL | NULL | NULL | CUSTOM refusé avant B-12. |

Attention Prudent / règle C : 4 éligibles au minimum. Un client dont le Comité compte moins de 4 personnes éligibles bascule en repli marqué (q62). À signaler à l'écran de choix.

## 5. Échelle (objet `rating_scales` référencé par `rating_scale_id`)

### 5.1 Structure

| Champ | Prudent | Standard | Léger | Justification |
|---|---|---|---|---|
| `probabilityLevels` = `impactLevels` | 6 | 5 | 4 | Échelle carrée (DECISION-041). Prudent : plus de nuances. Léger : taille paire, qui évite le choix « central » par défaut. |
| Nombre d'axes d'impact | 7 | 5 | 4 | Max 7 (DECISION-016). Impact retenu = MAX des axes (`retainedImpactRule = MAX`, contrat §6). |
| Axes (codes proposés) | FINANCIER, REGLEMENTAIRE, OPERATIONNEL, CLIENT, REPUTATION, DONNEES, HUMAIN | FINANCIER, REGLEMENTAIRE, OPERATIONNEL, CLIENT, REPUTATION | FINANCIER, REGLEMENTAIRE, OPERATIONNEL, CLIENT_REPUTATION | Fintech UEMOA : fonds et données des clients, régulateur, continuité du service de paiement. Léger fusionne client et réputation. |
| `velocityLevels` | 3 niveaux : Lente, Moyenne, Rapide | idem | NULL (omis) | Optionnel dans le schéma (colonne nullable). Léger reste léger. |
| `persistenceLevels` | 3 niveaux : Ponctuelle, Récurrente, Durable | idem | NULL (omis) | idem |
| `masteryScale.levels` | 3 : Inadéquate, Partielle, Adéquate | idem | idem | Schéma : 1 à 3 niveaux. |
| `masteryScale.defenseLines` | L1, L2, L3 | L1, L2, L3 | L1, L2 | Léger : pas de 3e ligne constituée. L3 absente = pas de note L3, signalée comme telle, pas inventée. |
| `masteryScale.aggregation` | MIN | MIN | MIN | Fixé (CHALLENGE-001). Non compensatoire. |
| `masteryScale.thresholds` | [1,1] Inadéquate ; [2,2] Partielle ; [3,3] Adéquate | idem | idem | Un seuil par niveau, simple. |

### 5.2 Bandes de criticité (`criticalityThresholds`, couvrent 1 à n²)

| Bande | Prudent (1 à 36) | Standard (1 à 25) | Léger (1 à 16) |
|---|---|---|---|
| Faible | 1 à 3 | 1 à 4 | 1 à 3 |
| Moyen | 4 à 8 | 5 à 9 | 4 à 6 |
| Élevé | 9 à 14 | 10 à 14 | 7 à 8 |
| Critique | 15 à 36 | 15 à 25 | 9 à 16 |

Règle de cohérence : le début de « Critique » égale le seuil Comité d'évaluation. Le haut de « Faible » égale `low_criticality_threshold`.

### 5.3 Descriptifs de probabilité (un par niveau, obligatoires pour activer)

Fréquences indicatives, à calibrer par le client.

| Niveau | Prudent (6) | Standard (5) | Léger (4) |
|---|---|---|---|
| 1 | Exceptionnel : moins d'une fois en 10 ans | Rare : moins d'une fois en 5 ans | Rare : moins d'une fois en 3 ans |
| 2 | Rare : une fois tous les 5 à 10 ans | Peu probable : une fois tous les 2 à 5 ans | Possible : une fois tous les 1 à 3 ans |
| 3 | Peu probable : une fois tous les 2 à 5 ans | Possible : environ une fois par an | Probable : plusieurs fois par an |
| 4 | Possible : environ une fois par an | Probable : plusieurs fois par an | Quasi certain : mensuel ou plus |
| 5 | Probable : trimestriel | Quasi certain : mensuel ou plus | — |
| 6 | Quasi certain : mensuel ou plus | — | — |

### 5.4 Descriptifs d'impact global (un par niveau)

| Niveau | Prudent (6) | Standard (5) | Léger (4) |
|---|---|---|---|
| 1 | Négligeable | Négligeable | Mineur |
| 2 | Mineur | Mineur | Modéré |
| 3 | Modéré | Modéré | Majeur |
| 4 | Important | Majeur | Critique |
| 5 | Majeur | Critique | — |
| 6 | Catastrophique | — | — |

### 5.5 Descriptifs par axe (Standard, 5 niveaux)

Qualitatifs, sans montant : le client calibre en XOF à l'activation. Je ne fixe aucun montant.

| Niveau | FINANCIER | REGLEMENTAIRE | OPERATIONNEL | CLIENT | REPUTATION |
|---|---|---|---|---|---|
| 1 | Perte absorbée par le budget courant | Écart interne, sans notification | Gêne interne, brève | Plainte isolée | Aucune visibilité externe |
| 2 | Perte absorbée par le budget de l'entité | Observation du régulateur, sans sanction | Dégradation ponctuelle d'un service non critique | Plaintes multiples sans perte | Mentions isolées |
| 3 | Perte exigeant une réallocation budgétaire | Mise en demeure ou rapport de non-conformité | Service critique indisponible quelques heures | Clients touchés, perte limitée et remboursée | Couverture locale limitée |
| 4 | Perte qui pèse sur le résultat annuel | Sanction financière ou restriction d'activité | Service critique indisponible une journée ou plus | Fonds ou données de nombreux clients compromis | Couverture nationale, perte d'un partenaire |
| 5 | Perte qui menace la solvabilité ou la liquidité | Retrait d'agrément ou suspension d'activité | Arrêt prolongé de l'activité de paiement | Perte massive de fonds ou fuite de données à grande échelle | Perte de confiance durable, retrait de partenaires majeurs |

Règle de dérivation proposée pour les deux autres :
- Léger (4 niveaux) : 1 = niveaux 1 et 2 de Standard, 2 = niveau 3, 3 = niveau 4, 4 = niveau 5. L'axe CLIENT_REPUTATION prend le plus sévère des deux axes.
- Prudent (6 niveaux) : on ajoute un niveau « catastrophique » au-dessus du 5 de Standard, et on coupe le niveau 3 en deux. Axes DONNEES (confidentialité, intégrité, disponibilité des données) et HUMAIN (sécurité des personnes) rédigés sur le même modèle.
- **Limite** : les descriptifs de Prudent (6 × 7 = 42) et de Léger (4 × 4 = 16) ne sont pas encore rédigés mot à mot. Ils sont livrables en annexe après arbitrage, sinon le travail serait refait si le PO ajuste.

## 6. Appétence (`appetite_thresholds`)

Fait : une entrée porte `subCategory`, `subCategoryId`, `entity`, `threshold`, `description` et doit pointer une sous-catégorie du tenant. Je ne peux donc pas livrer de liste fixe de sous-catégories : elles sont propres à chaque client.

Proposition : un seuil par famille de catégorie, appliqué par A06 aux sous-catégories correspondantes du tenant. Seuil = score résiduel au-delà duquel on dépasse l'appétence.

| Famille (taxonomie du mandat) | Prudent (6×6) | Standard (5×5) | Léger (4×4) | Justification |
|---|---|---|---|---|
| Compliance, Fraud, Cybersecurity, Data / Privacy | 3 | 4 | 3 | Haut de la bande « Faible » : appétence faible. Fintech régulée : pas de tolérance sur la conformité, la fraude et les données clients. |
| Financial, Third Party, Business Continuity, Reputational | 8 | 9 | 6 | Haut de la bande « Moyen » : appétence modérée. |
| Operational, Technological, Human Capital | 8 | 9 | 6 | idem. |
| Strategic | 8 | 9 | 6 | idem. L'appétence stratégique est une décision de direction : le client doit la confirmer. |

Pourcentage du maximum, pour comparer : Prudent 8 % et 22 %, Standard 16 % et 36 %, Léger 19 % et 38 %. Prudent est nettement plus strict.

Règle : si aucune sous-catégorie du tenant ne correspond, l'entrée n'est pas créée. Le tableau reste vide et le panel doit le dire (« appétence non définie »), jamais « respecté ». Les entrées créées par défaut sont marquées « valeur de départ à confirmer ».

## 7. Compatibilité avec l'amorçage (q98)

| Dispositif | Respecte exactement les défauts du contrat ? | Conséquence |
|---|---|---|
| Standard | Oui | Peut être le premier Dispositif d'un client à un seul Risk Manager. |
| Léger | Oui, avec n = 4 (seuil Comité `floor(16×15/25)` = 9) | Idem. |
| Prudent | Non : seuil Comité 15 au lieu de 21, deux cumuls à faux | Refusé par `contractDefaultViolations` s'il est activé en premier par amorçage. Chemin normal : activer Standard ou Léger d'abord, puis demander Prudent par le circuit ordinaire avec au moins 2 Risk Managers. |

Point à signaler à A05/A06, sans le trancher : le contrôle exige l'égalité stricte, alors que ma revue précédente (I-D5) parlait de « défauts ou plus strict ». Prudent est plus strict que le défaut sur chaque point où il diffère. Un assouplissement « égal ou plus strict » ne relève pas de B-13 et demande une décision.

## 8. Quel Dispositif par défaut à la mise en service ?

**Recommandation : Standard.**

Raisons :
1. Fait : c'est le seul profil de taille moyenne qui reprend exactement les défauts du contrat. Il passe l'amorçage avec un seul Risk Manager (Djamo au démarrage, q93).
2. Avis : il n'impose pas un cumul interdit ou un Comité de 4 personnes à un client qui ne les a pas. Un Dispositif prudent mal servi par l'organisation produit des replis et des blocages, donc de la fatigue et des contournements.
3. Avis : 5×5 est la taille la plus répandue en pratique, donc la plus facile à expliquer et à comparer.
4. Fait : le premier Dispositif activé devient automatiquement le défaut du tenant (spec §4 étape 5). Il faut donc que le premier activé soit Standard, pas un autre.
5. Prudent et Léger restent disponibles à l'assistant, à activer par le circuit ordinaire. Léger convient si le client est une très petite structure.

Contrepartie à accepter : un client très régulé démarre à un niveau moyen de rigueur. Il passe à Prudent dès que 2 Risk Managers et un Comité existent. Un KRI suit ce passage (section 10).

## 9. Champs qui manquent dans le schéma (« à ajouter, à arbitrer »)

Ces champs ne sont PAS dans le Dispositif aujourd'hui. Je ne les seedé pas. Les valeurs indicatives ne servent qu'à décider s'il faut les ajouter.

| Champ manquant | Pourquoi c'est utile | Valeur indicative (Prudent / Standard / Léger) |
|---|---|---|
| Fréquence de revue d'un risque par bande de criticité | ISO 31000 : suivi et revue continus. Aujourd'hui rien ne dit quand revoir. | Critique : mensuelle, Élevé : trimestrielle (Prudent : mensuelle) ; Standard : trimestrielle puis semestrielle ; Léger : semestrielle |
| Fréquence de mesure des KRI | Un KRI sans cadence ne se suit pas | Mensuelle / mensuelle / trimestrielle |
| Seuil de tolérance distinct de l'appétence | COSO ERM distingue appétence et tolérance. Le schéma n'a qu'un seuil | Tolérance = appétence + 1 bande (à arbitrer) |
| Appétence globale par défaut (hors sous-catégorie) | Le schéma exige une sous-catégorie du tenant : un client sans taxonomie n'a aucune appétence | Haut de « Moyen » : 8 / 9 / 6 |
| Durée maximale d'une acceptation de risque | Mandat §18 : expiration obligatoire | 3 mois / 6 mois / 12 mois |
| Délai d'échéance des plans d'action par bande | Mandat §20 | Critique 30 j, Élevé 90 j / 45 j, 90 j / 60 j, 120 j |
| Action sur dépassement d'appétence (alerte seule ou escalade obligatoire) | Mandat §26 : dépassement escaladé, jamais masqué | Escalade obligatoire pour les trois : c'est un invariant, pas un réglage |
| Seuil de rattachement du Comité de traitement par défaut | NULL aujourd'hui, comportement mal défini | Voir section 4 |

## 10. KRI proposés (hors schéma, à reprendre quand le module KRI de pilotage existe)

- Part des risques résiduels au-dessus de l'appétence, par Dispositif.
- Nombre de décisions Comité prises en repli, par Dispositif (Prudent : forte attente de zéro).
- Âge du Dispositif actif sans nouvelle version (revue de la méthode au moins annuelle, hypothèse).
- Part des clients restés sur Standard alors que leur profil observé est « grande structure » (lien avec le panel de gouvernance).

## 11. Ce que ce document ne décide pas

- Je ne décide pas d'une norme. Aucun seuil n'est réglementaire.
- Je ne modifie aucune règle d'invariant. Les valeurs sont toutes des paramètres du client.
- Le Comité, l'appétence stratégique et les montants en XOF restent à confirmer par le client.

---

## Question au PO

**Titre : Valeurs de départ des trois Dispositifs par défaut (Prudent, Standard, Léger) et choix du défaut (B-13, DECISION à venir)**

**Contexte.**
Le lot B-13 livre trois Dispositifs prêts à l'emploi. Chacun fixe une échelle (6×6, 5×5, 4×4), les bandes de criticité, le seuil du Comité, l'appétence par famille de risque et le niveau de rigueur de la gouvernance (cumuls, durée de délégation, règle de vote). Mes valeurs sont des points de départ réglables par le client, pas des normes. Standard reprend les défauts du contrat et peut être activé en premier par un client à un seul Risk Manager. Prudent est plus strict et ne peut pas être activé en premier par amorçage. Les descriptifs détaillés de Prudent et de Léger sont à rédiger après votre accord. Détail : `docs/risk/A13-dispositifs-par-defaut-B13-2026-11-11.md`.

**Options.**
- **A (recommandée) : valider mes valeurs et Standard comme Dispositif par défaut à la mise en service.** Les tables des sections 3 à 6 servent de contenu de B-13. Les champs qui manquent au schéma (section 9) sont reportés à une question séparée.
- **B : ajuster.** Vous indiquez les valeurs à changer (par exemple le seuil Comité de Prudent, les durées de délégation ou la taille de l'échelle de Léger). Je revois la cohérence bandes, seuil Comité et appétence.
- **C : autre.** Par exemple choisir Léger comme défaut, ou ajouter ou retirer l'un des trois profils.

**Recommandation : option A.** Standard est le seul profil de rigueur moyenne qui passe l'amorçage sans exception et qui n'impose pas à un petit client des cumuls interdits ou un Comité de 4 personnes. Le client monte vers Prudent quand son organisation le permet.
