# Consultation — produit configurable (DECISION-055) et réglages dans l'Administration (DECISION-054)

**Date** : 2026-10-18. **Demandée par** : le PO (q113 : « tout doit être modulable, défaut = gouvernance stricte ; produit commercial »).
**Consultés** : A13 Risk Manager, A05 Architecte, A06 Dev Backend, A10 Sécurité. Ce sont des recommandations, pas des décisions : tout point « à trancher » est une question au PO.

## A13 — Risk Manager

### I-D9 sous le principe configurable
- **Refus du faux tiers maintenu, non configurable** : un administrateur qui se désigne « administrateur sollicité » demande, atteste et décide seul, alors que le dossier montre une deuxième personne qui n'existe pas (invariant 5, « rien n'est auto-approuvé »).
- **À la place, un réglage honnête** : un régime « structure à une personne », désactivé par défaut. Déclaré à la création de l'espace client par le titulaire du compte (nom, date, motif tracés). Levé par le circuit normal dès qu'une deuxième personne existe, jamais rouvert (même logique que q102). Marquage : bandeau « régime à une personne » sur chaque décision, rapport et Cartographie, ligne d'audit, indicateur d'ancienneté.

### Réglage ou invariant (défaut strict)

| Règle | Statut | Défaut strict | Justification |
|---|---|---|---|
| Ne jamais valider ce qu'on a saisi ou exécuté (inv. 1) | Invariant | Appliqué | Sans cela, plus de contrôle (ISO 31000 6.4, IIA 3 lignes) ; le cas « une personne » passe par le régime marqué |
| Aucune auto-approbation, tout tracé (inv. 5) | Invariant | Appliqué | Minimum d'un produit de gouvernance |
| Audit append-only, attribution forcée côté serveur (inv. 7) | Invariant | Appliqué | La preuve ne se réécrit pas |
| Historique et cycles passés non modifiables (inv. 9) | Invariant | Appliqué | Comparabilité, défendabilité d'un audit |
| Un paramètre ne masque pas un dépassement d'appétence (inv. 8) | Invariant | Appliqué | COSO : on ne règle pas le seuil pour supprimer le dépassement |
| Pas de validation tacite (inv. 10, partie 1) | Invariant | Appliqué | Un silence n'est pas un accord |
| Cumul de rôles visible (inv. 6) | Invariant | Appliqué | Permis, jamais caché |
| Mode effectif jamais Hybride (inv. 4) | Règle technique | Appliqué | Cohérence du modèle |
| Qui saisit le Résiduel (inv. 3) | Réglage encadré | Équipe risque | La revue indépendante reste exigée |
| Quorum, règles du Comité A/B/C | Réglage | ≥ 2 éligibles ; repli marqué | Taille de l'organisation |
| Approbateur d'un changement | Réglage | Fonction risque, Audit notifié | Organisation |
| Cumul Risk Owner + Exécuteur ; seuil « faible » | Réglage | Jusqu'au seuil « faible » | Déjà au contrat |
| Délégué, durée de délégation | Réglage | Recommandé ; durée fixée par le client | Équipe réduite |
| Échelle, axes, appétence, seuil Comité | Réglage | Défauts du contrat | Visible, sans plafond (I-D8) |
| Auto-proposition de désignation | Réglage | Désactivée ; seul le Comité l'active | Déjà au contrat |

### Petite structure, une seule personne risque
- Sans le régime : pas d'amorçage par simple déclaration ; il faut un second utilisateur ou un autre administrateur → risque réel de compte fictif, pire qu'une exception déclarée.
- Avec le régime : fonctionne sans contournement, décisions marquées « sans second regard ». Option : relecteur externe invité en lecture seule.
- Compromis assumé : le régime abaisse l'invariant 1 pour ce client ; c'est la transparence qui compense.

### À trancher par le PO (A13)
1. Faut-il ce régime « une personne », et sous quelles conditions de levée ?
2. Qui peut le déclarer : le titulaire du compte, ou l'éditeur à l'onboarding ?
3. Le tableau ci-dessus est-il la liste retenue des invariants ?
Si oui : modifier le contrat (invariants 1 et 5), la spec B-6 §5.6 pt 6 et I-D9.

## A10 — Sécurité

### Règle « réglage sûr » (proposée pour tout réglage futur)
- (a) Stocké par tenant (`actor.tenantId` côté serveur), jamais global, jamais un tenant fourni par le client.
- (b) Une permission dédiée par réglage (`config.<x>.set`), jamais `config.update` ; un seul chemin d'écriture (DECISION-054).
- (c) **Durcir** : une personne suffit, effet immédiat.
- (d) **Assouplir** : maker-checker — B approuve la demande de A, B ≠ A, B ni bénéficiaire ni visé ; un administrateur n'assouplit jamais seul une règle qui le contraint.
- (e) Effet après approbation, jamais rétroactif ; la valeur du réglage est figée sur chaque décision qu'il autorise.
- (f) Audit avant/après avec motif, dans la même transaction ; assouplissement notifié au Risk Manager et à Audit.
- (g) Réglage absent ou illisible → défaut strict (fail-closed).
- **Écart actuel (INFO, A06)** : `ConfigService.setCommitteeEnforcement(false)` et `setCommitteeAuditCumul(true)` assouplissent avec un seul administrateur (motif + audit, pas de second approbateur).

