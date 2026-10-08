-- Rollback of 046_treatment_decisions.sql. Drops the whole table (its
-- CHECK constraints and indexes go with it).
--
-- Destructive: supprime tout l'historique des décisions de traitement
-- (toutes les propositions, confirmations, invalidations et validations
-- Comité). Non destructif pour `risk_evaluations`/`risks` (aucune FK
-- entrante depuis ces tables vers `treatment_decisions`). Vérifier
-- avant d'exécuter en environnement partagé.

DROP TABLE treatment_decisions;

DELETE FROM schema_migrations WHERE filename = '046_treatment_decisions.sql';
