# Revue Security A10 — correctifs Codex PR #186 (2026-10-18)

Base : branche `claude/grc-tools-orchestrator-handoff-epk0y5`, HEAD `e7a41c0`. Commits revus : `8f03826` (migration 063), `60f7757` (FrameworksPage, seuils d'appétence d'un brouillon).
Méthode : revue statique, plus un PoC de concurrence sur Postgres local (clone `grc_qa_a10_m063` de `grc_qa_a10`, 063 appliquée, puis supprimé). Aucune base Neon touchée.

**Escalade HUMAN : aucune** (CVSS max 2,2).
**Verdict : PASS** sur les deux points, avec 4 constats INFO/LOW non bloquants.

## 1. Migration 063 (`database/postgresql/migrations/063_rating_scale_delete_race.sql`)

Ce qui est vérifié et tient :
- search_path : `pg_catalog, public, pg_temp`, déclaré dans la fonction ET par `ALTER FUNCTION`, sur les deux fonctions. En base, `proconfig` est correct, `prosecdef = f` (pas de SECURITY DEFINER), fonctions VOLATILE.
- tenant_id : présent sur les deux lectures (`s.tenant_id = NEW.tenant_id` ; `v.tenant_id = OLD.tenant_id`).
- Privilèges : `FOR SHARE` exige UPDATE sur `rating_scales`, que `grc_app_runtime` a déjà (043).
- Fuite d'information : les exceptions (23514/23503) ne sont pas traduites et tombent dans le 500 générique de `errorHandler.ts`. L'id de l'échelle n'apparaît que dans le log serveur, et c'est un id que l'auteur a lui-même fourni. Aucune fuite côté client.
- Cohérence avec 055 : le gel de 055 couvre les versions non-brouillon, 063 couvre tout le reste (brouillons et archivées). Les deux triggers s'additionnent sans conflit. Le contrôle applicatif `isReferencedByFrameworkVersion` applique la même règle (toutes versions, tenant), donc la règle est la même partout.
- Verrou : `FOR SHARE` est tenu seulement pendant la transaction courte de `updateDraft` (UPDATE plus audit). Aucun chemin HTTP ne permet de garder une transaction ouverte, et il n'y a pas de cycle de verrous (le côté suppression lit les versions sans les verrouiller). Pas de déni de service exploitable.

