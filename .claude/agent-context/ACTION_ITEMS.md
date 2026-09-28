# Items en attente d'action — GRC Tools

Table vivante. Ne pas supprimer une ligne résolue — passer son statut à
`Résolu` avec la date et le lien commit/PR. Voir README.md de ce dossier
pour l'usage.

| Agent | Item | Depuis | Statut |
|---|---|---|---|
| @qa-engineer | Revue QA indépendante des 9 modules livrés (batches 1-3). | 2026-09-27 | Résolu — 10 findings (branche `qa/batches-1-3-review`, commit `f045e3a`), 6 corrigés directement (nouveaux tests), le reste (RiskService.escalate sans maker-checker, etc.) reste à trier — voir `backend/QA_REVIEW_BATCHES_1_3.md`. |
| @security | Repasser une revue sécurité sur les 9 modules livrés. | 2026-09-27 | Résolu (revue faite) mais **6 nouveaux findings à corriger** : SEC-009/010 (High), SEC-011/012 (Medium), SEC-013/014 (Low) — branche `security/review-round-2`, commit `710ca5e`. SEC-009 et SEC-013/014 sont des régressions de règles jamais écrites dans CLAUDE.md — corrigé dans PR #11. **À corriger un par un, priorité SEC-009/010 en premier.** |
| @dev-backend | Batch 4 : Dashboard+Reporting ✅ (278 tests), Notification+Governance ✅ (308 tests), Config en cours. | 2026-09-27 | Presque résolu — reste à fusionner + câbler `server.ts` une fois Config terminé. |
| @privacy | Nouveau finding sécurité (informationnel) : `RiskOwnershipService.listOwners` expose le nom/email d'un utilisateur **suspendu** à tout détenteur de `risk.read` (via `PostgresUserRepository.getById` qui ne filtre pas `deleted_at`, correct pour son usage principal mais pas ici). | 2026-09-27 | Ouvert |
| @risk-manager | Valider ou challenger la méthodologie de scoring : RatingScale (7 axes, règle MAX, moyenne de maîtrise L1/L2/L3), RiskEvaluation (P×I, comparaison à l'appétence), KRI (seuils Vert/Orange/Rouge en bornes numériques simples). | 2026-09-27 | Ouvert |
| @architect | Formaliser/valider a posteriori les 3 conventions transverses adoptées ad hoc (permissions terminales séparées, pattern paramètre optionnel, isolation worktree par défaut). | 2026-09-27 | Ouvert |
| @dev-db | Cross-review des 9 migrations déjà écrites par A06 sans spawn (016 à 022), pour constituer le track record avant de figer la règle "pas de spawn pour les cas simples". | 2026-09-27 | Ouvert |
| @audit | Vérifier la conformité append-only/soft-delete/tenant_id sur les 9 modules livrés, en complément de la revue sécurité. | 2026-09-27 | Ouvert |
| @compliance | Cadrer réellement l'exigence de purge RGPD de l'audit trail (ACT-072), actuellement "Post-MVP" sans étude. | 2026-09-27 | Ouvert |
| @privacy | Première revue : UserManagement et RiskOwnership manipulent désormais de vraies données utilisateur (email, nom, qui possède quel risque). | 2026-09-27 | Ouvert |
| @ux-designer | Connecter le compte Figma dès qu'un lien de fichier est fourni par le Product Owner ; statuer sur la charte graphique de l'outil (aucune direction Djamo confirmée à ce jour). | 2026-09-27 | Ouvert |
| @product-manager | Valider a posteriori la priorisation des 3 batches déjà livrés, ou ajuster la suite du backlog (Dashboard, Config, Reporting, Notification, JournalGlobal, Governance restent à 0 %). | 2026-09-27 | Ouvert |
| @documentation | Reprendre la main sur `RETEX_MULTI_AGENTS.md` à partir de maintenant — l'orchestrateur ne l'édite plus directement. | 2026-09-27 | Ouvert |
