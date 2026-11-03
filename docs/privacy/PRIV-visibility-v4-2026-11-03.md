# PRIV-visibility-v4 — Revue Privacy : visibilité des ressources, cas administrateur

ASSESSMENT_ID: PRIV-VIS-V4-2026-11-03
DATE: 2026-11-03
ASSESSOR: A15 (Privacy / Data Protection)
REVIEWER: à désigner (second regard Privacy, dans la chaîne GRC)
DEMANDEUR: Compliance (CMP-V4-04)
DÉCISION DE RÉFÉRENCE: DECISION-103 (q197 A3, PO)
SÉCURITÉ: avis A10 favorable sous réserve de deux correctifs (fin définitive du droit à la perte de la qualité d'administrateur ; exclusion des administrateurs hors rôle comme confirmateurs). Ces correctifs relèvent de la Sécurité ; la présente revue ne les évalue pas.

## 1. Périmètre et limites

- Périmètre : conception du droit `resource.readall` et de la visibilité par défaut (option A1) pour un administrateur hors Risk Manager, Comité et Audit, sur les ressources restreintes.
- Nature : revue de conception. Le code ne contient pas encore `resource.readall` (recherche dans le worktree : aucune occurrence). Les conclusions portent sur la conception décrite, non sur une implémentation.
- Les fichiers modèles `docs/privacy/PRIV-visibility-v3-2026-11-01.md` et `.claude/agent-context/memory/privacy.md` sont absents du worktree. Cette revue n'a donc pas pu s'appuyer sur la v3 ni sur la mémoire Privacy existante ; elle doit être recalée contre elles dès leur disponibilité.
- Hors périmètre : cotation globale du risque (Risk Manager), obligations réglementaires détaillées (Compliance), correctifs de sécurité (Security).

## 2. Applicabilité

- Droit ivoirien (loi n°2013-450, autorité ARTCI) : applicable. Références d'articles à confirmer par Compliance avant citation formelle.
- RGPD : GDPR_APPLICABILITY = NOT_ESTABLISHED, sauf si le périmètre comporte un établissement dans l'UE ou des personnes situées dans l'UE. Non établi à ce jour.
- BCEAO / confidentialité des déclarations liées à la LBC-FT et des dossiers fraude : à qualifier par Compliance pour les dossiers « personnes nommées » (risque de divulgation d'une alerte en cours).
- Politique interne : exigences de restriction des dossiers RH et fraude, à confirmer par le PO.

## 3. Constats et recommandations

### Q1 — Minimisation : le droit couvre-t-il les dossiers « personnes nommées » ?

Constat : tel que décrit, `readall` donne accès à tout contenu, y compris les enquêtes fraude et RH. Ces dossiers concernent des personnes identifiées, peuvent emporter une décision à leur égard, et leur divulgation peut compromettre une enquête. Ce sont les données les plus sensibles du périmètre. La visibilité par défaut (A1) n'expose déjà pas les titres ; l'existence même d'un dossier nommé peut toutefois être sensible.

Recommandation ferme : exclure les dossiers « personnes nommées » du champ de `resource.readall`. Leur accès passe par un octroi distinct, par dossier, sur motif codifié, confirmé par un membre du Comité ou de l'Audit n'étant ni auteur, ni bénéficiaire, ni administrateur, avec une durée liée à la clôture du dossier (cf. Q3).

En complément, les dossiers « personnes nommées » ne doivent pas apparaître dans les métadonnées A1 (ni comptage, ni identifiant), sauf comptage agrégé sans identifiant si le PO le retient.

Statut : CONDITION DE PRODUCTION (bloquant pour la portée `readall` actuelle).

Question PO : confirmer l'exclusion de `readall` pour les dossiers « personnes nommées ». Recommandation Privacy : exclusion (option A), sans quoi une confirmation distincte par dossier est le minimum.

### Q2 — Journalisation des lectures sous `readall`

Constat : l'absence de journalisation des lectures interdit de savoir qui a consulté le dossier d'une personne donnée. Cela empêche de répondre à une demande d'accès d'une personne concernée, d'instruire un incident, et de contrôler l'usage du droit. La Compliance juge cette journalisation bloquante ; Privacy partage ce constat.

Recommandation ferme : journaliser chaque lecture, au grain de la ressource ouverte (un événement par ressource restreinte ouverte) : acteur, type et identifiant de ressource, horodatage, référence de l'octroi `readall` actif. Ne pas journaliser le contenu, ni le titre, ni le motif en texte libre. Une consultation de liste produit un événement unique avec le nombre de ressources affichées, sans identifiants.

Justification du grain : une journalisation par liste ne permet pas de savoir quels dossiers personnels ont été ouverts.

Volume : limité, le droit étant réservé à un petit nombre de confirmés.

Statut : CONDITION DE PRODUCTION (bloquant).

### Q3 — Durée maximale et recertification

Constat : sans durée maximale, le droit reste actif indéfiniment, y compris après un changement de fonction non signalé. Le correctif de Sécurité (fin à la perte de qualité d'administrateur) ne couvre pas la nécessité qui cesse sans changement de rôle.

Recommandation chiffrée (valeur de recommandation Privacy, non issue d'un texte) :
- durée maximale de 90 jours, expiration automatique, non prolongeable sans nouvelle demande et nouvelle confirmation ;
- recertification trimestrielle de la liste des octrois actifs par le Comité ou l'Audit ;
- pour les dossiers « personnes nommées » (si le PO retient une option distincte, Q1) : expiration à la clôture du dossier, et au plus 30 jours renouvelables.

Statut : CONDITION DE PRODUCTION (bloquant : absence de durée = exposition non bornée).

### Q4 — Usage de `updatedAt` dans la visibilité A1

Constat : `updatedAt` renvoie un moment d'activité. Sur un dossier fraude ou RH, l'horodatage peut révéler le moment d'une enquête ou d'une action. Un identifiant de ressource non opaque (nom, numéro de personne) constituerait par ailleurs une donnée personnelle exposée.

Recommandation : acceptable à deux conditions :
- granularité au jour (pas d'heure) ;
- identifiants de ressources vérifiés opaques (non nominatifs), avec preuve.
Pour les dossiers « personnes nommées », `updatedAt` ne doit pas être exposé en A1 (cf. Q1).

Statut : CONDITION DE PRODUCTION (vérification et preuve requises ; pas de blocage si les deux conditions sont tenues).

### Constat complémentaire — motif de l'octroi

Le motif est une donnée saisie par un administrateur ; un texte libre peut contenir des données personnelles. Recommandation : liste de motifs codifiée, sans texte libre, ou texte libre sans donnée personnelle, contrôlé. Statut : recommandation (non bloquante).

## 4. Blocage

PRIVACY_BLOCK:
BLOCK_ID: PRIV-BLK-V4-001
TASK_ID: CMP-V4-04

PROCESS: visibilité des ressources restreintes, droit `resource.readall`
DATA: contenus de ressources restreintes, dont dossiers « personnes nommées » (fraude, RH) ; métadonnées A1 (`updatedAt`, identifiants)
REQUIREMENT: minimisation et exposition justifiée (droit local, politique interne de restriction) ; traçabilité des accès à des données sensibles

ISSUE: le droit `readall` couvre les dossiers nommés sans confirmation distincte, sans durée maximale et sans journalisation des lectures.
EXPECTED: exclusion des dossiers nommés ou octroi distinct par dossier ; journalisation par ressource ouverte ; durée maximale et recertification.
OBSERVED: conception décrite couvrant tout contenu, sans durée, sans journalisation.

PRIVACY_IMPACT: exposition de données de personnes identifiées sur des dossiers pouvant emporter une décision, sans trace des accès ; impossibilité de répondre à une demande d'accès ou d'instruire un incident.
EVIDENCE: décision DECISION-103 ; avis Compliance CMP-V4-04 ; recherche dans le code (aucune implémentation).

REQUIRED_ACTION: réviser la conception du droit `readall` selon Q1 à Q3.
REQUIRED_EVIDENCE: spécification révisée ; schéma d'audit (événement par ressource) ; règle d'expiration testée ; liste des motifs.

OWNER: Architect (conception), PO (décisions Q1 et Q3 — voir section 5), Dev Backend (implémentation après validation).
RELEASE_CONDITION: levée lorsque Q1, Q2 et Q3 sont tranchées et qu'une revalidation Privacy confirme la prise en compte.
ESCALATION: PO (HUMAN) pour Q1 (périmètre des dossiers nommés) ; Compliance pour la qualification BCEAO des dossiers fraude.

STATUS: BLOCKED (portée `readall` uniquement ; la visibilité A1 par défaut peut avancer sous réserve de Q4)

Le blocage ne porte pas sur la visibilité par défaut, dont la minimisation (absence de titre et de motif) est conforme à la conception décrite.

## 5. Questions à arbitrer par le PO (HUMAN)

- Q1 : exclure les dossiers « personnes nommées » de `readall` (recommandation Privacy) ou prévoir un octroi distinct par dossier ?
- Q3 : valider 90 jours et recertification trimestrielle, ou retenir une autre durée ?
- Q4 : accepter `updatedAt` au jour seulement (recommandation), ou supprimer ce champ en A1 ?

Ces arbitrages relèvent du PO. Privacy ne les tranche pas.

## 6. Synthèse des statuts

| Point | Statut | Condition de production |
| --- | --- | --- |
| Visibilité A1 par défaut | COMPLIANT_FOR_SCOPE (conception) | Non |
| Q1 Dossiers nommés dans `readall` | GAP_IDENTIFIED | Oui |
| Q2 Journalisation par ressource | GAP_IDENTIFIED | Oui |
| Q3 Durée et recertification | GAP_IDENTIFIED | Oui |
| Q4 `updatedAt` | CHALLENGED | Oui (preuve de granularité et d'opacité) |
| Motif en texte libre | CHALLENGED | Non |
| Portée `readall` globale | BLOCKED | Oui |

## 7. Conclusion

Pour le périmètre de conception revu (2026-11-03), la visibilité A1 par défaut est acceptable. Le droit `resource.readall` n'est pas acceptable en l'état : il expose des dossiers nommés sans bornage ni traçabilité. Les conditions de production sont Q1, Q2, Q3 et la preuve de Q4.

Niveau de confiance : CONFIRMED pour l'absence d'implémentation (vérifiée dans le worktree) ; PROBABLE pour les conséquences sur les personnes (dépend de la nature réelle des dossiers nommés) ; OPEN pour l'applicabilité BCEAO des dossiers fraude.

STATUS: BLOCKED (portée `readall`) ; ESCALATED vers PO pour Q1, Q3, Q4 ; Compliance consultée pour Q2 et qualification BCEAO.

## 8. Revalidation (DECISION-111)

Décisions reçues : q219 (dossiers « personnes nommées » exclus de `readall`), q220 (audit par ressource ouverte et par liste, avant réponse, échec = refus), q221 (90 jours réglables, pas de prolongation automatique), q223 (date seule AAAA-MM-JJ, identifiants UUID opaques).

| Point | Décision | Statut revalidé | Reste à prouver / à trancher |
| --- | --- | --- | --- |
| Q1 Dossiers nommés | Exclus de `readall` ; seul l'ajout nominatif les ouvre | PARTIELLEMENT SATISFAIT | Le chemin nominatif doit porter motif, confirmation par Comité/Audit non auteur ni bénéficiaire, journalisation et expiration (clôture du dossier, 30 jours max). Ces trois points ne figurent pas dans DECISION-111. |
| Q2 Journalisation | Une ligne par ressource ouverte (type, id, référence d'attribution, sans titre ni contenu), une par liste (nombre) ; échec = refus | SATISFAIT pour `readall`, sous réserve de preuve | Preuve d'implémentation : écriture avant réponse, refus si échec. |
| Q3 Durée | 90 jours réglables, puis nouvelle demande et confirmation | SATISFAIT partiellement | (a) Plafond de 90 jours à faire respecter côté configuration. (b) La recertification trimestrielle recommandée n'apparaît pas dans DECISION-111 : à confirmer ou écarter par le PO. |
| Q4 `updatedAt` | Date seule AAAA-MM-JJ ; identifiants UUID opaques | SATISFAIT sous réserve de preuve | Preuve dans la vue métadonnées (format et absence d'heure dans les réponses API). |
| Motif | Non tranché | OUVERT | Recommandation de liste codifiée (non bloquant). |

### Limites connues

- Tableaux de bord (agrégats) non journalisés : ACCEPTABLE sous conditions : pas de champ nominatif dans les agrégats et seuil minimal de cellule (valeur à fixer par le PO, par exemple 5) ; sinon non acceptable.
- Lectures d'éléments enfants (exécutions, preuves, mesures) non journalisées : NON ACCEPTABLE en l'état pour les preuves ou exécutions pouvant contenir des données personnelles. ACCEPTABLE uniquement si la classification prouve l'absence de donnée personnelle dans ces éléments, ou si la ligne d'audit du parent est écrite et couvre explicitement les enfants (comptage des enfants lus).

### Verdict

- PRIV-BLK-V4-001 : LEVÉ EN CONCEPTION pour `readall` (portée Q1 exclue, Q2 et Q4 retenus). Le blocage reste en vigueur pour la mise en production jusqu'à la preuve d'implémentation (Q2 écriture avant réponse, Q3 plafond, Q4 format) et jusqu'à la clôture des deux points ouverts (chemin nominatif, limite enfants).
- Conditions Q1 à Q4 : satisfaites en conception ; non satisfaites en production (preuves manquantes, cf. tableau).
- Limites : tableaux de bord acceptables avec seuil minimal ; lectures enfants non acceptables en l'état.

Questions PO :
- Confirmer le chemin nominatif : motif, confirmation, journalisation et expiration (recommandation : expiration à la clôture, 30 jours max).
- Trancher la recertification trimestrielle (recommandée : oui).
- Fixer le seuil minimal de cellule des agrégats (recommandation : 5).

STATUS: CONDITIONAL (conception levée ; production non revalidée, preuves requises)
