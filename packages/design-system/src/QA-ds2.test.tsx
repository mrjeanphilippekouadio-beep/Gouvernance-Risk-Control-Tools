/// <reference types="node" />
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { BulkActionBar, Button, Card, MatrixView, Modal, Table, Tabs, VersionComparison } from "./index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

interface Row {
  id: string;
  name: string;
}
const mk = (...ids: string[]): Row[] => ids.map((id) => ({ id, name: `N${id}` }));
const cols = [
  { key: "name", header: "Nom", render: (r: Row) => r.name, sortable: true },
  { key: "plain", header: "Libre", render: () => "x" },
];
const headerBox = () => screen.getByRole("checkbox", { name: "Tout sélectionner" }) as HTMLInputElement;

function selTable(rows: Row[], selectedKeys: string[], onSelectionChange = vi.fn(), extra: object = {}) {
  return render(
    <Table columns={cols} rows={rows} rowKey={(r) => r.id} loading={false} emptyMessage="vide" selectedKeys={selectedKeys} onSelectionChange={onSelectionChange} {...extra} />,
  );
}

describe("QA-ds2 Table selection edge cases", () => {
  it("partial selection: header is indeterminate and unchecked; click selects all rows", () => {
    const onChange = vi.fn();
    selTable(mk("1", "2", "3"), ["2"], onChange);
    expect(headerBox().indeterminate).toBe(true);
    expect(headerBox().checked).toBe(false);
    fireEvent.click(headerBox());
    expect(onChange).toHaveBeenCalledWith(["1", "2", "3"]);
  });

  it("none selected: not indeterminate; all selected: checked, not indeterminate; click clears", () => {
    const onChange = vi.fn();
    const { rerender } = selTable(mk("1", "2"), [], onChange);
    expect(headerBox().indeterminate).toBe(false);
    expect(headerBox().checked).toBe(false);
    rerender(<Table columns={cols} rows={mk("1", "2")} rowKey={(r) => r.id} loading={false} emptyMessage="v" selectedKeys={["1", "2"]} onSelectionChange={onChange} />);
    expect(headerBox().checked).toBe(true);
    expect(headerBox().indeterminate).toBe(false);
    fireEvent.click(headerBox());
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("indeterminate is cleared on rerender when the selection becomes complete or empty", () => {
    const f = vi.fn();
    const { rerender } = selTable(mk("1", "2"), ["1"], f);
    expect(headerBox().indeterminate).toBe(true);
    rerender(<Table columns={cols} rows={mk("1", "2")} rowKey={(r) => r.id} loading={false} emptyMessage="v" selectedKeys={[]} onSelectionChange={f} />);
    expect(headerBox().indeterminate).toBe(false);
  });

  it("selectedKeys unknown to the rows do not make the header indeterminate/checked", () => {
    selTable(mk("1", "2"), ["ghost"]);
    expect(headerBox().indeterminate).toBe(false);
    expect(headerBox().checked).toBe(false);
    expect(screen.getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(0);
  });

  it("PIN: row toggle keeps stale keys, select-all drops them (inconsistent but harmless)", () => {
    const onChange = vi.fn();
    selTable(mk("1", "2"), ["ghost"], onChange);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" })[0]);
    expect(onChange).toHaveBeenLastCalledWith(["ghost", "1"]);
    fireEvent.click(headerBox());
    expect(onChange).toHaveBeenLastCalledWith(["1", "2"]);
  });

  it("deselecting a row from a full selection reports the remaining keys only", () => {
    const onChange = vi.fn();
    selTable(mk("1", "2", "3"), ["1", "2", "3"], onChange);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" })[1]);
    expect(onChange).toHaveBeenCalledWith(["1", "3"]);
  });

  it("selectedKeys with duplicates are reported deduplicated", () => {
    const onChange = vi.fn();
    selTable(mk("1", "2"), ["1", "1"], onChange);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" })[1]);
    expect(onChange).toHaveBeenCalledWith(["1", "2"]);
  });

  it("duplicate row keys: selecting one row marks both (shared key), report has one key; no crash", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    const { rerender } = selTable([{ id: "d", name: "A" }, { id: "d", name: "B" }], [], onChange);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" })[0]);
    expect(onChange).toHaveBeenCalledWith(["d"]);
    rerender(<Table columns={cols} rows={[{ id: "d", name: "A" }, { id: "d", name: "B" }]} rowKey={(r) => r.id} loading={false} emptyMessage="v" selectedKeys={["d"]} onSelectionChange={onChange} />);
    expect(headerBox().checked).toBe(true);
  });

  it("empty rows with selection props: shows the empty message, no checkbox, no throw", () => {
    selTable([], ["1"]);
    expect(screen.getByText("vide")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("loading with selection props: status only, no table", () => {
    render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading emptyMessage="v" selectedKeys={["1"]} onSelectionChange={() => {}} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("selectedKeys without onSelectionChange: no checkbox column and no aria-selected (display-only is ignored)", () => {
    render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" selectedKeys={["1"]} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getAllByRole("row")[1].getAttribute("aria-selected")).toBeNull();
    expect(screen.getAllByRole("row")[1].className).not.toContain("gs-table-row-selected");
  });

  it("selectionLabel names each row checkbox; select column header count stays aligned", () => {
    selTable(mk("1", "2"), [], vi.fn(), { selectionLabel: (r: Row) => `Choisir ${r.name}` });
    expect(screen.getByRole("checkbox", { name: "Choisir N2" })).toBeTruthy();
    const headerCells = screen.getAllByRole("columnheader");
    const firstRowCells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(headerCells).toHaveLength(firstRowCells.length);
  });

  it("selected rows carry aria-selected true/false", () => {
    selTable(mk("1", "2"), ["2"]);
    const [, r1, r2] = screen.getAllByRole("row");
    expect(r1.getAttribute("aria-selected")).toBe("false");
    expect(r2.getAttribute("aria-selected")).toBe("true");
  });

  it("no axe violation with selection + sort + caption", async () => {
    const { container } = selTable(mk("1", "2"), ["1"], vi.fn(), { caption: "Liste", sort: { key: "name", direction: "asc" }, onSort: () => {} });
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("QA-ds2 Table sort edge cases", () => {
  it("non sortable column: no button, no aria-sort; sortable column has a button", () => {
    render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" onSort={() => {}} />);
    const [nom, libre] = screen.getAllByRole("columnheader");
    expect(within(libre).queryByRole("button")).toBeNull();
    expect(libre.getAttribute("aria-sort")).toBeNull();
    expect(within(nom).getByRole("button")).toBeTruthy();
    expect(nom.getAttribute("aria-sort")).toBe("none");
  });

  it("onSort is called with the key of the sortable column only", () => {
    const onSort = vi.fn();
    render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" onSort={onSort} />);
    fireEvent.click(screen.getByRole("button", { name: /Nom/ }));
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onSort).toHaveBeenCalledWith("name");
    fireEvent.click(screen.getByText("Libre"));
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("sortable without onSort: plain header text, no button (nothing clickable that does nothing)", () => {
    render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sort on an unknown key leaves every sortable column at aria-sort none", () => {
    render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" sort={{ key: "nope", direction: "desc" }} onSort={() => {}} />);
    expect(screen.getAllByRole("columnheader")[0].getAttribute("aria-sort")).toBe("none");
  });

  it("sort desc -> descending; sort on a non sortable column key sets no aria-sort", () => {
    const { rerender } = render(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" sort={{ key: "name", direction: "desc" }} onSort={() => {}} />);
    expect(screen.getAllByRole("columnheader")[0].getAttribute("aria-sort")).toBe("descending");
    rerender(<Table columns={cols} rows={mk("1")} rowKey={(r) => r.id} loading={false} emptyMessage="v" sort={{ key: "plain", direction: "asc" }} onSort={() => {}} />);
    expect(screen.getAllByRole("columnheader")[1].getAttribute("aria-sort")).toBeNull();
  });

  it("the table never reorders rows itself", () => {
    render(<Table columns={cols} rows={mk("3", "1", "2")} rowKey={(r) => r.id} loading={false} emptyMessage="v" sort={{ key: "name", direction: "asc" }} onSort={() => {}} />);
    expect(screen.getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual(["N3x", "N1x", "N2x"]);
  });
});

describe("QA-ds2 Checkbox indeterminate", () => {
  it("Table header is the only consumer: row checkboxes are never indeterminate", () => {
    selTable(mk("1", "2"), ["1"]);
    for (const box of screen.getAllByRole("checkbox", { name: "Sélectionner la ligne" })) {
      expect((box as HTMLInputElement).indeterminate).toBe(false);
    }
  });
});

describe("QA-ds2 Tabs disabled", () => {
  const items = [
    { value: "a", label: "A" },
    { value: "b", label: "B", disabled: true, disabledReason: "Raison B" },
    { value: "c", label: "C", disabled: true },
  ];

  it("disabled tab stays focusable (no native disabled), real focus works", () => {
    render(<Tabs items={items} active="a" onChange={() => {}} />);
    const b = screen.getByRole("button", { name: "B" }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    b.focus();
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-disabled")).toBe("true");
  });

  it("click and keyboard-originated click (Enter/Space on a button) are ignored; enabled tab fires", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} active="a" onChange={onChange} />);
    const b = screen.getByRole("button", { name: "B" });
    fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.keyDown(b, { key: "ArrowRight" });
    fireEvent.click(b);
    fireEvent.click(screen.getByRole("button", { name: "C" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("reason is exposed through aria-describedby; disabled without a reason has none; reason without disabled is not rendered", () => {
    render(<Tabs items={[...items, { value: "d", label: "D", disabledReason: "ignorée" }]} active="a" onChange={() => {}} />);
    const b = screen.getByRole("button", { name: "B" });
    const id = b.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.textContent).toBe("Raison B");
    expect(screen.getByRole("button", { name: "C" }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByRole("button", { name: "D" }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText("ignorée")).toBeNull();
  });

  // DEFECT-DS2-02 (MINOR): reason id is built from item.value; a value with a space splits the IDREF list.
  it("tab values containing spaces produce an aria-describedby id that still resolves", () => {
    render(<Tabs items={[{ value: "mon onglet", label: "X", disabled: true, disabledReason: "R" }]} active="zz" onChange={() => {}} />);
    const id = screen.getByRole("button", { name: "X" }).getAttribute("aria-describedby") as string;
    // aria-describedby is a space separated IDREF list: an id with a space is split into 2 refs.
    expect(id.includes(" ")).toBe(false);
  });

  it("active + disabled: aria-current stays and disabled marker applied; no axe violation", async () => {
    const { container } = render(<Tabs items={items} active="b" onChange={() => {}} />);
    const b = screen.getByRole("button", { name: "B" });
    expect(b.getAttribute("aria-current")).toBe("page");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("two Tabs instances never share reason ids", () => {
    render(
      <>
        <Tabs items={items} active="a" onChange={() => {}} />
        <Tabs items={items} active="a" onChange={() => {}} />
      </>,
    );
    const ids = screen.getAllByRole("button", { name: "B" }).map((b) => b.getAttribute("aria-describedby"));
    expect(new Set(ids).size).toBe(2);
  });
});

describe("QA-ds2 Button", () => {
  it("loading and disabledReason block onClick for every size; className is merged with size", () => {
    const onClick = vi.fn();
    render(
      <>
        <Button size="lg" loading onClick={onClick}>L</Button>
        <Button size="sm" disabledReason="non" onClick={onClick} className="extra">S</Button>
      </>,
    );
    fireEvent.click(screen.getByText("L"));
    fireEvent.click(screen.getByText("S"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText("S").className).toMatch(/btn-sm.*extra|extra.*btn-sm/);
  });

  it("BulkActionBar clear button is a small Button", () => {
    render(<BulkActionBar count={2} onClear={() => {}} />);
    expect(screen.getByRole("button", { name: "Tout désélectionner" }).className).toContain("btn-sm");
  });
});

describe("QA-ds2 Modal sizes", () => {
  it("size css: lg/md only override width, so the base max-width cap (viewport - 32px) still applies on narrow screens", () => {
    const css = readFileSync("src/Modal.css", "utf8");
    expect(css).toMatch(/\.gs-modal\s*{[^}]*max-width:\s*calc\(100vw - 32px\)/);
    const lg = /\.gs-modal-lg\s*{([^}]*)}/.exec(css)?.[1] ?? "";
    expect(lg).toMatch(/width:\s*800px/);
    expect(lg).not.toMatch(/max-width|min-width/);
  });

  it("an unexpected size at runtime (JS caller) yields an unknown class but no crash", () => {
    render(<Modal open onClose={() => {}} title="T" size={"xl" as never} />);
    expect(screen.getByRole("dialog", { hidden: true }).className).toBe("gs-modal gs-modal-xl");
  });
});

describe("QA-ds2 MatrixView", () => {
  const cell = (r: number, c: number) => ({ value: `${r}${c}`, label: `L${r}${c}`, tone: "neutral" as const });

  it("0 rows and 0 columns: renders header only, no throw", () => {
    render(<MatrixView rows={[]} columns={[]} rowTitle="I" columnTitle="P" cell={cell} caption="M" />);
    expect(screen.getByRole("table", { name: "M" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("0 columns with rows: row headers only; cell callback never called", () => {
    const spy = vi.fn(cell);
    render(<MatrixView rows={["a", "b"]} columns={[]} rowTitle="I" columnTitle="P" cell={spy} caption="M" />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("rowheader")).toHaveLength(2);
  });

  it("0 rows with columns: only column headers", () => {
    const spy = vi.fn(cell);
    render(<MatrixView rows={[]} columns={["x", "y"]} rowTitle="I" columnTitle="P" cell={spy} caption="M" />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
  });

  it("non square 2x4 matrix calls cell exactly once per (row, column) with correct indexes", () => {
    const spy = vi.fn(cell);
    render(<MatrixView rows={["a", "b"]} columns={["1", "2", "3", "4"]} rowTitle="I" columnTitle="P" cell={spy} caption="M" />);
    expect(spy).toHaveBeenCalledTimes(8);
    expect(spy).toHaveBeenCalledWith(1, 3);
    expect(screen.getByText("L13")).toBeTruthy();
  });

  it("irregular cell data: empty value and empty label render without crash", () => {
    render(<MatrixView rows={["a"]} columns={["1"]} rowTitle="I" columnTitle="P" cell={() => ({ value: "", label: "", tone: "neutral" })} caption="M" />);
    expect(screen.getAllByRole("cell")).toHaveLength(1);
  });

  it("cell callback returning undefined (contract violation) throws, it is not swallowed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<MatrixView rows={["a"]} columns={["1"]} rowTitle="I" columnTitle="P" cell={(() => undefined) as never} caption="M" />)).toThrow();
  });

  it("duplicate row/column labels: every cell still rendered (keys collide but initial mount keeps all)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MatrixView rows={["a", "a"]} columns={["1", "1"]} rowTitle="I" columnTitle="P" cell={cell} caption="M" />);
    expect(screen.getAllByRole("cell")).toHaveLength(4);
  });

  it("tone is accompanied by a text label in every cell", async () => {
    const { container } = render(<MatrixView rows={["a", "b"]} columns={["1", "2"]} rowTitle="I" columnTitle="P" cell={cell} caption="M" />);
    expect(screen.getByText("L11")).toBeTruthy();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("QA-ds2 VersionComparison", () => {
  const cellsOf = (row: number) => within(screen.getAllByRole("row")[row]).getAllByRole("cell").map((c) => c.textContent);

  it("null before/after render the (vide) marker", () => {
    render(<VersionComparison changes={[{ field: "f", before: null, after: null }]} />);
    expect(cellsOf(1)).toEqual(["f", "(vide)", "(vide)"]);
  });

  it("undefined (absent at runtime) is treated like null", () => {
    render(<VersionComparison changes={[{ field: "f", before: undefined as never, after: "v" }]} />);
    expect(cellsOf(1)).toEqual(["f", "(vide)", "v"]);
  });

  it("PIN: empty string and '0' are shown as is, not as (vide)", () => {
    render(<VersionComparison changes={[{ field: "e", before: "", after: "0" }]} />);
    expect(cellsOf(1)).toEqual(["e", "", "0"]);
  });

  it("object/array values render as a safe text node, never crash (F-DS2-01)", () => {
    render(<VersionComparison changes={[{ field: "o", before: { a: 1 } as never, after: [1] as never }]} />);
    expect(cellsOf(1)).toEqual(["o", "(valeur complexe)", "(valeur complexe)"]);
  });

  it("numbers and booleans are stringified, including false", () => {
    render(<VersionComparison changes={[{ field: "n", before: 0 as never, after: false as never }]} />);
    expect(cellsOf(1)).toEqual(["n", "0", "false"]);
  });

  it("duplicate field names do not crash and both rows appear", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<VersionComparison changes={[{ field: "d", before: "1", after: "2" }, { field: "d", before: "3", after: "4" }]} />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("empty -> explicit message; loading wins over empty", () => {
    const { rerender } = render(<VersionComparison changes={[]} />);
    expect(screen.getByText("Aucune différence entre ces deux versions.")).toBeTruthy();
    rerender(<VersionComparison changes={[]} loading />);
    expect(screen.queryByText("Aucune différence entre ces deux versions.")).toBeNull();
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });

  it("markup in values is escaped (rendered as text)", () => {
    render(<VersionComparison changes={[{ field: "x", before: "<b>gras</b>", after: "<img src=x onerror=alert(1)>" }]} />);
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("QA-ds2 BulkActionBar", () => {
  it("count 0 and negative: no bar, live region mounted but empty (NaN <= 0 is false: see next test)", () => {
    const { container, rerender } = render(<BulkActionBar count={0} onClear={() => {}} />);
    expect(container.querySelector(".gs-bulkbar")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<BulkActionBar count={-3} onClear={() => {}} />);
    expect(container.querySelector(".gs-bulkbar")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("PIN: NaN count renders a bar reading 'NaN élément sélectionné' (caller bug, not guarded)", () => {
    render(<BulkActionBar count={Number.NaN} onClear={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("NaN élément sélectionné");
  });

  it("singular at 1, plural at 2; clear fires once", () => {
    const onClear = vi.fn();
    const { rerender } = render(<BulkActionBar count={1} onClear={onClear} />);
    expect(screen.getByRole("status").textContent).toBe("1 élément sélectionné");
    rerender(<BulkActionBar count={2} onClear={onClear} />);
    expect(screen.getByRole("status").textContent).toBe("2 éléments sélectionnés");
    fireEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("QA-ds2 Card states", () => {
  it("selected + disabled both applied; selected text present", () => {
    const { container } = render(<Card selected disabled>c</Card>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("gs-card-selected");
    expect(el.className).toContain("gs-card-disabled");
    expect(screen.getByText("Sélectionné.")).toBeTruthy();
  });

  it("selected=false / disabled=false leave no attribute", () => {
    const { container } = render(<Card selected={false} disabled={false}>c</Card>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.hasAttribute("data-selected")).toBe(false);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
  });

  // Card.tsx documents "Unavailable state: muted, not interactive" but only sets
  // aria-disabled on a role-less div; children stay clickable. Gap reported to the dev.
  it("DEFECT-DS2-01: a button inside a disabled Card is not activatable", () => {
    const onClick = vi.fn();
    render(<Card disabled><button onClick={onClick}>go</button></Card>);
    fireEvent.click(screen.getByText("go"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("aria-disabled on the role-less div passes axe (documented: no effect for AT without a role)", async () => {
    const { container } = render(<Card disabled>c</Card>);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("QA-ds2 Button.css regression guard (inline-flex)", () => {
  const css = readFileSync("src/Button.css", "utf8");
  it("keeps vertical padding so wrapped labels breathe; heights stay min-height", () => {
    expect(css).toMatch(/\.btn\s*{[^}]*padding:\s*var\(--gs-space-2\) var\(--gs-space-4\)/);
    expect(css).toMatch(/min-height:\s*40px/);
  });
});