PoC (READ COMMITTED, le mode de l'application) :

| Cas | Résultat |
|---|---|
| R1 : la version pose son verrou d'abord, la suppression arrive ensuite | suppression refusée (`rating_scales_delete_guard`) |
| R2 : la suppression arrive d'abord, la version ensuite | version refusée (`risk_framework_versions_scale_alive`) |
| R3 : une version qui cible l'échelle d'un autre tenant | refusée |
| R5 : tables temporaires `rating_scales`/`risk_framework_versions` et `search_path=pg_temp,public` | garde appliquée, suppression refusée |

Constats :
- **F-063-01 INFO (CVSS 0, chemin non atteignable aujourd'hui)** : en REPEATABLE READ, la course revient. Le cas R4 (suppression en RR avec un instantané pris avant le commit du brouillon) a été rejoué : l'échelle est supprimée alors qu'un brouillon la référence. Aucun code de `backend/src` ne change le niveau d'isolation, donc l'application n'est pas exposée. Il reste le SQL direct ou un futur code. Recommandation (A07, optionnelle) : documenter dans la migration que la garde suppose READ COMMITTED, ou poser aussi `FOR SHARE` côté suppression sur les versions.
- **F-063-02 INFO** : quand la course est perdue, le client reçoit un 500 générique et non un 400/409. Côté sécurité c'est correct, mais l'expérience est mauvaise. Recommandation (A06) : traduire 23503/23514 de ces deux triggers en ValidationError.
- **F-063-03 INFO (fonctionnel, pour le PO / Risk Manager)** : la garde compte aussi les brouillons écartés (ARCHIVED). Une échelle qu'un brouillon jeté a référencée une seule fois ne pourra donc plus jamais être désactivée. L'acteur concerné est un Risk Manager autorisé, il n'y a pas d'élévation de privilège. C'est un choix de règle à confirmer.

## 2. Frontend : seuils d'appétence d'un brouillon (`frontend/src/features/frameworks/FrameworksPage.tsx`)

La route réelle est `PATCH /api/v1/risk-frameworks/:id/versions/:vid` (et non PUT), dans `backend/src/api/v1/riskFrameworks.routes.ts`. Ce qui est vérifié côté serveur :
- Permission : `riskframework.update` plus appartenance au groupe Risk Manager (`assertRiskManager`).
- Validation : `PatchVersionBody` est `.strict()`, `appetiteThresholds` passe par `boundedArray(AppetiteEntry, 200)`, et `AppetiteEntry` est `.strict()` avec des chaînes bornées et un seuil entier entre 1 et 36.
- DRAFT exigé à deux endroits : `assertDraft` dans le service, et `AND status = 'DRAFT'` dans l'UPDATE du repository. L'UPDATE est tenant-scopé.
- Doublons et normalisation : vérifiés dans `normalizeAppetite`. Le plafond n² est vérifié à la demande d'activation.
- `subCategoryId` est vérifié par tenant (`assertSubCategories`), donc pas d'IDOR inter-tenant.
- Aucun champ d'attribution n'est accepté du client. `last_edited_by` vient de `actor.userId`, et l'audit est pris dans la transaction.
- L'écran ne recalcule aucune règle métier : il ne fait que détecter un changement (comparaison JSON). `min`/`max`/`required` sont de simples aides de saisie, le serveur fait la vraie validation. Une saisie vide donne `Number("") = 0`, que le serveur refuse avec un 400.

Constat :
- **F-FW-01 LOW 2,2** (AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N, préexistant, mis en évidence par l'écran) : rien ne vérifie que `subCategory` (libellé libre) correspond bien à `subCategoryId`, ni que l'id désigne une sous-catégorie plutôt qu'une catégorie racine. Un Risk Manager peut ainsi afficher « Fraude » sur le seuil d'une autre sous-catégorie. L'impact se limite à l'intégrité, et l'auteur doit déjà avoir le droit d'écrire. Recommandation (A06) : dériver le libellé de l'id côté serveur quand l'id est fourni. Note annexe : `assertSubCategories` fait jusqu'à 200 requêtes séquentielles, ce qui est négligeable pour un acteur PR:H.

## Suivi (règle 7bis)
- F-063-02, F-FW-01 : A06 (non bloquant).
- F-063-01 : A07 (documentation, optionnelle).
- F-063-03 : décision PO / Risk Manager.

## Addendum : commits 679930f et 6cb0b67 (revue statique, tsc OK, `test/ScaleDeleteRaceMessages.test.ts` 2/2)

- **679930f, F-063-02 → RETEST_PASS.** `mapPgError` traduit 23514 en ValidationError (400) seulement si le message commence par `risk_framework_versions: rating scale`. `softDelete` fait de même pour 23503 avec `rating_scales: this scale is referenced`. Les messages sont en français et ne contiennent aucun identifiant. Comme le filtre exige ce préfixe, une vraie violation CHECK/FK, ou une erreur 42501 de privilège, reste en 500 générique : aucune erreur réelle n'est masquée. La traduction a lieu après le ROLLBACK de la transaction (l'audit est annulé avec elle). Le message révèle qu'un brouillon concurrent existe, mais l'appelant (`ratingscale.delete`) peut déjà le lire : pas de fuite. Il reste une réserve INFO : la branche 23503 de `softDelete` n'a pas de test (seul `mapPgError` est testé) ; à confier à A08.
- **6cb0b67 : sans effet sur la sécurité.** La comparaison champ par champ ne sert qu'à décider si `appetiteThresholds` est envoyé. Toute la validation reste côté serveur. Écart fonctionnel possible, sans enjeu de sécurité : l'entité saisie n'est pas trimée alors que le serveur la trime, donc un renvoi inutile peut avoir lieu.
- Le verdict reste **PASS**, sans escalade HUMAN. Constats encore ouverts : F-063-01 (INFO, A07), F-063-03 (décision PO), F-FW-01 (LOW 2,2, A06), plus le test manquant du 23503 de `softDelete` (INFO, A08).
