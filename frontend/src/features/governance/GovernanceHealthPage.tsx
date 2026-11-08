import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, FormField, MessageBanner, Modal, StatusBadge, Table, Tabs, type StatusTone, type TableColumn } from "@djamo/design-system";
import { governanceHealthApi, type GovernanceHealth, type PanelException, type PanelOffender, type PanelPrinciple, type PrincipleStatus } from "../../api/governanceHealth";
import { governanceAcceptancesApi, type PrincipleAcceptance } from "../../api/governanceAcceptances";
import { configApi } from "../../api/config";
import { REASON_NO_NAME_HINT } from "../../api/visibility";
import { usePermissions } from "../../auth/usePermissions";
import { describeError, isPermissionDenied } from "../indicators/shared";
import { PrincipleComparisonColumns } from "./PrincipleComparisonColumns";
import "../core/CorePages.css";
import "./GovernanceHealth.css";


/** Tone by severity for a non-respected principle; the other statuses have a fixed tone. Display only, the status is the server's. */
function statusBadge(p: PanelPrinciple): { label: string; tone: StatusTone } {
  const map: Record<PrincipleStatus, { label: string; tone: StatusTone }> = {
    NOT_RESPECTED: { label: "Non respecté", tone: p.severity === "elevee" ? "danger" : "warning" },
    RESPECTED: { label: "Respecté", tone: "success" },
    NOT_EVALUABLE: { label: "Non évaluable", tone: "neutral" },
    ACCEPTED: { label: "Accepté", tone: "info" },
    ALLOWED_BY_SETTING: { label: "Autorisé par un réglage", tone: "info" },
  };
  return map[p.status] ?? { label: p.status, tone: "neutral" };
}
const SEVERITY: Record<PanelPrinciple["severity"], string> = { elevee: "Gravité élevée", moyenne: "Gravité moyenne", faible: "Gravité faible" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function offenderText(o: PanelOffender): string {
  const name = o.label ?? o.kind;
  return `${name}${o.count !== undefined ? ` (${o.count})` : ""}${o.detail ? ` : ${o.detail}` : ""}`;
}

function Offenders({ p }: Readonly<{ p: PanelPrinciple }>) {
  if (p.offenders.length === 0) return <span className="muted">—</span>;
  const truncated = p.offendersTotal > p.offenders.length;
  return <>
    <ul className="gh-offenders">{p.offenders.map((o, i) => <li key={i}>{offenderText(o)}</li>)}</ul>
    {truncated && <div className="muted">{p.offenders.length} affichés sur {p.offendersTotal}</div>}
  </>;
}

type ReviewTarget = PanelException;

export function GovernanceHealthPage({ token }: Readonly<{ token: string }>) {
  const { can } = usePermissions(token);
  const [data, setData] = useState<GovernanceHealth | null>(null);
  const [live, setLive] = useState<PrincipleAcceptance[]>([]);
  const [maxDays, setMaxDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<"principles" | "exceptions">("principles");
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<PanelPrinciple | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const [outcome, setOutcome] = useState<"REVIEWED" | "CONTESTED">("REVIEWED");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null); setDenied(false);
    // the D5 list only decorates; if it fails nothing is hidden and the server still refuses a duplicate
    governanceAcceptancesApi.list(token).then((l) => setLive(l.filter((a) => a.status === "PENDING" || a.status === "ACTIVE")), () => setLive([]));
    configApi.get(token).then((c) => setMaxDays(c.acceptanceMaxDays ?? null), () => setMaxDays(null)); // unreadable config: no filter, the server refuses
    try { setData(await governanceHealthApi.get(token)); }
    catch (err) {
      if (isPermissionDenied(err)) setDenied(true); else setError(describeError(err));
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(call: () => Promise<unknown>, done: string) {
    setBusy(true); setActionError(null); setNotice(null);
    try {
      await call();
      setNotice(done); setDetail(null); setReview(null); setAccepting(false);
      await refresh();
    } catch (err) {
      if (isPermissionDenied(err)) { setDetail(null); setReview(null); setAccepting(false); } // the global permission dialog explains it
      else setActionError(describeError(err));
    } finally { setBusy(false); }
  }

  function submitReview(event: FormEvent) {
    event.preventDefault();
    if (review) void run(() => governanceHealthApi.review(token, review.auditId, outcome, reason.trim()), outcome === "REVIEWED" ? "Exception revue." : "Exception contestée.");
  }
  function submitAcceptance(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const expiresAt = new Date(Date.now() + Number(dayChoice) * 86_400_000).toISOString();
    void run(() => governanceAcceptancesApi.accept(token, { principleId: detail.id, reason: reason.trim(), expiresAt }), "Acceptation enregistrée : elle apparaît dans « Décisions de gouvernance ».");
  }
  const openReview = (e: PanelException) => { setReason(""); setOutcome("REVIEWED"); setActionError(null); setReview(e); };
  const openDetail = (p: PanelPrinciple) => { setAccepting(false); setReason(""); setDays("30"); setActionError(null); setDetail(p); };

  const choices = (() => { const ok = ["30", "90", "180", "365"].filter((d) => maxDays === null || Number(d) <= maxDays); return ok.length > 0 ? ok : [String(maxDays)]; })();
  const dayChoice = choices.includes(days) ? days : choices[0]!;
  const pendingOf = (id: string) => live.find((a) => a.principleId === id && a.status === "PENDING");
  const pendingText = (a: PrincipleAcceptance) => `Acceptation en attente de confirmation par un tiers — demandée le ${day(a.acceptedAt)}`;
  const principleColumns: TableColumn<PanelPrinciple>[] = [
    { key: "status", header: "Statut", render: (p) => <>
      <StatusBadge {...statusBadge(p)} />
      <div className="muted">{SEVERITY[p.severity] ?? p.severity}</div>
    </> },
    { key: "title", header: "Principe", render: (p) => <>
      <strong>{p.id}</strong><div>{p.title}</div>
      {p.status === "NOT_EVALUABLE" && <div className="muted">Non évaluable : {p.notEvaluableReason ?? "raison non fournie"}</div>}
      {p.acceptanceNote && <div className="muted">{p.acceptanceNote}</div>}
      {p.acceptance && <div className="muted">Accepté jusqu'au {day(p.acceptance.expiresAt)}</div>}
      {pendingOf(p.id) && <div className="muted">{pendingText(pendingOf(p.id)!)}</div>}
    </> },
    { key: "consequences", header: "Conséquence", render: (p) => p.consequences },
    { key: "offenders", header: "Objets en cause", render: (p) => <Offenders p={p} /> },
    { key: "actions", header: "", render: (p) => <Button onClick={() => openDetail(p)}>Détail<span className="gs-visually-hidden"> {p.id}</span></Button> },
  ];

  const exceptionColumns: TableColumn<PanelException>[] = [
    { key: "age", header: "Âge", render: (e) => <>{e.ageDays} j{e.overdue && <> <StatusBadge label="En retard" tone="danger" /></>}<div className="muted">{e.at.length > 10 ? e.at.slice(0, 16).replace("T", " ") : e.at}</div></> },
    { key: "what", header: "Action", render: (e) => <><strong>{e.rule}</strong><div className="muted">{e.action} · {e.entityType} {e.entityId}</div>{e.reason && <div>{e.reason}</div>}</> },
    { key: "who", header: "Par", render: (e) => e.mine ? "Vous" : (e.userLabel ?? "Masqué (droit d'audit requis)") },
    { key: "state", header: "État", render: (e) => <StatusBadge label={e.reviewed ? "Revue" : "À revoir"} tone={e.reviewed ? "success" : "warning"} /> },
    { key: "actions", header: "", render: (e) => !e.reviewed && !e.mine && can("governanceexception.review")
      ? <Button onClick={() => openReview(e)}>Revoir<span className="gs-visually-hidden"> {e.rule}</span></Button> : null },
  ];

  const rmEmpty = data?.principles.some((p) => p.offenders.some((o) => o.kind === "GROUP" && o.id === "RISK_MANAGER" && o.count === 0)) ?? false;

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · GOUVERNANCE</p>
        <h1>Santé de la gouvernance</h1>
        <p className="core-page__subtitle">Le serveur évalue chaque principe de gouvernance ; cette page affiche son résultat sans le recalculer. Catalogue v{data?.catalogVersion ?? "…"}.</p>
        {data && <p className="core-page__subtitle">Suivi depuis le {day(data.trackedSince)} : rien n'est reconstitué avant cette date.</p>}
      </div>
    </div>
    {loading && !data && <p role="status">Chargement…</p>}
    {denied && <MessageBanner tone="danger" title="Accès refusé">Vous n'avez pas le droit de consulter la santé de la gouvernance.</MessageBanner>}
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {notice && <MessageBanner tone="success">{notice}</MessageBanner>}
    {data && <>
      {rmEmpty && <MessageBanner tone="danger" title="Groupe Risk Manager vide">Aucun compte n'est membre du groupe Risk Manager.</MessageBanner>}
      {data.organizationSize === null && <MessageBanner tone="info" title="Taille de l'organisation inconnue">Aucune colonne n'est mise en avant tant que le profil d'organisation n'est pas renseigné.</MessageBanner>}
      {data.profileGaps.length > 0 && <MessageBanner tone="warning" title="Écarts entre le déclaré et l'observé">
        <ul className="gh-offenders">{data.profileGaps.map((g) => <li key={g.id}>{g.message}</li>)}</ul>
      </MessageBanner>}
      <Tabs
        items={[
          { value: "principles", label: `Principes (${data.principles.length})` },
          { value: "exceptions", label: `Exceptions à revoir (${data.exceptions.unreviewed})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "principles" && <Card header={<strong>Principes de gouvernance</strong>}>
        <Table columns={principleColumns} rows={data.principles} rowKey={(p) => p.id} loading={false} emptyMessage="Aucun principe renvoyé par le serveur." />
      </Card>}
      {tab === "exceptions" && <Card header={<strong>Actions appliquées sans seconde validation</strong>}>
        <p className="muted">{data.exceptions.unreviewed} à revoir sur {data.exceptions.total}
          {data.exceptions.reviewDelayDays !== null && <> · délai de revue : {data.exceptions.reviewDelayDays} jours</>}
          {data.exceptions.items.length < data.exceptions.total && <> · {data.exceptions.items.length} affichées</>}.</p>
        <Table columns={exceptionColumns} rows={data.exceptions.items} rowKey={(e) => e.auditId} loading={false} emptyMessage="Aucune exception à revoir." />
      </Card>}
      {data.retentionPurge.lastRunAt === null
        ? <MessageBanner tone="info">La purge manuelle des anciennes dates de connexion n'a jamais été exécutée.</MessageBanner>
        : <p className="muted">Dernière purge des dates de connexion : {day(data.retentionPurge.lastRunAt)} (il y a {data.retentionPurge.ageDays} jours).</p>}
    </>}

    <Modal
      open={detail !== null}
      onClose={() => { if (!busy) setDetail(null); }}
      title={detail ? `${detail.id}` : ""}
      size="lg"
      busy={busy}
      actions={accepting
        ? <>
          <Button onClick={() => setAccepting(false)} disabled={busy}>Retour</Button>
          <Button type="submit" form="accept-form" variant="primary" disabled={busy || !reason.trim()}>Enregistrer l'acceptation</Button>
        </>
        : <>
          <Button onClick={() => setDetail(null)}>Fermer</Button>
          {detail?.status === "NOT_RESPECTED" && !live.some((a) => a.principleId === detail.id) && can("governanceprinciple.accept") && <Button variant="primary" onClick={() => { setReason(""); setActionError(null); setAccepting(true); }}>Accepter ce principe</Button>}
        </>}
    >
      {detail && <div className="gh-detail">
        <p><strong>{detail.title}</strong></p>
        <p><StatusBadge {...statusBadge(detail)} /></p>
        {detail.status === "NOT_EVALUABLE" && <p>Non évaluable : {detail.notEvaluableReason ?? "raison non fournie"}</p>}
        {pendingOf(detail.id) && <MessageBanner tone="info">{pendingText(pendingOf(detail.id)!)}</MessageBanner>}
        {detail.covers && <p className="muted">Évalué : {detail.covers}</p>}
        <p>{detail.consequences}</p>
        {actionError && <MessageBanner tone="danger">{actionError}</MessageBanner>}
        {accepting
          ? <form id="accept-form" onSubmit={submitAcceptance}>
            <FormField label="Motif de l'acceptation (obligatoire)" htmlFor="accept-reason" help={REASON_NO_NAME_HINT}>
              <textarea id="accept-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
            </FormField>
            <FormField label="Durée" htmlFor="accept-days" help={maxDays === null ? "Le serveur peut refuser une durée trop longue." : `Durée maximale fixée par votre organisation : ${maxDays} jours.`}>
              <select id="accept-days" value={dayChoice} onChange={(e) => setDays(e.target.value)}>
                {choices.map((d) => <option key={d} value={d}>{d} jours</option>)}
              </select>
            </FormField>
          </form>
          : <>
            <h3>Objets en cause</h3>
            <Offenders p={detail} />
            <h3>Selon la taille de l'organisation</h3>
            <PrincipleComparisonColumns principle={detail} />
          </>}
      </div>}
    </Modal>

    <Modal
      open={review !== null}
      onClose={() => { if (!busy) setReview(null); }}
      title="Revoir une exception"
      busy={busy}
      actions={<>
        <Button onClick={() => setReview(null)} disabled={busy}>Annuler</Button>
        <Button type="submit" form="review-form" variant="primary" disabled={busy || !reason.trim()}>Enregistrer</Button>
      </>}
    >
      {review && <form id="review-form" onSubmit={submitReview}>
        {actionError && <MessageBanner tone="danger">{actionError}</MessageBanner>}
        <p>{review.rule} · {review.action} {review.entityType}</p>
        <FormField label="Issue" htmlFor="review-outcome">
          <select id="review-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value === "CONTESTED" ? "CONTESTED" : "REVIEWED")}>
            <option value="REVIEWED">Revue : rien à redire</option>
            <option value="CONTESTED">Contestée</option>
          </select>
        </FormField>
        <FormField label="Motif (obligatoire)" htmlFor="review-comment" help={REASON_NO_NAME_HINT}>
          <textarea id="review-comment" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </FormField>
      </form>}
    </Modal>
  </section>;
}
