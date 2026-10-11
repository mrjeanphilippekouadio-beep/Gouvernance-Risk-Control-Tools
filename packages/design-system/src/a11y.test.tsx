import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import {
  Button,
  DatePicker,
  FileUpload,
  FormField,
  Menu,
  MessageBanner,
  Modal,
  Pagination,
  SegmentedControl,
  StatusBadge,
  Table,
  Tabs,
} from "./index";

afterEach(cleanup);

// jsdom does not implement <dialog>.showModal/close: minimal stand-in that
// keeps the `open` attribute and fires `close`, as browsers do.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

async function expectNoViolations(container: HTMLElement) {
  const results = await axe(container);
  expect(results.violations).toEqual([]);
}

const rows = [{ id: "1", name: "Exemple" }];
const columns = [{ key: "name", header: "Nom", render: (r: { id: string; name: string }) => r.name }];

describe("axe — no violations", () => {
  it("Button (default, loading, disabled with reason)", async () => {
    const { container } = render(
      <>
        <Button>Exemple</Button>
        <Button loading>Envoyer</Button>
        <Button disabled>Désactivé</Button>
        <Button disabledReason="Exemple de raison">Valider</Button>
      </>,
    );
    await expectNoViolations(container);
  });

  it("Menu", async () => {
    const { container } = render(
      <Menu
        ariaLabel="Actions"
        groups={[{ label: "Groupe", items: [{ label: "Exporter" }, { label: "Lien", href: "#x" }] }]}
      />,
    );
    await expectNoViolations(container);
  });

  it("Modal (open)", async () => {
    const { baseElement } = render(
      <Modal open onClose={() => {}} title="Titre" actions={<Button>OK</Button>}>
        Contenu
      </Modal>,
    );
    await expectNoViolations(baseElement);
  });

  it("Tabs", async () => {
    const { container } = render(
      <Tabs
        items={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        active="a"
        onChange={() => {}}
      />,
    );
    await expectNoViolations(container);
  });

  it("Table (default with caption, loading, empty)", async () => {
    const { container } = render(
      <>
        <Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="Vide" caption="Exemple" />
        <Table columns={columns} rows={[] as typeof rows} rowKey={(r) => r.id} loading emptyMessage="Vide" />
        <Table columns={columns} rows={[] as typeof rows} rowKey={(r) => r.id} loading={false} emptyMessage="Vide" />
      </>,
    );
    await expectNoViolations(container);
  });

  it("Pagination", async () => {
    const { container } = render(<Pagination page={2} pageCount={9} onChange={() => {}} />);
    await expectNoViolations(container);
  });

  it("SegmentedControl", async () => {
    const { container } = render(
      <SegmentedControl
        ariaLabel="Vue"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        value="a"
        onChange={() => {}}
      />,
    );
    await expectNoViolations(container);
  });

  it("FormField", async () => {
    const { container } = render(
      <>
        <FormField label="Nom" htmlFor="n" help="Aide">
          <input id="n" />
        </FormField>
        <FormField label="Code" htmlFor="c" error="Erreur">
          <input id="c" />
        </FormField>
      </>,
    );
    await expectNoViolations(container);
  });

  it("DatePicker (closed and open)", async () => {
    const { container } = render(<DatePicker label="Date" value="2026-01-15" onChange={() => {}} />);
    await expectNoViolations(container);
    fireEvent.click(screen.getByLabelText("Date"));
    await expectNoViolations(container);
  });

  it("FileUpload", async () => {
    const { container } = render(<FileUpload fileName="exemple.xlsx" />);
    await expectNoViolations(container);
  });

  it("MessageBanner", async () => {
    const { container } = render(
      <>
        <MessageBanner tone="info" title="Info">Exemple</MessageBanner>
        <MessageBanner tone="danger">Exemple</MessageBanner>
      </>,
    );
    await expectNoViolations(container);
  });

  it("StatusBadge (every tone)", async () => {
    const { container } = render(
      <>
        {(["danger", "warning", "success", "neutral", "info"] as const).map((tone) => (
          <StatusBadge key={tone} tone={tone} label={`Exemple ${tone}`} />
        ))}
      </>,
    );
    await expectNoViolations(container);
  });
});

describe("Escape closes", () => {
  it("Modal", () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Titre">
          Contenu
        </Modal>
      );
    }
    const { baseElement } = render(<Host />);
    const dialog = baseElement.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    // Browsers fire `cancel` on Escape for a modal dialog; jsdom does not
    // translate the key, so dispatch the event the browser would.
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(false);
  });

  it("DatePicker", () => {
    render(<DatePicker label="Date" value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Date"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Wave 1 behaviours", () => {
  it("Button loading is aria-busy, keeps its label and blocks clicks", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Envoyer</Button>);
    const button = screen.getByRole("button", { name: /Envoyer/ });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Button disabledReason stays focusable, is described, and blocks clicks", () => {
    const onClick = vi.fn();
    render(<Button disabledReason="Exemple de raison" onClick={onClick}>Valider</Button>);
    const button = screen.getByRole("button", { name: "Valider" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Exemple de raison")).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("StatusBadge draws an aria-hidden icon", () => {
    const { container } = render(<StatusBadge tone="success" label="Exemple" />);
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("Table headers have scope=col and caption renders", () => {
    const { container } = render(
      <Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="Vide" caption="Légende" />,
    );
    expect(container.querySelector("th")!.getAttribute("scope")).toBe("col");
    expect(container.querySelector("caption")!.textContent).toBe("Légende");
  });
});
