-- F-B6a-11 — search_path fixé sur toutes les fonctions de trigger du Dispositif de risque (055/056/057).
--
-- Pourquoi : ces fonctions lisent des tables non qualifiées sans search_path fixé. pg_temp est cherché en premier
-- pour les relations et grc_app_runtime a TEMP par défaut : une table temporaire homonyme (risk_framework_change_requests,
-- users, ...) masquait la vraie table et contournait les gardes. pg_temp est placé EN DERNIER (A10 : sans cela
-- l'attaque passe encore). Pas de REVOKE TEMP ici (infra, hors périmètre).
--
-- Ordre : 058 passe après tous les CREATE OR REPLACE de 055/056/057 ; un CREATE OR REPLACE ultérieur d'une de ces
-- fonctions DOIT répéter SET search_path = pg_catalog, public, pg_temp (sinon le réglage est perdu).
-- Idempotente (ALTER FUNCTION ... SET). Aucune donnée touchée.

ALTER FUNCTION risk_framework_truncate_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION risk_framework_versions_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION risk_framework_change_requests_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION rating_scales_framework_freeze() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION risk_framework_versions_insert_guard() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION risk_framework_change_requests_insert_guard() SET search_path = pg_catalog, public, pg_temp;
