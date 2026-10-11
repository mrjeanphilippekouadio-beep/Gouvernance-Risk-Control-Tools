import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { BulkActionBar, Button, Card, MatrixView, Modal, Table, Tabs, VersionComparison } from "./index";

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

async function expectNoViolations(container: HTMLElement) {
  expect((await axe(container)).violations).toEqual([]);
}

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [
  { id: "1", name: "Exemple A" },
  { id: "2", name: "Exemple B" },
  { id: "3", name: "Exemple C" },
];
const columns = [{ key: "name", header: "Nom", render: (r: Row) => r.name, sortable: true }];

describe("DS wave 2: Button sizes", () => {
  it("md is the default and adds no size class; sm and lg add theirs", () => {
    render(
      <>
        <Button>Moyen</Button>
        <Button size="sm">Petit</Button>
        <Button size="lg">Grand</Button>
      </>,
    );
    expect(screen.getByText("Moyen").className).not.toMatch(/btn-(sm|lg)/);
    expect(screen.getByText("Petit").className).toContain("btn-sm");
    expect(screen.getByText("Grand").className).toContain("btn-lg");
  });
});

describe("DS wave 2: Modal sizes", () => {
  it("applies md and lg classes; default keeps the historical class only", () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="T" />);
    expect(screen.getByRole("dialog", { hidden: true }).className).toBe("gs-modal");
    rerender(<Modal open onClose={() => {}} title="T" size="md" />);
    expect(screen.getByRole("dialog", { hidden: true }).className).toContain("gs-modal-md");
    rerender(<Modal open onClose={() => {}} title="T" size="lg" />);
    expect(screen.getByRole("dialog", { hidden: true }).className).toContain("gs-modal-lg");
  });
});

describe("DS wave 2: Table variants", () => {
  it("compact and striped add classes", () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="x" density="compact" striped />);
    const cls = screen.getByRole("table").className;
    expect(cls).toContain("gs-table-compact");
    expect(cls).toContain("gs-table-striped");
  });

  it("selection: marks rows, reports toggles, select-all and indeterminate", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={false}
        emptyMessage="x"
        caption="Exemple"
        selectedKeys={["2"]}
        onSelectionChange={onChange}
        selectionLabel={(r) => `Sélectionner ${r.name}`}
      />,
    );
    const rowB = screen.getByText("Exemple B").closest("tr")!;
    expect(rowB.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Exemple A").closest("tr")!.getAttribute("aria-selected")).toBe("false");
    const all = screen.getByLabelText("Tout sélectionner") as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(screen.getByLabelText("Sélectionner Exemple A"));
    expect(onChange).toHaveBeenLastCalledWith(["2", "1"]);
    fireEvent.click(screen.getByLabelText("Sélectionner Exemple B"));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(all);
    expect(onChange).toHaveBeenLastCalledWith(["1", "2", "3"]);
    await expectNoViolations(container);
  });

  it("sort: aria-sort reflects the state and the header button reports the key", async () => {
    const onSort = vi.fn();
    const { container } = render(
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={false}
        emptyMessage="x"
        caption="Exemple"
        sort={{ key: "name", direction: "asc" }}
        onSort={onSort}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Nom/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /Nom/ }));
    expect(onSort).toHaveBeenCalledWith("name");
    await expectNoViolations(container);
  });

  it("without selection props, no checkbox column and no aria-selected", () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="x" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Exemple A").closest("tr")!.hasAttribute("aria-selected")).toBe(false);
  });
});

describe("DS wave 2: Tabs disabled", () => {
  it("keeps the tab focusable, ignores click and announces the reason", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Tabs
        items={[
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true, disabledReason: "Exemple de raison" },
        ]}
        active="a"
        onChange={onChange}
      />,
    );
    const b = screen.getByRole("button", { name: "B" });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.hasAttribute("disabled")).toBe(false);
    expect(b.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Exemple de raison")).toBeTruthy();
    fireEvent.click(b);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith("a");
    await expectNoViolations(container);
  });
});

describe("DS wave 2: Card states", () => {
  it("selected announces itself in text; disabled is flagged", async () => {
    const { container } = render(
      <>
        <Card selected>Contenu 1</Card>
        <Card disabled>Contenu 2</Card>
        <Card>Contenu 3</Card>
      </>,
    );
    expect(screen.getByText("Sélectionné.")).toBeTruthy();
    expect(screen.getByText("Contenu 2").closest(".gs-card")!.getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelectorAll("[data-selected]").length).toBe(1);
    await expectNoViolations(container);
  });
});

describe("DS wave 2: BulkActionBar", () => {
  it("renders nothing at 0, pluralises, and clears", async () => {
    const onClear = vi.fn();
    const { container, rerender } = render(<BulkActionBar count={0} onClear={onClear} />);
    expect(container.querySelector(".gs-bulkbar")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<BulkActionBar count={1} onClear={onClear} />);
    expect(screen.getByRole("status").textContent).toBe("1 élément sélectionné");
    rerender(
      <BulkActionBar count={3} onClear={onClear}>
        <Button>Exemple</Button>
      </BulkActionBar>,
    );
    expect(screen.getByRole("status").textContent).toBe("3 éléments sélectionnés");
    fireEvent.click(screen.getByText("Tout désélectionner"));
    expect(onClear).toHaveBeenCalled();
    await expectNoViolations(container);
  });
});

describe("DS wave 2: VersionComparison", () => {
  it("shows old and new values, '(vide)' for null, and an honest empty state", async () => {
    const { container, rerender } = render(<VersionComparison changes={[{ field: "Nom", before: null, after: "Nouveau" }]} />);
    expect(screen.getByText("(vide)")).toBeTruthy();
    expect(screen.getByText("Nouveau")).toBeTruthy();
    await expectNoViolations(container);
    rerender(<VersionComparison changes={[]} />);
    expect(screen.getByText("Aucune différence entre ces deux versions.")).toBeTruthy();
  });
});

describe("DS wave 2: MatrixView", () => {
  it("renders a variable-size matrix with value and text label per cell", async () => {
    const { container } = render(
      <MatrixView
        caption="Exemple de matrice"
        rowTitle="Impact"
        columnTitle="Probabilité"
        rows={["I1", "I2", "I3"]}
        columns={["P1", "P2"]}
        cell={(r, c) => ({ value: String((r + 1) * (c + 1)), label: `Niveau ${r}-${c}`, tone: "info" })}
      />,
    );
    expect(container.querySelectorAll("tbody tr").length).toBe(3);
    expect(container.querySelectorAll("tbody td").length).toBe(6);
    expect(screen.getByText("Niveau 2-1")).toBeTruthy();
    await expectNoViolations(container);
  });
});
