-- 094 — q253 A (DECISION-121, PRIV-V5-02) : une personne ajoutée nommément à un dossier restreint au PÉRIMÈTRE reçoit la règle
-- de 087 (q225 A) : accès de 30 jours au plus, renouvelable avec motif, fin à la clôture du dossier.
-- Le mécanisme de 087 ne change pas (colonne expires_at, garde, visibility_granted, visibility_resource_closed) : aucune fonction
-- redéfinie pour le mécanisme lui-même (sauf visibility_granted, voir la fin). Le code pose désormais l'échéance sur tout dossier non CLIENT (stampNamedExpiry).
-- Données : comme 087 pour ses accès existants, les accès vivants sans échéance d'un dossier PERIMETRE reçoivent une échéance à
-- 30 jours à compter de cette migration (jamais de révocation immédiate). Idempotente : l'UPDATE ne touche que les lignes sans
-- échéance. Jamais à la main : `npm run migrate`.

UPDATE resource_access_grants g SET expires_at = now() + interval '30 days'
WHERE g.revoked_at IS NULL AND g.expires_at IS NULL AND CASE g.resource_type
  WHEN 'RISK' THEN EXISTS (SELECT 1 FROM risks x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'PERIMETRE')
  WHEN 'CONTROL' THEN EXISTS (SELECT 1 FROM controls x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'PERIMETRE')
  WHEN 'ANOMALY' THEN EXISTS (SELECT 1 FROM anomalies x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'PERIMETRE')
  WHEN 'ACTION_PLAN' THEN EXISTS (SELECT 1 FROM action_plans x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'PERIMETRE')
  WHEN 'KPI' THEN EXISTS (SELECT 1 FROM kpis x WHERE x.tenant_id = g.tenant_id AND x.id = g.resource_id AND x.visibility = 'PERIMETRE')
  ELSE false END;

-- SEC-Q253-01 : visibility_granted échoue fermé sur tout accès non daté d'un dossier restreint (NOMINATIF ou PERIMETRE) : un accès
-- sans échéance ne compte plus que sur un dossier CLIENT. Couvre l'écriture SQL directe et la fenêtre où 094 passe avant le nouveau
-- code. Définition de 087 reprise en entier, seule la condition change (<> 'NOMINATIF' devient = 'CLIENT').
CREATE OR REPLACE FUNCTION visibility_granted(p_tenant uuid, p_type text, p_id uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM resource_access_grants g
                 WHERE g.tenant_id = p_tenant AND g.resource_type = p_type AND g.resource_id = p_id
                   AND g.user_id = p_user AND g.revoked_at IS NULL
                   AND (CASE WHEN g.expires_at IS NULL THEN visibility_own_level(p_tenant, p_type, p_id) = 'CLIENT'
                             ELSE g.expires_at > now() AND NOT visibility_resource_closed(p_tenant, p_type, p_id) END));
$$;
ALTER FUNCTION visibility_granted(uuid, text, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
