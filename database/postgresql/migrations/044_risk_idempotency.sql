-- Idempotency for risk creation.
-- A client reusing the same Idempotency-Key for the same tenant receives
-- the original risk instead of creating a second resource.
ALTER TABLE public.risks
  ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX risks_tenant_idempotency_key_uq
  ON public.risks (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
