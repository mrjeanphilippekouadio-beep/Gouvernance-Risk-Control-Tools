-- 094 — q253 A (DECISION-121, PRIV-V5-02) : une personne ajoutée nommément à un dossier restreint au PÉRIMÈTRE reçoit la règle
-- de 087 (q225 A) : accès de 30 jours au plus, renouvelable avec motif, fin à la clôture du dossier.
-- Le mécanisme de 087 ne change pas (colonne expires_at, garde, visibility_granted, visibility_resource_closed) : aucune fonction
-- redéfinie ici. Le code pose désormais l'échéance sur tout dossier non CLIENT (stampNamedExpiry).
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
