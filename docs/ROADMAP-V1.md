# Roadmap jusqu'à la livraison V1 — GRC Tools (Djamo)

**Date** : 2026-10-08. **Auteur** : orchestrateur (A02), à partir du
balayage de préparation des 16 agents ACF (lecture de la codebase, du
contrat amendé, du Decision Log DECISION-009 à 020 et des plans).
**Sources** : `docs/architecture/RM-V1-Sequence-actions.md` (séquence
détaillée, numéros d'étape repris ici), `docs/architecture/RM-V1-Lots-contrat-amende.md`,
`docs/architecture/EVD-Import-Excel-cadrage.md`, `docs/ux/RM-V1-Experience-Dispositif.md`,
`.claude/agent-context/ACTION_ITEMS.md`.

Aucune date n'est donnée : la cadence dépend des gates humains (GO PO,
application des migrations, juristes). Les tailles S / M / L sont celles
des agents.

## 1. État de préparation des agents (balayage du 2026-10-08)

| Agent | Statut | Point clé |
|---|---|---|
| Architecte (A05) | Prêt avec réserves | 6 lots manquants ajoutés (EVD-S, B-10 à B-13, F-3) ; séquence à mettre à jour |
| Dev Backend (A06) | Prêt avec réserves | Départ propre : typecheck OK, **723 tests verts** ; B-0 prêt |
| Dev DB (A07) | Prêt avec réserves | Prochaine migration 047 ; l'échelle à 6 exige d'élargir les CHECK 1..5 de `risks` (`003_risks.sql`) ; GRANT explicite à `grc_app_runtime` à chaque table |
| Dev Frontend | Prêt avec réserves | Aucun écran sans maquette validée ni contrats backend ; `RealtimeClient` à créer |
| UX Designer (A04) | Prêt avec réserves | Aucune maquette existante ; accès Penpot requis (sinon artefact HTML) |
| Risk Manager (A13) | Prêt avec réserves | Rédige l'étape 2 ; 3 Dispositifs par défaut proposés ; recette métier à organiser |
| Product Manager (A03) | Prêt avec réserves | Critère « WebSocket-ready » à préciser ; traçabilité ACT-xxx → lots à construire |
| QA (A08) | Prêt avec réserves | Aucun test d'intégration Postgres ni E2E en CI ; invariants §10 sans tests dédiés |
| Security (A10) | Prêt avec réserves | **Bombe de décompression déjà exposée en production** sur l'import de risques existant (~CVSS 6,5) ; F-1 toujours ouverte |
| Privacy (A24) | **Bloqué** sur B-4, fenêtre DECISION-011, EVD-1/4 ; prêt ailleurs | Juristes + DPIA pour B-4 ; exclure les permissions sensibles de la fenêtre de refus ; sens du masquage |
| Compliance (A14) | Prêt avec réserves | COMPLIANCE_BLOCK annoncés (B-4, B-5, B-1) si conditions non tenues ; corbeille Drive incompatible avec 10 ans |
| Audit (A23) | Prêt avec réserves | Téléchargements non audités ; approbateur/motif/valeur précédente non modélisés ; CHECK des actions à élargir |
| DevOps (A09) | Prêt avec réserves | `staging` et `main` ont divergé ; Dependabot cible `main` ; nouvelles variables d'environnement à créer |
| Infrastructure (A16) | **Bloqué pour la production**, prêt pour staging | Authentification Drive en production non prouvée (code écrit pour Cloud Run, prod sur Render) ; base de prod sans protection (6 h de restauration) ; pas de fournisseur e-mail |
| Release Manager (A22) | Prêt (processus) / Bloqué (GO prod) | Définition de la V1 à valider ; rôle de `origin/prod` à confirmer ; pas de procédure de rollback |
| Documentation (A26) | Prêt avec réserves | README obsolète (30 migrations / 446 tests annoncés) ; runbook de migration à écrire |

## 2. Périmètre

- **V1 (livraison)** : Dispositif configurable (assistant + mode expert,
  Dispositifs par défaut), groupes et rattachement des départements,
  échelle 3/4/5/6, Risk Owner / Délégué / Exécuteur, saisie selon le mode
  avec revue Retenu / Retourné / Rejeté, Comité asynchrone, Treatment
  Decision, contributions, fenêtre de refus, notifications application +
  e-mail, import Excel d'évidences, **WebSocket-ready** (abstraction
  `RealtimeClient`, REST autoritaire, resynchronisation, événements nommés
  et versionnés).
