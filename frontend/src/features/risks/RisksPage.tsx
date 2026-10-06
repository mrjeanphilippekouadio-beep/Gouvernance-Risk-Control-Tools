import { useEffect, useMemo, useState, type FormEvent } from "react";
import { risksApi, type Risk, type RiskStatus } from "../../api/risks";
import { departmentsApi, type DepartmentSummary } from "../../api/departments";
import { usersApi, type UserSummary } from "../../api/users";
import { ApiError } from "../../api/client";
import {
  Button,
  FormField,
  MessageBanner,
  Modal,
  SegmentedControl,
  StatusBadge,
  Table,
  type StatusTone,
} from "@djamo/design-system";
import { RaciPanel } from "../../design-system";
import "../core/CorePages.css";
import "./RisksPage.css";

interface RisksPageProps {
  /** Google ID token — see AuthContext TODO in App.tsx. */
  token: string;
  onEvaluate?: (riskId: string) => void;
}

type OwnerFilter = "ALL" | "MINE";

const STATUS_LABELS: Record<RiskStatus, string> = {
  DRAFT: "Brouillon",
  ACTIVE: "Actif",
  ARCHIVED: "Archivé",
};

const STATUS_TONES: Record<RiskStatus, StatusTone> = {
  DRAFT: "warning",
  ACTIVE: "success",
  ARCHIVED: "neutral",
};

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.requestId ? ` (réf. ${err.requestId})` : ""}`;
  }
  return "Une erreur inattendue est survenue.";
}

/**
 * Registre des risques — vue de gestion du portefeuille des risques
 * identifiés (identification, Risk Owner, statut). La cotation
 * (Inhérent/Maîtrise/Résiduel) et son historique de cycles vivent sur la
 * fiche d'Évaluation (Lot 1, EvaluationPage) — pas dupliqués ici, seulement
 * liés via l'action "Évaluer". La Cartographie reste la vue de synthèse de
 * pilotage et n'est pas affectée par ce lot (RISK_MANAGEMENT_V1_FINAL_
 * DECISIONS.md §3).
 *
 * Pure presentation + API calls. No scoring, no transition rules, no
 * permission checks here — the backend owns all of that (ADR-001).
 */
export function RisksPage({ token, onEvaluate }: RisksPageProps) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("ALL");

  // Identification context (§4) — Risk Owner / department directories.
  // GET /users and /departments both require admin-level read permissions
  // most Risk Owners won't carry — a 403 degrades to showing the raw id,
  // never a fatal error (same posture as RaciPanel/EvaluationPage).
  const [userDirectory, setUserDirectory] = useState<UserSummary[] | null>(null);
  const [departmentDirectory, setDepartmentDirectory] = useState<DepartmentSummary[] | null>(null);

  const [process, setProcess] = useState("");
  const [description, setDescription] = useState("");
  const [ownerDepartmentId, setOwnerDepartmentId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState(() => crypto.randomUUID());

  // No detail/edit screen exists yet for a risk — RACI is exposed as a
  // per-row toggle rather than a new route (DESIGN_NOTES.md: don't build
  // a screen ahead of one being needed elsewhere).
  const [raciRiskId, setRaciRiskId] = useState<string | null>(null);

  // ACT-120/121/122: owner + superior owner (N+1) assignment, one modal
  // combining both — never folded into the generic update (RiskService).
  const [ownerModalRisk, setOwnerModalRisk] = useState<Risk | null>(null);
  const [ownerDraft, setOwnerDraft] = useState("");
  const [superiorDraft, setSuperiorDraft] = useState("");
  const [savingOwner, setSavingOwner] = useState(false);
  const [ownerModalError, setOwnerModalError] = useState<string | null>(null);

  // Terminal transition — mandatory reason, dedicated endpoint (never the
  // generic PATCH status, which the backend now rejects for ARCHIVED).
  const [archiveTarget, setArchiveTarget] = useState<Risk | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiving, setArchiving] = useState(false);

  const userById = useMemo(
    () => Object.fromEntries((userDirectory ?? []).map((u) => [u.id, u])),
    [userDirectory],
  );
  const departmentById = useMemo(
    () => Object.fromEntries((departmentDirectory ?? []).map((d) => [d.id, d])),
    [departmentDirectory],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setRisks(await risksApi.list(token, includeArchived, ownerFilter === "MINE" ? "me" : undefined));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, includeArchived, ownerFilter]);

  useEffect(() => {
    usersApi.list(token).then(setUserDirectory).catch(() => setUserDirectory(null));
    departmentsApi.list(token).then(setDepartmentDirectory).catch(() => setDepartmentDirectory(null));
  }, [token]);

  const activeCount = useMemo(() => risks.filter((r) => r.status === "ACTIVE").length, [risks]);
  const draftCount = useMemo(() => risks.filter((r) => r.status === "DRAFT").length, [risks]);
  const unassignedCount = useMemo(
    () => risks.filter((r) => r.status !== "ARCHIVED" && !r.ownerId).length,
    [risks],
  );

  function ownerLabel(ownerId: string | null): string {
    if (!ownerId) return "Non assigné";
    return userById[ownerId]?.displayName ?? ownerId;
  }

  function departmentLabel(departmentId: string | null): string {
    if (!departmentId) return "Non assigné";
    return departmentById[departmentId]?.name ?? departmentId;
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await risksApi.create(
        token,
        { process, description, ownerDepartmentId: ownerDepartmentId || null },
        createIdempotencyKey,
      );
      setCreateIdempotencyKey(crypto.randomUUID());
      setProcess("");
      setDescription("");
      setOwnerDepartmentId("");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleActivate(risk: Risk) {
    setError(null);
    try {
      await risksApi.activate(token, risk.id);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  function openOwnerModal(risk: Risk) {
    setOwnerModalRisk(risk);
    setOwnerDraft(risk.ownerId ?? "");
    setSuperiorDraft(risk.superiorOwnerId ?? "");
    setOwnerModalError(null);
  }

  async function submitOwnerModal() {
    if (!ownerModalRisk || savingOwner) return;
    setSavingOwner(true);
    setOwnerModalError(null);
    try {
      const ownerId = ownerDraft.trim() || null;
      const superiorOwnerId = superiorDraft.trim() || null;
      if (ownerId !== ownerModalRisk.ownerId) {
        await risksApi.assignOwner(token, ownerModalRisk.id, ownerId);
      }
      if (superiorOwnerId !== ownerModalRisk.superiorOwnerId) {
        await risksApi.assignSuperiorOwner(token, ownerModalRisk.id, superiorOwnerId);
      }
      setOwnerModalRisk(null);
      await refresh();
    } catch (err) {
      setOwnerModalError(describeError(err));
    } finally {
      setSavingOwner(false);
    }
  }

  async function submitArchive() {
    if (!archiveTarget || !archiveReason.trim() || archiving) return;
    setArchiving(true);
    setError(null);
    try {
      await risksApi.archive(token, archiveTarget.id, archiveReason.trim());
      setArchiveTarget(null);
      setArchiveReason("");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <section className="core-page">
      <div className="core-page__heading">
        <div>
          <p className="core-page__eyebrow">RISQUES · REGISTRE</p>
          <h1>Registre des risques</h1>
          <p className="core-page__subtitle">
            Vue de gestion du portefeuille des risques identifiés — description, Risk Owner et statut. La cotation
            (Inhérent, Maîtrise, Résiduel) et l'historique de ses cycles de réévaluation se font sur la fiche
            d'Évaluation dédiée (bouton « Évaluer » ci-dessous) ; ce registre ne la duplique pas. La Cartographie
            reste la vue de synthèse de pilotage et n'est pas concernée par ce lot.
          </p>
        </div>
      </div>

      <div className="core-page__stats">
        <div className="core-stat"><span>Risques affichés</span><strong>{loading ? "—" : risks.length}</strong></div>
        <div className="core-stat"><span>Actifs</span><strong>{loading ? "—" : activeCount}</strong></div>
        <div className="core-stat"><span>Brouillons</span><strong>{loading ? "—" : draftCount}</strong></div>
        <div className="core-stat"><span>Sans Risk Owner</span><strong>{loading ? "—" : unassignedCount}</strong></div>
      </div>

      {error && <MessageBanner tone="danger">{error}</MessageBanner>}

      <section className="core-panel">
        <div className="core-panel__head">
          <div>
            <h2>Identifier un risque</h2>
            <p>
              L'identification officielle relève du Risk Owner (§4). Le propriétaire individuel se désigne ensuite,
              séparément, via l'action « Risk Owner » du tableau ci-dessous.
            </p>
          </div>
        </div>
        <div className="core-panel__body">
          <form className="core-form" onSubmit={handleCreate}>
            <div className="core-field">
              <label htmlFor="risk-process">Processus *</label>
              <input id="risk-process" value={process} onChange={(e) => setProcess(e.target.value)} required />
            </div>
            <div className="core-field">
              <label htmlFor="risk-description">Description *</label>
              <input
                id="risk-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>
            {departmentDirectory && departmentDirectory.length > 0 && (
              <div className="core-field">
                <label htmlFor="risk-department">Département (facultatif)</label>
                <select
                  id="risk-department"
                  value={ownerDepartmentId}
                  onChange={(e) => setOwnerDepartmentId(e.target.value)}
                >
                  <option value="">Non assigné</option>
                  {departmentDirectory.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="core-form-actions">
              <Button type="submit" variant="primary" disabled={creating} aria-busy={creating}>
                {creating ? "Création…" : "Créer"}
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section className="core-panel">
        <div className="core-panel__head">
          <div>
            <h2>Portefeuille</h2>
            <p>Les risques archivés sont masqués par défaut.</p>
          </div>
          <div className="risks-filters">
            <SegmentedControl
              ariaLabel="Filtrer par propriétaire"
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: "ALL", label: "Tous" },
                { value: "MINE", label: "Mes risques" },
              ]}
            />
            <label className="core-filter">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Inclure les archivés
            </label>
          </div>
        </div>

        <Table
          loading={loading}
          emptyMessage="Aucun risque enregistré."
          rows={risks}
          rowKey={(risk) => risk.id}
          columns={[
            { key: "process", header: "Processus", render: (risk) => risk.process },
            { key: "description", header: "Description", render: (risk) => <strong>{risk.description}</strong> },
            { key: "department", header: "Département", render: (risk) => departmentLabel(risk.ownerDepartmentId) },
            {
              key: "owner",
              header: "Risk Owner",
              render: (risk) => (
                <div className="risks-owner-cell">
                  <span className={risk.ownerId ? undefined : "risks-owner-missing"}>{ownerLabel(risk.ownerId)}</span>
                  {risk.superiorOwnerId && <small>N+1 : {ownerLabel(risk.superiorOwnerId)}</small>}
                </div>
              ),
            },
            {
              key: "status",
              header: "Statut",
              render: (risk) => <StatusBadge label={STATUS_LABELS[risk.status]} tone={STATUS_TONES[risk.status]} />,
            },
            {
              key: "actions",
              header: "Actions",
              render: (risk) => (
                <div className="row-actions">
                  <Button variant="primary" onClick={() => onEvaluate?.(risk.id)}>Évaluer</Button>
                  <Button onClick={() => openOwnerModal(risk)}>Risk Owner</Button>
                  <Button onClick={() => setRaciRiskId((current) => (current === risk.id ? null : risk.id))}>
                    {raciRiskId === risk.id ? "Masquer RACI" : "RACI"}
                  </Button>
                  {risk.status === "DRAFT" && <Button onClick={() => void handleActivate(risk)}>Activer</Button>}
                  {risk.status !== "ARCHIVED" && (
                    <Button
                      variant="destructive"
                      onClick={() => { setArchiveTarget(risk); setArchiveReason(""); setError(null); }}
                    >
                      Archiver
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </section>

      {raciRiskId && <RaciPanel token={token} entityType="RISK" entityId={raciRiskId} />}

      <div className="core-alert core-alert--info">
        <strong>Analyse (§4).</strong> Le contrat prévoit que l'Analyse documente causes, événements et impacts
        potentiels, distincts de l'Identification et de l'Évaluation. Aujourd'hui, <code>Risk</code> ne porte que la
        description libre et les contrôles couvrants déjà affichés sur la fiche d'Évaluation (DIV-07) — aucun champ
        structuré « causes/événements/impacts potentiels » n'existe côté backend. Rien n'est inventé ici ; gap déjà
        consigné dans <code>ACTION_ITEMS.md</code> (entrée « GAPS FRONTEND RM V1 », point 5).
      </div>

      <Modal
        open={!!ownerModalRisk}
        onClose={() => { if (!savingOwner) setOwnerModalRisk(null); }}
        title="Risk Owner"
        actions={
          <>
            <Button onClick={() => setOwnerModalRisk(null)} disabled={savingOwner}>Annuler</Button>
            <Button variant="primary" onClick={() => void submitOwnerModal()} disabled={savingOwner}>
              {savingOwner ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        {ownerModalRisk && (
          <>
            <p>
              {ownerModalRisk.process} — {ownerModalRisk.description}
            </p>
            {ownerModalError && <MessageBanner tone="danger">{ownerModalError}</MessageBanner>}
            <FormField label="Risk Owner" htmlFor="owner-select" help="Laisser vide pour retirer le propriétaire.">
              {userDirectory ? (
                <select id="owner-select" value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)}>
                  <option value="">Non assigné</option>
                  {userDirectory.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
                  ))}
                </select>
              ) : (
                <input
                  id="owner-select"
                  value={ownerDraft}
                  onChange={(e) => setOwnerDraft(e.target.value)}
                  placeholder="Identifiant utilisateur"
                />
              )}
            </FormField>
            <FormField
              label="Superior Owner — N+1 (ACT-122)"
              htmlFor="superior-select"
              help="Utilisé pour l'escalade (ACT-125). Ne peut pas être la même personne que le Risk Owner."
            >
              {userDirectory ? (
                <select id="superior-select" value={superiorDraft} onChange={(e) => setSuperiorDraft(e.target.value)}>
                  <option value="">Non assigné</option>
                  {userDirectory.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
                  ))}
                </select>
              ) : (
                <input
                  id="superior-select"
                  value={superiorDraft}
                  onChange={(e) => setSuperiorDraft(e.target.value)}
                  placeholder="Identifiant utilisateur"
                />
              )}
            </FormField>
          </>
        )}
      </Modal>

      <Modal
        open={!!archiveTarget}
        onClose={() => { if (!archiving) { setArchiveTarget(null); setArchiveReason(""); } }}
        title="Archiver le risque"
        actions={
          <>
            <Button onClick={() => { setArchiveTarget(null); setArchiveReason(""); }} disabled={archiving}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={!archiveTarget || !archiveReason.trim() || archiving}
              onClick={() => void submitArchive()}
            >
              {archiving ? "Archivage…" : "Confirmer l'archivage"}
            </Button>
          </>
        }
      >
        <p>L'archivage est une transition irréversible. Un motif est obligatoire et sera conservé dans la traçabilité.</p>
        <FormField label="Motif d'archivage" htmlFor="risk-archive-reason">
          <textarea
            id="risk-archive-reason"
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            rows={4}
            required
            autoFocus
          />
        </FormField>
      </Modal>
    </section>
  );
}
