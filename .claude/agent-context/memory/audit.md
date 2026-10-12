# Mémoire — A23 Audit & Observability (rôle `audit`)

Créée le 2026-10-12 (absente jusqu'ici). Lue en premier à chaque dispatch.

## Principes permanents

- Je produis la trace, la corrélation et la preuve technique. Je ne conclus jamais
  (pas d'« audit conclusion », « opinion » ou « assurance »). L'Auditeur conclut.
- Une mutation sensible doit laisser : acteur (`actor.userId`), tenant
  (`actor.tenantId`), action, entité, ancienne/nouvelle valeur utile, motif si
  exigé, `requestId`. L'audit est écrit dans la transaction de l'action (q90,
  étendu à toutes les actions du Dispositif). Hors Dispositif, c'est un gap connu.
- `audit_log` est append-only : `insertAuditEvent` uniquement, triggers 038.
  Aucun UPDATE/DELETE, jamais.
- Un refus significatif (maker-checker, cumul interdit, réactivation refusée,
  accès refusé) est un événement à part entière. Il doit être tracé.
- Je ne corrige pas le code. Je produis des constats `AUD-<LOT>-NN` avec
  sévérité, preuve `fichier:ligne`, correctif proposé et owner.

## Positions et constats passés

- DECISION-044 (revue `docs/audit/A23-review-DECISION-044.md`, commit sur
  `wt/audit-d044`, base `0dc6bda`) : 14 constats (0 HIGH, 8 MEDIUM, 6 LOW).
  Principaux : transitions de version et effets de bord non journalisés sur leur
  entité (AUD-D044-01) ; `oldValue` de l'approbation décrit une autre version
  (02) ; `oldValue` lu hors verrou (03) ; refus du Dispositif et refus RBAC
  (q94, réactivation) non tracés (04, 07) ; audit RBAC hors transaction (08) ;
  marquage admin + Comité non exploitable par type (06) ; opt-outs historiques
  neutralisés sans trace, décision de gouvernance à confirmer par A14/A15 (12).
- Point conforme noté : `create` écrit deux événements avec le même `requestId`,
  ce qui permet la corrélation. Ce n'est pas un défaut.
- `audit_log_append_only_guard` (migration 038) n'a pas de `SET search_path`
  (convention CLAUDE.md). La migration 058 ne couvre que les fonctions Dispositif.
  Prochain numéro de migration : 059 (à vérifier au moment de l'écriture).

## Faits de contexte

- Les tests `cd backend && npm test` passent (97 fichiers, 1755 tests) au
  commit `0dc6bda`. Il faut `npm ci` dans `backend/` avant le premier lancement
  dans un worktree neuf.
- Les worktrees ne sont pas toujours sur la base attendue : vérifier
  `git rev-parse HEAD` avant toute revue.
- Commandes `git` avec substitution de variable refusées par l'isolation de
  worktree : écrire les chemins en dur.

## Rappels de méthode

- Lire la décision source (ACTION_ITEMS « Decision Log ») et la section
  « Domaine Audit » de CLAUDE.md avant de revoir.
- Pour chaque mutation : vérifier chemin transactionnel ET chemin faux-repository
  (double écriture, écriture avant action).
- Les lignes de preuve doivent être vérifiées sur le commit revu, pas sur un
  autre worktree.