- **V2** : WebSocket, retours du client (DECISION-020).
- **À trancher par le PO** (voir §4) : la fin de la Phase 4 (Traitement,
  Suivi, Réévaluation, Meeting — étape 18) et le Signalement confidentiel
  (B-4, dépend des juristes) sont-ils dans la V1 ou en V1.1 ?

## 3. Releases

Deux pistes tournent en parallèle dans des worktrees séparés : **piste
RM** (chemin critique) et **piste EVD** (import Excel). `server.ts`,
`permissions.ts` et les numéros de migration sont fusionnés par
l'orchestrateur. Chaque lot : code A06/A07 → QA (A08) → Security (A10) →
Compliance/Privacy selon la GRC Trigger Matrix → gate humain (§18) →
migration appliquée par le workflow `migrate.yml` après approbation HUMAN.

### R0 — Assainissement et correctifs immédiats (démarrable dès le GO)

| # | Action | Qui | Taille |
|---|---|---|---|
| R0.1 | Hygiène du suivi (étape 1) : clore OD-1/2/3/6 et CHALLENGE-001, tracer chaque attente PO | A02, A03 | S |
| R0.2 | **B-0** : `risk.owner.assign` + refus de l'auto-désignation (faille F-1 en production) ; droits SQL par HUMAN | A06 ; HUMAN | S |
| R0.3 | **Correctif import de risques** : contrôler la taille décompressée et plafonner avant chargement `exceljs` (exposé en production) | A06, A10 | S |
| R0.4 | **Suppression d'évidence** : déplacer vers le dossier Drive « supprimé » au lieu de la corbeille (DECISION-019) ; vérifier l'authentification Drive en production sur Render | A06, A16 | S |
| R0.5 | Git : back-merge `main` → `staging`, Dependabot reciblé sur `staging`, rôle de `origin/prod` confirmé | A09, A22 ; HUMAN | S |
| R0.6 | README « État actuel » et runbook de migration (avec procédure de rollback) | A26 | S |

### R1 — Fondations du Dispositif

| # | Action | Qui | Taille |
|---|---|---|---|
| R1.1 | **Étape 2** : report de DECISION-016 à 020 dans le contrat (§6, §8, §10, invariant 5), texte validé par le PO | A13 rédige, A03 relit, HUMAN valide | S |
| R1.2 | **B-8** groupes fixes (Risk Manager jamais vide, Risk Committee, Audit) + `roles.department_id`, `processes.department_id` | A06, A07 | M |
| R1.3 | **B-9** échelle 3–6 identique probabilité/axes, 7 axes, descriptif par niveau et par axe ; élargir les CHECK de `risks` | A06, A07 | M |
| R1.4 | **B-6** Dispositif `RiskFramework` versionné (paramètres, appétence et grilles, approbateur Audit/Comité, F-8) | A06, A07 | L |
| R1.5 | **B-13** Dispositifs par défaut (Prudent / Standard / Léger, contenu A13) | A06, A13 | S |
| R1.6 | **B-11** canal e-mail des notifications (parallèle) | A06, A09, A16 | S/M |
| R1.7 | **Étape 4 — maquette** (parallèle dès R1.1) : À faire, assistant du Dispositif, Dispositifs par défaut, évaluation unique, fenêtre de refus, assistant d'import | A04 ; A13, A05 ; GO PO | M |

### R2 — Rôles, saisie et validation

| # | Action | Qui | Taille |
|---|---|---|---|
| R2.1 | **B-5** désignation RO / DEL / EXEC (circuit propose/approve, auto-proposition paramétrable) | A06, A07 | L |
| R2.2 | **Fenêtre de refus DECISION-011** : cadrage, revue Security + Privacy (liste fermée, permissions sensibles exclues), code ; la 403 porte la permission manquante | A05, A10, A24, A06 | S/M |
| R2.3 | **B-2** Hybride, retrait de `process.evaluationmode.set` | A06 | S |
| R2.4 | **B-1** saisie selon le mode, validateur hors de tous les auteurs (F-12), règle P5 | A06, A07, A08 | L |
| R2.5 | **B-10** revue de l'Inhérent : Retenu / Retourné / Rejeté | A06 | M |
| R2.6 | **B-12** Comité asynchrone (quorum, échéance, escalade, jamais de validation tacite — F-14) | A06, A07 | M |
| R2.7 | **B-7** Treatment Decision enregistrée par RO/DEL | A06 | S |
| R2.8 | Données de base saisies par HUMAN avant déploiement (Processus avec RO, contrôles avec EXEC relié — OD-8) | HUMAN | — |

### R3 — Écrans et contributions