### I-D9 configurable
F-B6d-01 et QA-B6d-01 **restent à corriger** : au défaut strict, le produit affirme qu'un contrôle s'applique ; un réglage strict contournable est pire que pas de réglage, car l'auditeur du client s'y fie.

### Jamais configurable (proposition au PO)
Isolation tenant ; append-only de `audit_logs` et audit de toute écriture ; attribution `...By` forcée côté serveur ; suppression logique seule ; vérification du jeton SSO (la liste des domaines autorisés peut varier) ; interdiction de s'attribuer ou se retirer ses propres rôles ; maker-checker sur l'assouplissement d'un réglage ; fail-closed, non-rétroactivité, instantanés figés ; gardes en base (search_path, triggers).

### Risques d'un « tout configurable » et mesure
2^n combinaisons non testées ; administrateur compromis qui assouplit puis agit ; ingénierie sociale ; lecteurs oubliés (F-B6b-01). **Mesure** : un registre unique des réglages (clé, défaut strict, sens de l'assouplissement, permission, bornes) parcouru par un test paramétré (défaut strict, puis chaque assouplissement isolé, maker-checker et audit exigés) ; un écran « écarts au défaut » par tenant, en lecture pour Audit.

## A06 — Dev Backend

### Règles codées en dur qui sont des choix de gouvernance (extrait)
| Règle | Où | Défaut | Coût | Remarque |
|---|---|---|---|---|
| I-D9 admin sollicité = soi-même | `domain/frameworkApproval.ts:63`, `RiskFrameworkService.ts:693` | interdit | M | |
| Cumul RM + Audit interdit | `RoleService.ts:31,86-94` | interdit | S | indépendance du contrôle |
| Cumul RM + Comité (q94) | `RoleService.ts:80-85` | règle q94 | S | |
| Cumul Comité + Audit | `configs.committee_audit_cumul_allowed` (054), `ConfigService.ts:328-347` | **true en base = pas strict** | — | à inverser selon DECISION-055 ? |
| Cumul admin + groupes fixes | `RoleService`, `fixedGroupPermissions.ts` | autorisé avec motif | M | |
| Quorum `MIN_VOTERS = 2` | `frameworkApproval.ts:13,89-91` + triggers 062 | 2 | S/M | à 1, plus de quatre-yeux |
| Clôture de plan d'action refusée au responsable | `ActionPlanService.ts:457` | refusé | S | maker-checker |
| Seuil KPI « à risque » 0,8 | `domain/entities/Kpi.ts:62` | constante | S | hors gouvernance stricte |
Déjà des paramètres : auto-proposition, cumuls RO/DEL + EXEC, politique hybride (Dispositif) ; seuil Comité activé (configs/Dispositif).

### Mécanisme recommandé (sans moteur de règles)
Deux stockages existent : `configs` (une ligne par tenant, un setter + permission + motif + audit par réglage, modèle q58) et paramètres **versionnés** du Dispositif (immuables une fois ACTIVE, changés par demande approuvée). Règles de référentiel → paramètre du Dispositif ; règles d'accès / séparation des tâches et **I-D9** (s'applique pendant l'amorçage, avant tout Dispositif actif) → colonne `configs`, défaut strict, setter dédié. Un booléen ou entier typé par règle, lu en un seul point.

### Chemins d'écriture multiples (DECISION-054)
- Fermés quand le Dispositif gouverne : seuils Comité / mode / enforcement (`/config/*`), appétence (`/risk-appetite`), activation d'échelle — mais la fermeture de `ConfigService` dépend d'un paramètre optionnel câblé dans `server.ts` (à rendre inconditionnelle).
- **Encore ouverts / à trancher** : `PATCH /rating-scales/:id/disable` (non vérifié) ; `PUT /config` (formule de score, règle d'impact retenu, seuils de niveaux) et `PUT /config/appetite-mode` : hors Dispositif, une seule route chacun — Dispositif ou `configs`, une des deux.

### Jamais configurable (proposition)
Append-only de l'audit, tenant_id, suppression logique, attribution serveur, maker-checker de base, cumul RM + Audit (sauf régime « petite structure » tracé et notifié), notifications de gouvernance obligatoires, permissions terminales dédiées, contrôles de pièces jointes et de taille, bornes du modèle (score P×I ≤ 36).

## A05 — Architecte

### Réglages à plusieurs chemins d'écriture
| Réglage | État | Cible |
|---|---|---|
| Seuils Comité, obligation Comité, mode par défaut | `ConfigService` fermé (B-6b) ; écrit via le brouillon du Dispositif | Brouillon du Dispositif — **fermé** |
| Appétence | `RiskAppetiteService` fermé ; **le frontend appelle encore ces routes** (`frontend/src/api/riskAppetite.ts:29,31`) : boutons qui échouent toujours | Brouillon — **fermé**, écran à corriger |
| Échelle en vigueur | `activateVersion` fermé ; appel frontend mort (`frontend/src/api/evaluations.ts:155`) | Dispositif — **fermé**, écran à corriger |
| Contenu d'une échelle | `PUT /rating-scales/:id/*`, seulement hors ACTIVE | Acceptable (objet référencé) ; à présenter comme « préparer une échelle pour le prochain brouillon » |
| Mode d'un processus | `PUT /processes/:id/evaluation-mode` **et** le circuit demande/validation | **Ouvert** : le contrat §10 retire `process.evaluationmode.set` → fermer la route directe |
| `score_formula`, `level_thresholds`, `impact_retenu_rule`, `appetite_mode` | `PUT /config`, `PUT /config/appetite-mode` | **Ouverts mais inertes** (aucun code ne les lit) : trompeur pour un client → fermer ou marquer « non appliqué » |
| Cumul Comité + Audit | `PUT /config/committee-audit-cumul` | Chemin unique, conforme |
| Activation des modules | `PATCH /modules/:name/toggle`, `config.manage`, **sans motif ni tiers** | Insuffisant : un seul admin peut désactiver le module AUDIT |

### Tension DECISION-054 / contrat §10
Sans problème backend si l'Administration **héberge l'éditeur de brouillon existant** (mêmes routes) et que les autres sections ne font qu'ouvrir ce brouillon ; l'approbation reste dans « À faire » (l'approbateur n'est pas l'admin). **Problème réel** : le contrat §10 réserve l'édition de la méthodologie au groupe Risk Manager ; l'Administration est le domaine de l'admin → il faut des droits par onglet, sinon on suggère que l'admin configure la méthodologie. **À confirmer par le PO.**

### Modèle proposé (à décider par le PO) : deux niveaux seulement
- **Réglage client (tenant)** : effet immédiat, motif, audit — plateforme (modules, e-mail, stockage, masquage, cumul Comité + Audit, durée de session).
- **Paramètre de version du Dispositif** : approuvé, effet au cycle suivant — toute la méthodologie du §10.
Défaut strict = le Dispositif livré par défaut + valeurs client fermées. Pas de troisième niveau.

### Non négociable (proposition)
Invariants 1 à 10 du contrat §10 ; audit append-only dans la même transaction ; tenant_id ; suppression logique ; attributions côté serveur ; permission dédiée pour toute action terminale ; maker-checker sur les rôles et les paramètres. Désactiver le module AUDIT : au minimum motif + approbation d'un tiers.

### Recommandations ordonnées
1. Fermer `PUT /processes/:id/evaluation-mode` et retirer la permission (S, backend).
2. Fermer `PUT /config` et `/appetite-mode`, ou les marquer « non appliqué » (S, backend).
3. Motif obligatoire sur l'activation des modules, plus un tiers pour AUDIT et RISK (S-M, backend).
4. Supprimer ou rediriger vers le brouillon les écritures mortes d'Appétence et de Grilles (S, frontend).
5. Entrée « Dispositif » dans l'Administration montant l'écran Dispositif ; les autres sections deviennent des liens vers le brouillon (M, frontend).
6. Badge de portée Client / Dispositif et état « défaut actif » sur chaque réglage (M, frontend).
7. Test de garde : toute écriture vers un réglage migré répond « porté par le Dispositif » (S, backend, A08).
8. Plus tard : le changement des droits du groupe Audit passe par le même circuit de demandes que le Dispositif (L).

## Questions au PO (consolidées par l'orchestrateur, posées dans le cockpit q115 à q119)
- **q115** Liste des éléments jamais configurables (convergence A05/A06/A10/A13).
- **q116** Règle d'assouplissement : deux personnes, jamais celle que la règle contraint (A10, A06).
- **q117** Régime « structure à une personne » (A13), à la place de l'auto-désignation.
- **q118** Qui modifie la méthodologie (Dispositif) dans l'Administration : le groupe Risk Manager seulement, ou aussi l'administrateur ? (A05)
- **q119** Cumul Comité + Audit autorisé par défaut aujourd'hui (DECISION-042 q58) : le passer à « interdit par défaut » sous DECISION-055 ? (A06)
