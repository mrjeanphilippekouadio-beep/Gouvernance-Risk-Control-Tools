import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BarChart,
  BubbleChart,
  Breadcrumb,
  Button,
  Card,
  DashboardGrid,
  DatePicker,
  DoughnutChart,
  FileUpload,
  FormField,
  Grid,
  GridItem,
  LineChart,
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

const labels = ['Exemple 1', 'Exemple 2', 'Exemple 3']

function Catalog() {
  const [tab, setTab] = useState('a')
  const [seg, setSeg] = useState('a')
  const [page, setPage] = useState(2)
  const [date, setDate] = useState<string | null>(null)
  const [slider, setSlider] = useState(40)
  const [modal, setModal] = useState(false)
  const [loading, setLoading] = useState(false)

  return (
    <main className="catalog">
      <h1>Catalogue du design system</h1>
      <p className="catalog-note">
        Données d'exemple factices. Utilisez la touche Tab pour voir l'anneau de focus clavier.
      </p>

      <Section title="Button">
        <div className="catalog-row">
          <Variant title="Primaire"><Button variant="primary">Exemple</Button></Variant>
          <Variant title="Secondaire"><Button>Exemple</Button></Variant>
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
        <Tabs items={[{ value: 'a', label: 'Exemple A' }, { value: 'b', label: 'Exemple B' }]} active={tab} onChange={setTab} />
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
