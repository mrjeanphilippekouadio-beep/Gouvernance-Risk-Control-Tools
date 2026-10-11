// Design-system catalog, served publicly with the static site. Keep it to
// placeholder data: no API calls, no real data, no import.meta.env (security
// review DS-1a); otherwise exclude this entry from the production build.
import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BarChart,
  BubbleChart,
  Breadcrumb,
  BulkActionBar,
  Button,
  Card,
  Checkbox,
  ChecklistItem,
  Collapsible,
  Input,
  RadioGroup,
  RefusalDialog,
  ScaleEditor,
  Select,
  Skeleton,
  Stepper,
  Textarea,
  Tooltip,
  DashboardGrid,
  DatePicker,
  DoughnutChart,
  FileUpload,
  FormField,
  Grid,
  GridItem,
  LineChart,
  MatrixView,
  Menu,
  MessageBanner,
  Modal,
  Pagination,
  Panel,
  PanelRow,
  ProgressBar,
  ScatterChart,
  SegmentedControl,
  Slider,
  StatusBadge,
  Table,
  Tabs,
  Timeline,
  VersionComparison,
} from '@djamo/design-system'
import '../index.css'
import './catalog.css'

/**
 * Visual catalog of @djamo/design-system. Every value below is a neutral,
 * explicitly fake example ("Exemple") — nothing here is business data.
 * Keyboard focus: press Tab to see the shared :focus-visible ring.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Variant({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3>{title}</h3>
      {children}
    </div>
  )
}

interface Row {
  id: string
  name: string
  status: string
}
const rows: Row[] = [
  { id: '1', name: 'Exemple A', status: 'Exemple' },
  { id: '2', name: 'Exemple B', status: 'Exemple' },
]
const columns = [
  { key: 'name', header: 'Nom', render: (r: Row) => r.name },
  { key: 'status', header: 'Statut', render: (r: Row) => <StatusBadge tone="neutral" label={r.status} /> },
]
const noRows: Row[] = []

const scaleLevels = [1, 2, 3].map((n) => ({ id: `l${n}`, label: `Niveau exemple ${n}` }))
const scaleAxes = [{ id: 'a1', label: 'Axe exemple 1' }, { id: 'a2', label: 'Axe exemple 2' }]
const selectOptions = [{ value: 'a', label: 'Option exemple A' }, { value: 'b', label: 'Option exemple B' }]
const stepperSteps = [
  { id: 's1', label: 'Étape exemple 1' },
  { id: 's2', label: 'Étape exemple 2' },
  { id: 's3', label: 'Étape exemple 3', error: true },
  { id: 's4', label: 'Étape exemple 4' },
]

const labels = ['Exemple 1', 'Exemple 2', 'Exemple 3']

function Catalog() {
  const [tab, setTab] = useState('a')
  const [seg, setSeg] = useState('a')
  const [page, setPage] = useState(2)
  const [date, setDate] = useState<string | null>(null)
  const [slider, setSlider] = useState(40)
  const [modal, setModal] = useState(false)
  const [modalSize, setModalSize] = useState<'md' | 'lg' | null>(null)
  const [selected, setSelected] = useState<string[]>(['2'])
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' })
  const [loading, setLoading] = useState(false)
  const [radio, setRadio] = useState('a')
  const [step, setStep] = useState('s2')
  const [refusal, setRefusal] = useState<'none' | 'list' | 'sensitive'>('none')
  const [scale, setScale] = useState<Record<string, Record<string, string>>>({ a1: { l1: "Texte d'exemple" } })

  return (
    <main className="catalog">
      <h1>Catalogue du design system</h1>
      <p className="catalog-note">
        Données d'exemple factices. Utilisez la touche Tab pour voir l'anneau de focus clavier.
      </p>

      <Section title="Jetons ajoutés (vague 2)">
        <p style={{ fontFamily: 'var(--gs-font-display)', fontSize: 'var(--gs-font-size-display)', fontWeight: 700, margin: 0 }}>
          Titre d'exemple 30 px (--gs-font-size-display)
        </p>
        <p style={{ padding: 'var(--gs-space-2-5)', background: 'var(--gs-bg-surface)', display: 'inline-block' }}>
          Marge intérieure 12 px (--gs-space-2-5)
        </p>
      </Section>

      <Section title="Button">
        <div className="catalog-row">
          <Variant title="Primaire"><Button variant="primary">Exemple</Button></Variant>
          <Variant title="Secondaire"><Button>Exemple</Button></Variant>
          <Variant title="Petit (32 px)"><Button size="sm" variant="primary">Exemple</Button></Variant>
          <Variant title="Moyen (40 px, défaut)"><Button variant="primary">Exemple</Button></Variant>
          <Variant title="Grand (48 px)"><Button size="lg" variant="primary">Exemple</Button></Variant>
          <Variant title="Destructif"><Button variant="destructive">Exemple</Button></Variant>
          <Variant title="Désactivé"><Button disabled>Exemple</Button></Variant>
          <Variant title="Désactivé avec raison">
            <Button disabledReason="Exemple de raison : action indisponible">Exemple</Button>
            <p className="catalog-note">Raison lue au focus (aria-describedby).</p>
          </Variant>
          <Variant title="Chargement">
            <Button variant="primary" loading>Exemple</Button>
          </Variant>
          <Variant title="Chargement interactif">
            <Button
              variant="primary"
              loading={loading}
              onClick={() => {
                setLoading(true)
                setTimeout(() => setLoading(false), 1500)
              }}
            >
              Exemple
            </Button>
          </Variant>
        </div>
      </Section>

      <Section title="StatusBadge">
        <div className="catalog-row">
          {(['danger', 'warning', 'success', 'neutral', 'info'] as const).map((tone) => (
            <StatusBadge key={tone} tone={tone} label={`Exemple ${tone}`} />
          ))}
        </div>
      </Section>

      <Section title="Table">
        <Variant title="Par défaut (légende masquée)">
          <Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="Exemple : aucune ligne" caption="Exemple de tableau" />
        </Variant>
        <Variant title="Compact et zébré">
          <Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="Exemple : aucune ligne" caption="Exemple de tableau compact" density="compact" striped />
        </Variant>
        <Variant title="Sélection (ligne sélectionnée) et tri">
          <BulkActionBar count={selected.length} onClear={() => setSelected([])}>
            <Button size="sm" variant="primary">Action d'exemple</Button>
          </BulkActionBar>
          <Table
            columns={[{ ...columns[0], sortable: true }, columns[1]]}
            rows={rows}
            rowKey={(r) => r.id}
            loading={false}
            emptyMessage="Exemple : aucune ligne"
            caption="Exemple de tableau sélectionnable"
            selectedKeys={selected}
            onSelectionChange={setSelected}
            selectionLabel={(r) => `Sélectionner ${r.name}`}
            sort={sort}
            onSort={(key) => setSort((s) => ({ key, direction: s.direction === 'asc' ? 'desc' : 'asc' }))}
          />
        </Variant>
        <Variant title="Comparaison de versions">
          <VersionComparison changes={[{ field: 'Champ exemple 1', before: 'Valeur A', after: 'Valeur B' }, { field: 'Champ exemple 2', before: null, after: 'Valeur C' }]} />
        </Variant>
        <Variant title="Matrice (taille variable)">
          <MatrixView
            caption="Exemple de matrice"
            rowTitle="Ligne"
            columnTitle="Colonne"
            rows={['Ligne 1', 'Ligne 2', 'Ligne 3']}
            columns={['Col. 1', 'Col. 2', 'Col. 3', 'Col. 4']}
            cell={(r, c) => ({ value: String((r + 1) * (c + 1)), label: `Exemple ${(r + 1) * (c + 1)}`, tone: (['info', 'success', 'warning', 'danger'] as const)[Math.min(3, Math.floor(((r + 1) * (c + 1)) / 4))] })}
          />
        </Variant>
        <Variant title="Chargement">
          <Table columns={columns} rows={noRows} rowKey={(r) => r.id} loading emptyMessage="Exemple : aucune ligne" />
        </Variant>
        <Variant title="Vide">
          <Table columns={columns} rows={noRows} rowKey={(r) => r.id} loading={false} emptyMessage="Exemple : aucune ligne" />
        </Variant>
      </Section>

      <Section title="FormField">
        <div className="catalog-row">
          <Variant title="Défaut avec aide">
            <FormField label="Exemple" htmlFor="c-f1" help="Exemple d'aide"><input id="c-f1" /></FormField>
          </Variant>
          <Variant title="Erreur">
            <FormField label="Exemple" htmlFor="c-f2" error="Exemple d'erreur"><input id="c-f2" /></FormField>
          </Variant>
          <Variant title="Désactivé">
            <FormField label="Exemple" htmlFor="c-f3"><input id="c-f3" disabled /></FormField>
          </Variant>
        </div>
      </Section>

      <Section title="MessageBanner">
        {(['info', 'success', 'warning', 'danger'] as const).map((tone) => (
          <MessageBanner key={tone} tone={tone} title={`Exemple ${tone}`}>Message d'exemple.</MessageBanner>
        ))}
      </Section>

      <Section title="Tabs, SegmentedControl, Breadcrumb, Pagination">
        <Tabs items={[{ value: 'a', label: 'Exemple A' }, { value: 'b', label: 'Exemple B' }, { value: 'c', label: 'Désactivé', disabled: true, disabledReason: "Exemple de raison : onglet indisponible" }]} active={tab} onChange={setTab} />
        <p />
        <SegmentedControl ariaLabel="Exemple" options={[{ value: 'a', label: 'Exemple A' }, { value: 'b', label: 'Exemple B' }]} value={seg} onChange={setSeg} />
        <p />
        <Breadcrumb items={[{ label: 'Exemple', href: '#' }, { label: 'Page courante' }]} />
        <Pagination page={page} pageCount={9} onChange={setPage} />
      </Section>

      <Section title="Menu">
        <Menu
          ariaLabel="Exemple"
          groups={[{ label: 'Exemple', items: [{ label: 'Action' }, { label: 'Active', active: true }, { label: 'Désactivée', disabled: true }] }]}
        />
      </Section>

      <Section title="Modal">
        <Button onClick={() => setModal(true)}>Ouvrir l'exemple</Button>
        <Modal open={modal} onClose={() => setModal(false)} title="Exemple de fenêtre" actions={<Button variant="primary" onClick={() => setModal(false)}>Fermer</Button>}>
          Contenu d'exemple. Échap ferme la fenêtre.
        </Modal>
        <div className="catalog-row">
          <Button onClick={() => setModalSize('md')}>Fenêtre moyenne (560 px)</Button>
          <Button onClick={() => setModalSize('lg')}>Fenêtre large (800 px)</Button>
        </div>
        <Modal open={modalSize !== null} size={modalSize ?? 'md'} onClose={() => setModalSize(null)} title="Exemple de fenêtre large" actions={<Button variant="primary" onClick={() => setModalSize(null)}>Fermer</Button>}>
          Contenu d'exemple pour une fenêtre plus large.
        </Modal>
      </Section>

      <Section title="DatePicker, FileUpload, Slider">
        <div className="catalog-row">
          <DatePicker label="Exemple" value={date} onChange={setDate} />
          <DatePicker label="Désactivé" value={null} onChange={() => {}} disabled />
          <FileUpload />
          <FileUpload fileName="exemple.xlsx" />
          <FileUpload disabled />
          <Slider label="Exemple" value={slider} onChange={setSlider} />
        </div>
      </Section>

      <Section title="Card, Panel, Timeline, Grid">
        <div className="catalog-row">
          <Card header="Exemple" footer={<Button>Action</Button>}>Contenu d'exemple</Card>
          <Card header="Sélectionnée" selected>Contenu d'exemple</Card>
          <Card header="Désactivée" disabled>Contenu d'exemple</Card>
          <Panel title="Exemple" tabs={[{ value: 'a', label: 'Exemple' }]} activeTab="a" onTabChange={() => {}}>
            <PanelRow>Ligne d'exemple</PanelRow>
          </Panel>
          <Timeline items={[{ label: 'Exemple fait', detail: 'Exemple', state: 'done' }, { label: 'Exemple en cours', state: 'current' }, { label: 'Exemple à venir', state: 'pending' }]} />
        </div>
        <Grid columns={3}>
          <Card>Exemple</Card>
          <GridItem span={2}><Card>Exemple (2 colonnes)</Card></GridItem>
        </Grid>
      </Section>

      <Section title="Champs de saisie (FormField + Input, Select, Textarea, Checkbox, RadioGroup)">
        <div className="catalog-row">
          <FormField label="Texte" htmlFor="c-in" help="Aide d'exemple" required><Input id="c-in" /></FormField>
          <FormField label="Erreur" htmlFor="c-err" error="Erreur d'exemple"><Input id="c-err" /></FormField>
          <FormField label="Lecture seule" htmlFor="c-ro" readOnly><Input id="c-ro" defaultValue="Valeur d'exemple" /></FormField>
          <FormField label="Désactivé" htmlFor="c-dis" disabled><Input id="c-dis" /></FormField>
          <FormField label="Liste" htmlFor="c-sel"><Select id="c-sel" options={selectOptions} placeholder="Choisir" /></FormField>
          <FormField label="Zone de texte" htmlFor="c-ta"><Textarea id="c-ta" /></FormField>
          <Checkbox label="Case d'exemple" hint="Indication d'exemple" />
          <RadioGroup legend="Choix d'exemple" name="c-radio" options={selectOptions} value={radio} onChange={setRadio} help="Aide d'exemple" />
        </div>
      </Section>

      <Section title="Fenêtre de refus (RefusalDialog)">
        <div className="catalog-row">
          <Button onClick={() => setRefusal('list')}>Avec personnes autorisées</Button>
          <Button onClick={() => setRefusal('sensitive')}>Permission sensible</Button>
        </div>
        <RefusalDialog
          open={refusal === 'list'}
          onClose={() => setRefusal('none')}
          action="Action d'exemple"
          reason="Raison d'exemple"
          authorized={['Personne exemple A', 'Personne exemple B']}
        />
        <RefusalDialog
          open={refusal === 'sensitive'}
          onClose={() => setRefusal('none')}
          action="Action d'exemple"
          reason="Raison d'exemple"
          sensitive
        />
      </Section>

      <Section title="Stepper, Info-bulle, Squelette, Section repliable, Ligne de checklist">
        <Stepper ariaLabel="Assistant d'exemple" steps={stepperSteps} current={step} onStepChange={setStep} />
        <div className="catalog-row">
          <Tooltip content="Texte d'info-bulle d'exemple"><Button>Survol ou focus</Button></Tooltip>
          <div style={{ width: 320 }}><Skeleton /></div>
        </div>
        <Collapsible title="Section d'exemple">Contenu d'exemple</Collapsible>
        <ChecklistItem label="Élément fait (exemple)" status="done" />
        <ChecklistItem label="Élément à compléter (exemple)" status="todo" detail="Détail d'exemple" action={<a href="#catalog">Compléter</a>} />
        <ChecklistItem label="Élément bloqué (exemple)" status="blocked" detail="Raison d'exemple" />
      </Section>

      <Section title="Éditeur d'échelle (ScaleEditor)">
        <ScaleEditor
          ariaLabel="Échelle d'exemple"
          levels={scaleLevels}
          axes={scaleAxes}
          value={scale}
          onChange={setScale}
          minLevels={3}
          maxLevels={6}
          maxAxes={7}
        />
      </Section>

      <Section title="Graphiques (valeurs d'exemple)">
        <div className="catalog-row">
          <div style={{ width: 320 }}><BarChart labels={labels} series={[{ label: 'Exemple', data: [3, 5, 2] }]} height={180} /></div>
          <div style={{ width: 320 }}><LineChart labels={labels} series={[{ label: 'Exemple', data: [2, 4, 3] }]} height={180} /></div>
          <div style={{ width: 240 }}><DoughnutChart segments={[{ label: 'Exemple A', value: 3 }, { label: 'Exemple B', value: 2 }]} height={180} /></div>
          <div style={{ width: 320 }}><ScatterChart series={[{ label: 'Exemple', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }]} height={180} /></div>
          <div style={{ width: 320 }}><BubbleChart series={[{ label: 'Exemple', points: [{ x: 1, y: 2, r: 8 }, { x: 3, y: 1, r: 12 }] }]} height={180} /></div>
          <div style={{ width: 320 }}><ProgressBar value={60} label="Exemple" /></div>
        </div>
        <Variant title="DashboardGrid">
          <DashboardGrid
            widgets={[
              { id: 'w1', x: 0, y: 0, w: 6, h: 2, content: <Card>Exemple 1</Card> },
              { id: 'w2', x: 6, y: 0, w: 6, h: 2, content: <Card>Exemple 2</Card> },
            ]}
            editable={false}
          />
        </Variant>
      </Section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Catalog />
  </StrictMode>,
)