| # | Action | Qui | Taille |
|---|---|---|---|
| R3.1 | **F-3** assistant pas à pas + mode expert | Dev Frontend | M/L |
| R3.2 | **F-1** contexte, mode effectif, provenance, badges de cumul, fenêtre de refus, file « À faire » | Dev Frontend | M |
| R3.3 | **B-3 puis F-2** contributions (bloqué par OD-4) | A06, A07, Dev Frontend | M/L |
| R3.4 | **WebSocket-ready** : `RealtimeClient` (stub), resynchronisation REST, événements nommés et versionnés | A05, Dev Frontend, A06 | S |

### Piste EVD — Import Excel d'évidences (parallèle à R1–R3)

| # | Action | Qui | Taille |
|---|---|---|---|
| E.0 | **EVD-S** stockage configurable derrière `DocumentStorage` (dossiers Drive actif/supprimé, `getContent`, choix par configuration) | A06, A07 | S |
| E.1 | **EVD-1** socle preuve : SHA-256, doublon, `evidence.download`, audit des téléchargements, déclaration de données personnelles, dataset confidentiel | A06, A07, A24 | S/M |
| E.2 | **EVD-2** analyse et récapitulatif modifiable (feuilles, lignes, colonnes, types ; vides tolérés) | A06 | S |
| E.3 | **EVD-3** dataset et versions de schéma, champs standard + champs créés, clé facultative configurable | A06, A07 | M |
| E.4 | **EVD-4** import des seules sélections validées, masquage X/*, lineage | A06, A07, A24, A14 | M |
| E.5 | **EVD-5** assistant d'import (écran) | Dev Frontend, A04 | M |

### R4 — Signalement confidentiel (dès l'avis des juristes)

| # | Action | Qui | Taille |
|---|---|---|---|
| R4.1 | PRIVACY_ASSESSMENT, décision DPIA, avis juristes (loi 2013-450 / ARTCI, BCEAO, CENTIF) | A24, A14, juristes Djamo | — |
| R4.2 | **B-4** signalement confidentiel ou nominatif (identité hors `audit_log`, pas d'IP dans les logs) | A06, A07 | L |

### R5 — Recette et mise en production

| # | Action | Qui | Taille |
|---|---|---|---|
| R5.1 | Décisions d'infrastructure : région Neon vs Render, plan Render payant, protection et rétention de la base de production, fournisseur e-mail, identité Drive | HUMAN, A16 | M |
| R5.2 | Tests : intégration Postgres en CI ou sur Neon staging, tests des invariants §10, smoke staging | A08, A09 | M |
| R5.3 | Phase 7 : QA fonctionnelle et UX, campagne de tests de sécurité de l'audit externe, passages Compliance/Privacy finaux | A08, A10, A14, A24, A23 | L |
| R5.4 | Recette métier sur des risques réels de Djamo, GO PO | A13 ; testeurs désignés ; HUMAN | M |
| R5.5 | Promotion `staging` → `main`, migrations par workflow approuvé, procédure de rollback, surveillance | A22, A09, HUMAN | M |
| R5.6 | Guides utilisateur (Dispositif, import Excel) et administrateur, notes de version | A26 | M |

**Critères de GO production** (Release Manager) : tous les gates de lot
tracés ; QA, Security, Compliance et Privacy passés ; aucun bloqueur
Security ouvert ; recette métier validée ; infrastructure tranchée
(région, plan, sauvegardes) ; rollback décrit ; smoke test et
surveillance en place ; GO PO explicite.

## 4. Ce que le PO doit fournir pour le GO

1. **GO explicite** de lancement de R0 (et de R1.1 / R1.7).
2. **Périmètre V1** : inclure ou non l'étape 18 (Traitement, Suivi,
   Réévaluation, Meeting) et B-4 ; inclure la piste EVD (recommandé : oui).
3. **Masquage** : à l'enregistrement (recommandé) ou seulement à
   l'affichage.
4. **OD-4** : qui statue sur une contribution (bloque B-3).
5. **Comité asynchrone** : valider les défauts du Risk Manager et ses 3
   questions (quorum de 2, responsable risque membre, rétractation).
6. **Exception du risque Security** sur l'import de risques actuel :
   correctif R0.3 (recommandé) — à confirmer.
7. **Accès** : Penpot pour l'UX ; IDs des deux dossiers Drive par
   environnement ; fournisseur e-mail.
8. **Personnes** : testeurs de la recette métier ; propriétaire du runbook
   de migration ; juristes saisis pour B-4, conservation et localisation.
9. **Infrastructure** (R5.1) : à décider avant la mise en production, pas
   avant le démarrage.
