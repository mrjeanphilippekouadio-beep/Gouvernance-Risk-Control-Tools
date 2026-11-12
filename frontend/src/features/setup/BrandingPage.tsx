import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, FileUpload, MessageBanner } from "@djamo/design-system";
import { setupApi, type TenantBranding } from "../../api/setup";
import { dateOnly, describeError } from "../indicators/shared";
import "../core/CorePages.css";

/** F8 R1 (q165) : image de marque. GET/POST /api/v1/branding ; le serveur décide des droits, des types et de la taille. */
export function BrandingPage({ token }: { token: string }) {
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBranding(await setupApi.branding(token)); } catch (err) { setError(describeError(err)); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSaving(true); setFormError(null); setDone(false);
    try {
      setBranding(await setupApi.uploadLogo(token, file));
      setFile(null); setPickerKey((k) => k + 1); setDone(true);
    } catch (err) { setFormError(describeError(err)); } finally { setSaving(false); }
  }

  const safeUrl = branding?.logoUrl && /^https:\/\//i.test(branding.logoUrl) ? branding.logoUrl : null;

  return <section className="core-page">
    <div className="core-page__heading">
      <div>
        <p className="core-page__eyebrow">ADMINISTRATION · MISE EN SERVICE</p>
        <h1>Image de marque</h1>
        <p className="core-page__subtitle">Logo du client. Formats acceptés : PNG et JPEG (le serveur vérifie le contenu réel du fichier), 5 Mo au plus. Chaque dépôt est tracé.</p>
      </div>
    </div>
    {error && <MessageBanner tone="danger" title="Chargement impossible">{error}</MessageBanner>}
    {done && <MessageBanner tone="success" title="Logo enregistré">Le nouveau logo est en place.</MessageBanner>}
    {loading && !branding && <p role="status">Chargement…</p>}
    {branding && <Card header={<strong>Logo actuel</strong>}>
      {branding.logoDriveFileId
        ? <p>Un logo est enregistré (mis à jour le {dateOnly(branding.logoUpdatedAt)}). {safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer">Ouvrir le logo (nouvel onglet)</a>}</p>
        : <p className="muted">Aucun logo enregistré pour l'instant.</p>}
    </Card>}
    <Card header={<strong>Déposer un logo</strong>}>
      <form onSubmit={submit}>
        {formError && <MessageBanner tone="danger">{formError}</MessageBanner>}
        <FileUpload key={pickerKey} accept="image/png,image/jpeg" buttonLabel="Choisir une image" onSelect={setFile} disabled={saving} />
        <p className="muted">Le logo précédent n'est pas supprimé du stockage : il est simplement remplacé.</p>
        <Button type="submit" variant="primary" disabled={!file || saving}>{saving ? "Envoi…" : "Enregistrer le logo"}</Button>
      </form>
    </Card>
  </section>;
}
