import { useCallback, useEffect, useState } from "react";
import { Button, MessageBanner, Modal, Skeleton, StatusBadge, Tabs } from "@djamo/design-system";
import { ApiError } from "../../api/client";
import { notificationsApi, type AppNotification, type NotificationResourceType, type NotificationSubscription, type NotificationType } from "../../api/notifications";
import "./NotificationCenter.css";

export type NotificationTarget = "risks" | "actions" | "controls" | "evaluation" | "roles";

const POLL_MS = 60_000;
const COUNT_CAP = 100;

/** Screens that exist today; none opens a record by id, so the link goes to the module. */
const TARGETS: Partial<Record<NotificationResourceType, { view: NotificationTarget; label: string }>> = {
  RISK: { view: "risks", label: "Ouvrir le registre des risques" },
  ACTION_PLAN: { view: "actions", label: "Ouvrir les plans d’action" },
  CONTROL: { view: "controls", label: "Ouvrir les contrôles" },
  RISK_EVALUATION: { view: "evaluation", label: "Ouvrir les évaluations" },
  MANAGEMENT: { view: "roles", label: "Ouvrir les rôles" },
};

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) return "Session expirée : reconnectez-vous.";
  if (e instanceof ApiError && e.status === 403) return "Vous n’avez pas le droit de consulter les notifications.";
  return "Impossible de joindre le serveur. Réessayez.";
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

type Tab = "list" | "subs";

export function NotificationCenter({ token, onNavigate }: { token: string; onNavigate: (view: NotificationTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [subs, setSubs] = useState<NotificationSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [types, setTypes] = useState<NotificationType[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const eventLabel = (eventType: string) => types?.find((t) => t.eventType === eventType)?.label ?? "Notification";

  const refreshCount = useCallback(async () => {
    try {
      setUnread(await notificationsApi.unreadCount(token));
    } catch {
      setUnread(null); // unknown, never shown as 0
    }
  }, [token]);

  useEffect(() => {
    void refreshCount();
    const t = window.setInterval(() => void refreshCount(), POLL_MS);
    return () => window.clearInterval(t);
  }, [refreshCount]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await notificationsApi.list(token));
    } catch (e) {
      setItems(null);
      setError(errorText(e));
    }
    void refreshCount();
  }, [token, refreshCount]);

  const loadSubs = useCallback(async () => {
    setSubsError(null);
    try {
      setSubs(await notificationsApi.listSubscriptions(token));
    } catch (e) {
      setSubsError(errorText(e));
    }
    try {
      setTypes(await notificationsApi.listTypes(token));
    } catch (e) {
      setSubsError(errorText(e));
    }
  }, [token]);

  useEffect(() => {
    if (!open) return;
    void load();
    void loadSubs();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [open, load, loadSubs]);

  const markRead = async (id: string) => {
    setBusyId(id);
    try {
      const updated = await notificationsApi.markRead(token, id);
      setItems((cur) => cur?.map((n) => (n.id === id ? { ...n, readAt: updated.readAt ?? new Date().toISOString() } : n)) ?? cur);
      void refreshCount();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setBusyId("all");
    try {
      await notificationsApi.markAllRead(token);
      const now = new Date().toISOString();
      setItems((cur) => cur?.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)) ?? cur);
      void refreshCount();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const toggleSub = async (resourceType: NotificationResourceType, eventType: string, enabled: boolean) => {
    setBusyId(eventType);
    setSubsError(null);
    try {
      const saved = await notificationsApi.subscribe(token, { resourceType, eventType, enabled });
      setSubs((cur) => [...(cur ?? []).filter((s) => !(s.resourceType === resourceType && s.eventType === eventType)), saved]);
    } catch (e) {
      setSubsError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const countLabel = unread === null ? "" : unread >= COUNT_CAP ? `${COUNT_CAP - 1}+` : String(unread);
  const hasUnread = unread !== null ? unread > 0 : (items?.some((n) => n.readAt === null) ?? false);

  return (
    <>
      <button type="button" className="notif-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${countLabel} non lues` : "Notifications"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        {unread !== null && unread > 0 && <span className="notif-count" aria-hidden="true">{countLabel}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notifications" size="md" busy={busyId !== null}
        actions={<Button variant="secondary" onClick={() => setOpen(false)}>Fermer</Button>}>
        <Tabs<Tab> items={[{ value: "list", label: "Notifications" }, { value: "subs", label: "Abonnements" }]} active={tab} onChange={setTab} />
        {tab === "list" && (
          <div className="notif-body">
            <MessageBanner tone="info">Actualisation à l’ouverture puis toutes les minutes.</MessageBanner>
            <div className="notif-actions">
              <Button size="sm" variant="secondary" loading={busyId === "all"} disabled={!hasUnread} onClick={() => void markAllRead()}>Tout marquer comme lu</Button>
            </div>
            {error && <MessageBanner tone="danger">{error}</MessageBanner>}
            {!error && items === null && <Skeleton lines={4} label="Chargement des notifications" />}
            {items !== null && items.length === 0 && <p className="notif-empty">Aucune notification.</p>}
            {items !== null && items.length > 0 && (
              <ul className="notif-list">
                {items.map((n) => {
                  const target = n.resourceId !== null ? TARGETS[n.resourceType] : undefined;
                  const isUnread = n.readAt === null;
                  return (
                    <li key={n.id} className="notif-item" data-unread={isUnread || undefined}>
                      <div className="notif-head">
                        <strong>{eventLabel(n.eventType)}</strong>
                        <StatusBadge label={isUnread ? "Non lue" : "Lue"} tone={isUnread ? "info" : "neutral"} />
                      </div>
                      <p>{n.message}</p>
                      <small>{fmt(n.sentAt)}</small>
                      <div className="notif-actions">
                        {target && <Button size="sm" variant="secondary" onClick={() => { setOpen(false); onNavigate(target.view); }}>{target.label}</Button>}
                        {isUnread && <Button size="sm" variant="secondary" loading={busyId === n.id} onClick={() => void markRead(n.id)}>Marquer comme lue</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {tab === "subs" && (
          <div className="notif-body">
            {subsError && <MessageBanner tone="danger">{subsError}</MessageBanner>}
            {!subsError && (subs === null || types === null) && <Skeleton lines={3} label="Chargement des abonnements" />}
            {subs !== null && types !== null && (
              <ul className="notif-list">
                {types.map(({ resourceType, eventType, label, mandatory }) => {
                  const row = subs.find((s) => s.resourceType === resourceType && s.eventType === eventType);
                  const enabled = mandatory ? true : row?.enabled;
                  return (
                    <li key={eventType} className="notif-item">
                      <div className="notif-head">
                        <strong>{label}</strong>
                        <StatusBadge label={mandatory ? "Obligatoire" : enabled === undefined ? "Activé par défaut" : enabled ? "Activé" : "Désactivé"} tone={mandatory ? "info" : enabled === false ? "warning" : "success"} />
                      </div>
                      {!mandatory && (
                        <div className="notif-actions">
                          <Button size="sm" variant="secondary" loading={busyId === eventType} onClick={() => void toggleSub(resourceType, eventType, enabled === false)}>
                            {enabled === false ? "Activer" : "Désactiver"}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
