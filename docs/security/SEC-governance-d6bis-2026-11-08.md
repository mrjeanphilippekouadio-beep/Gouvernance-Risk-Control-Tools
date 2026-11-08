# Revue Sécurité A10 — lot D6bis : seuils du panneau, ALLOWED_BY_SETTING, DECISION-061 (2026-11-08)

- Cible : `git diff origin/staging...origin/feat/r1-governance-d6bis` (staging `d10b07f`, HEAD `368937a`), migration 086.
- Méthode : analyse statique ; `npx vitest run` de `governance-health` et `ConfigService` (37 verts, 2 ignorés car il faut une base) ; `tsc --noEmit` propre. Aucun code modifié.

**Escalade HUMAN : aucune** (CVSS maximal 2,7). **Verdict : VERT avec réserves.** Le circuit des seuils est correct. Mais le nouveau statut ALLOWED_BY_SETTING crée un second levier, non protégé, pour faire taire une alerte (D6B-01). Son exception « a validé ses propres saisies » repose sur des listes tronquées (D6B-02).

## 1. Ce qui tient : PASS

| Point | Résultat |
|---|---|
| Qui règle les seuils | `config.governancedelays.set` (administration), via `setGovernanceDelays`. Relever un seuil (`next > current ?? défaut`, donc moins d'alertes) est un assouplissement : seconde personne q182 (`config.selfvalidation.approve`), ou `adminAlone` marqué et visible dans le panneau s'il n'y a pas d'approbateur. Abaisser reste direct. Les bornes A13 sont vérifiées dans la route, le service et les CHECK de 086 ; jamais NULL ; audit avant/après + motif. **Un admin seul ne peut pas relever un seuil sans trace marquée.** |
| Tenant | Les 5 nouvelles requêtes (statistiques de risques, comptes par propriétaire, créateur lu dans `audit_log` CREATE, dernier réglage du cumul, seuils) filtrent `tenant_id = $1`, sous-requête de l'audit comprise. |
| Identité | Offenders USER (RISK-01 part du RM, ACC-01(c) dormants, SOD-04 cumul) : « Personne N » sans `audit.read`. L'auteur du réglage du cumul est un uuid dans `detail`, remplacé par le pseudonyme (ou par le nom pour l'Audit). Aucune date de dernière activité n'est renvoyée : seulement « sans activité depuis plus de N jours ». |
| Ressources restreintes | Les nouveaux détecteurs ne renvoient que des parts et des comptes, jamais un id ni un libellé de risque. OWN-01(d) lit l'auteur de l'entrée CREATE sans rien en restituer. |
| 086 | Ni fonction ni trigger : `search_path` sans objet. CHECK de bornes, idempotente. Le down retire les 6 colonnes et remet le défaut `true` sans toucher aux lignes. |
| DECISION-061 | Aucun UPDATE ; seul le DEFAULT des nouvelles lignes change. `RoleService` ne bloque que les **futures** affectations. Aucun code ne retire un cumul existant. **Rien n'est révoqué en silence.** (Voir D6B-03 pour les clients sans ligne `configs`.) |

## 2. Constats

### D6B-01 — Un administrateur seul fait passer GOV-SOD-04 en ALLOWED_BY_SETTING (LOW, CVSS 2,7 `AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N`, CONFIRMED par lecture)

- `setCommitteeAuditCumul` (`config.cumul.set`, permission d'administration) s'applique directement : motif et audit, mais ni seconde personne ni marqueur. Avant D6bis, un cumul autorisé restait une alerte NOT_RESPECTED annotée. Depuis q234 C, autoriser le cumul sort le principe des alertes.
- C'est exactement « relever un seuil = moins d'alertes », que q233 soumet à une seconde personne : la règle est contournée par ce paramètre voisin. L'effet reste visible (personnes listées, auteur et date du réglage), d'où LOW.
- **Correctif attendu (A06)** : faire passer `false → true` par le circuit q182 (seconde personne, ou `adminAlone` marqué + notification). `true → false` reste direct. À défaut, ne donner ALLOWED_BY_SETTING que si le dernier réglage a été approuvé par une seconde personne.

### D6B-02 — L'exception « a validé ses propres saisies » se calcule sur des listes tronquées à 50 (LOW, CVSS 2,2 `AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N`, CONFIRMED par lecture)

- `selfValidators` vient de `markedActions` et `selfValidatedUnmarked`, tous deux limités par `HEALTH_LIST_LIMIT` (50 plus récents). Un membre Comité + Audit dont les auto-validations sont plus anciennes que les 50 dernières lignes est classé « autorisé par le paramètre ». Si tous le sont, le principe passe ALLOWED_BY_SETTING à tort.
- **Correctif attendu (A06)** : une requête dédiée, tenant-scopée depuis `trackedSince`, qui donne les `user_id` distincts auteurs d'une auto-validation, marquée ou non. Ne pas réutiliser les listes d'affichage. Test : 51 auto-validations récentes d'autrui + 1 ancienne du cumulard → NOT_RESPECTED.

### D6B-03 — Client sans ligne `configs` : le cumul est autorisé à l'application mais affiché « interdit » ; la première sauvegarde d'un autre réglage l'interdit sans le dire (LOW, CVSS 2,2, CONFIRMED par lecture)

- `RoleService` fait `if (cfg && !cfg.committeeAuditCumulAllowed)` : sans ligne, le cumul est accepté. `ConfigService.defaultConfig` (désormais `false`) et le panneau (`config` null, donc non autorisé) disent l'inverse.
- Le premier `upsertConfigRow` déclenché par n'importe quel autre réglage crée la ligne avec le DEFAULT `false` : le comportement change sans action sur ce paramètre. Rien n'est retiré (seules les nouvelles affectations sont refusées), mais le changement est silencieux, et pendant ce temps le contrôle affiché n'est pas le contrôle appliqué.
- **Correctif attendu (A06/A07)** : un seul comportement. Soit 086 crée une ligne explicite pour chaque client qui n'en a pas, avec la valeur effectivement appliquée jusqu'ici (`true`), puis `RoleService` échoue fermé (`!cfg?.committeeAuditCumulAllowed`). Soit le défaut affiché suit la règle appliquée. À vérifier : Djamo a-t-il une ligne `configs` ?

### INFO

- Les parts et comptes RISK-01, OWN-01(d) et « Échantillon insuffisant : N risque(s) » sont calculés sur **tous** les risques vivants, restreints compris. Un administrateur hors groupes fixes peut en déduire le nombre de risques qu'il ne voit pas, NOMINATIF compris. C'est la même classe que l'INFO HUMAN « A1 contre q228 » (A1 lui donne déjà la liste). À trancher au même endroit.
- ACC-01(c) : abaisser `govDormantDays` est direct (45 à 180). En le faisant varier, un administrateur peut encadrer, à quelques jours près, l'inactivité d'un compte à privilèges désigné par pseudonyme. C'est grossier, limité aux comptes à privilèges, et chaque changement est audité. Acceptable, à noter pour Privacy (q156).
- La date du réglage du cumul est associée à un pseudonyme ; elle n'est qu'en clair (avec le nom) pour l'Audit.

| Constat | Sévérité | Owner | Statut |
|---|---|---|---|
| D6B-01 | LOW 2,7 | A06 | REMEDIATION_REQUIRED |
| D6B-02 | LOW 2,2 | A06 | REMEDIATION_REQUIRED |
| D6B-03 | LOW 2,2 | A06/A07 (+ état de Djamo) | REMEDIATION_REQUIRED |
| INFO | — | HUMAN / Privacy | Ouverts |
