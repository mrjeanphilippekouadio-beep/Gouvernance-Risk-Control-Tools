import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import {
  Checkbox,
  ChecklistItem,
  Collapsible,
  FormField,
  Input,
  Modal,
  RadioGroup,
  RefusalDialog,
  ScaleEditor,
  Select,
  Skeleton,
  Stepper,
  Textarea,
  Tooltip,
} from "./index";
import type { ScaleValue } from "./index";

afterEach(cleanup);

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
  expect((await axe(container)).violations).toEqual([]);
}

const options = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
];

describe("M1 fields + FormField (E4-E6)", () => {
  it("links help, error, invalid and required to the control", () => {
    render(
      <FormField label="Nom" htmlFor="n" help="Aide exemple" required>
        <Input id="n" />
      </FormField>,
    );
    const input = screen.getByLabelText(/Nom/);
    expect(input.getAttribute("aria-describedby")).toBe("n-help");
    expect((input as HTMLInputElement).required).toBe(true);
    expect(screen.getByText("(obligatoire)")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("error replaces help and sets aria-invalid", () => {
    render(
      <FormField label="Nom" htmlFor="n" help="Aide" error="Erreur exemple">
        <Input id="n" />
      </FormField>,
    );
    const input = screen.getByLabelText("Nom");
    expect(input.getAttribute("aria-describedby")).toBe("n-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Erreur exemple");
  });

  it("works with a native control (backward compatible) and forwards disabled / readOnly", () => {
    render(
      <>
        <FormField label="Natif" htmlFor="x" error="Erreur">
          <input id="x" />
        </FormField>
        <FormField label="Lecture seule" htmlFor="r" readOnly>
          <Textarea id="r" defaultValue="Exemple" />
        </FormField>
        <FormField label="Désactivé" htmlFor="d" disabled>
          <Input id="d" />
        </FormField>
      </>,
    );
    expect(screen.getByLabelText("Natif").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Lecture seule")).toHaveProperty("readOnly", true);
    expect((screen.getByLabelText("Désactivé") as HTMLInputElement).disabled).toBe(true);
  });

  it("Select read-only shows the label, Select normal lists options", () => {
    const { rerender } = render(<Select aria-label="S" options={options} placeholder="Choisir" defaultValue="b" />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    rerender(<Select aria-label="S" options={options} value="b" readOnly />);
    expect((screen.getByLabelText("S") as HTMLInputElement).value).toBe("Option B");
  });

  it("RadioGroup selects, honours readOnly", () => {
    const onChange = vi.fn();
    const { rerender } = render(<RadioGroup legend="Choix" name="c" options={options} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Option B"));
    expect(onChange).toHaveBeenCalledWith("b");
    onChange.mockClear();
    rerender(<RadioGroup legend="Choix" name="c" options={options} value="a" onChange={onChange} readOnly />);
    fireEvent.click(screen.getByLabelText("Option B"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("axe — all states", async () => {
    const { container } = render(
      <>
        <FormField label="Texte" htmlFor="t" help="Aide" required>
          <Input id="t" />
        </FormField>
        <FormField label="Erreur" htmlFor="e" error="Erreur exemple">
          <Input id="e" />
        </FormField>
        <FormField label="Zone" htmlFor="z">
          <Textarea id="z" />
        </FormField>
        <FormField label="Liste" htmlFor="s">
          <Select id="s" options={options} placeholder="Choisir" />
        </FormField>
        <Checkbox label="Case" hint="Indication" />
        <Checkbox label="Désactivée" disabled />
        <RadioGroup legend="Radio" name="r" options={options} value="a" onChange={() => {}} help="Aide" required />
        <RadioGroup legend="Radio erreur" name="r2" options={options} value="" onChange={() => {}} error="Erreur" />
      </>,
    );
    await expectNoViolations(container);
  });
});

describe("M2 Modal + RefusalDialog (E14, E15)", () => {
  it("Modal is named by its title and focuses it on open", () => {
    render(
      <Modal open onClose={() => {}} title="Titre exemple" busy>
        Contenu
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Titre exemple" });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Titre exemple");
  });

  it("RefusalDialog lists the provided authorized people", async () => {
    const { baseElement } = render(
      <RefusalDialog open onClose={() => {}} action="Action exemple" reason="Raison exemple" authorized={["Exemple A", "Exemple B"]} />,
    );
    expect(screen.getByText("Personnes autorisées")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await expectNoViolations(baseElement);
  });

  it("RefusalDialog sensitive mode shows no name at all", async () => {
    const { baseElement } = render(
      <RefusalDialog open onClose={() => {}} action="Action exemple" reason="Raison exemple" authorized={["Exemple A"]} sensitive />,
    );
    expect(screen.getByText("Contactez la fonction conformité.")).toBeTruthy();
    expect(screen.queryByText("Exemple A")).toBeNull();
    expect(screen.queryByText("Personnes autorisées")).toBeNull();
    await expectNoViolations(baseElement);
  });

  it("RefusalDialog close button calls onClose", () => {
    const onClose = vi.fn();
    render(<RefusalDialog open onClose={onClose} action="A" reason="R" />);
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("M5 Stepper", () => {
  const steps = [
    { id: "s1", label: "Étape un" },
    { id: "s2", label: "Étape deux", error: true },
    { id: "s3", label: "Étape trois" },
    { id: "s4", label: "Étape quatre", disabled: true },
  ];

  it("exposes the current step and states as text", async () => {
    const { container } = render(<Stepper ariaLabel="Assistant exemple" steps={steps} current="s3" onStepChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Étape trois/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: /Étape un.*fait/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Étape deux.*en erreur/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: /Étape quatre.*à venir/ }) as HTMLButtonElement).disabled).toBe(true);
    await expectNoViolations(container);
  });

  it("arrow keys move focus, click changes step, read-only has no buttons", () => {
    const onStepChange = vi.fn();
    const { rerender } = render(<Stepper ariaLabel="A" steps={steps} current="s1" onStepChange={onStepChange} />);
    const first = screen.getByRole("button", { name: /Étape un/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Étape deux/ }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Étape trois/ }));
    fireEvent.click(document.activeElement as Element);
    expect(onStepChange).toHaveBeenCalledWith("s3");
    rerender(<Stepper ariaLabel="A" steps={steps} current="s1" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("M7 Tooltip (E26)", () => {
  it("opens on focus, closes on Escape, links via aria-describedby", async () => {
    const { container } = render(
      <Tooltip content="Raison exemple">
        <button type="button">Action</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Action" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    const tip = screen.getByRole("tooltip");
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    await expectNoViolations(container);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on hover and closes on leave", () => {
    render(
      <Tooltip content="Exemple">
        <button type="button">Action</button>
      </Tooltip>,
    );
    const wrap = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrap);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(wrap);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("M18 Skeleton (E7)", () => {
  it("is a status with an accessible label and decorative lines", async () => {
    const { container } = render(<Skeleton lines={4} />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Chargement en cours")).toBeTruthy();
    expect(container.querySelectorAll(".gs-skeleton-line")).toHaveLength(4);
    await expectNoViolations(container);
  });
});

describe("M6 Collapsible", () => {
  it("toggles aria-expanded and hides the region", async () => {
    const { container } = render(<Collapsible title="Paramètres avancés">Contenu exemple</Collapsible>);
    const button = screen.getByRole("button", { name: "Paramètres avancés" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(button.getAttribute("aria-controls") as string)?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Paramètres avancés" })).toBeTruthy();
    await expectNoViolations(container);
  });

  it("supports controlled mode", () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible title="T" open={false} onOpenChange={onOpenChange}>
        x
      </Collapsible>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("M9 ChecklistItem", () => {
  it("shows status as text and an action", async () => {
    const { container } = render(
      <>
        <ChecklistItem label="Exemple un" status="done" />
        <ChecklistItem label="Exemple deux" status="todo" detail="Il manque un exemple" action={<a href="#x">Compléter</a>} />
        <ChecklistItem label="Exemple trois" status="blocked" />
      </>,
    );
    expect(screen.getByText("Fait")).toBeTruthy();
    expect(screen.getByText("À compléter")).toBeTruthy();
    expect(screen.getByText("Bloqué")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Compléter" })).toBeTruthy();
    await expectNoViolations(container);
  });
});

describe("M3 ScaleEditor", () => {
  const levels = [
    { id: "l1", label: "Niveau 1" },
    { id: "l2", label: "Niveau 2" },
    { id: "l3", label: "Niveau 3" },
  ];
  const axes = [
    { id: "a1", label: "Axe 1" },
    { id: "a2", label: "Axe 2" },
  ];
  const limits = { minLevels: 3, maxLevels: 6, maxAxes: 7, ariaLabel: "Échelle exemple" };

  function Harness({ initial = {}, lv = levels }: { initial?: ScaleValue; lv?: typeof levels }) {
    const [value, setValue] = useState<ScaleValue>(initial);
    return <ScaleEditor levels={lv} axes={axes} value={value} onChange={setValue} {...limits} />;
  }

  it("counts filled cells, flags empty ones and has no violation", async () => {
    const { container } = render(<Harness initial={{ a1: { l1: "Texte exemple" } }} />);
    expect(screen.getByText("1 / 6 renseignés")).toBeTruthy();
    expect(screen.getAllByText("À compléter").length).toBe(5);
    await expectNoViolations(container);
  });

  it("is controlled: typing calls onChange with the merged value", () => {
    const onChange = vi.fn();
    render(<ScaleEditor levels={levels} axes={axes} value={{ a1: { l1: "x" } }} onChange={onChange} {...limits} />);
    fireEvent.change(screen.getByLabelText("Axe 2, Niveau 2"), { target: { value: "Nouveau" } });
    expect(onChange).toHaveBeenCalledWith({ a1: { l1: "x" }, a2: { l2: "Nouveau" } });
  });

  it("arrows move between cells at the text edge only; roving tabindex", () => {
    render(<Harness initial={{ a1: { l1: "ab" } }} />);
    const c11 = screen.getByLabelText("Axe 1, Niveau 1") as HTMLTextAreaElement;
    const c12 = screen.getByLabelText("Axe 1, Niveau 2");
    c11.focus();
    c11.setSelectionRange(1, 1);
    fireEvent.keyDown(c11, { key: "ArrowRight" });
    expect(document.activeElement).toBe(c11);
    c11.setSelectionRange(2, 2);
    fireEvent.keyDown(c11, { key: "ArrowRight" });
    expect(document.activeElement).toBe(c12);
    fireEvent.keyDown(c12, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("Axe 2, Niveau 2"));
    expect(screen.getByLabelText("Axe 2, Niveau 2").getAttribute("tabindex")).toBe("0");
    expect(c11.getAttribute("tabindex")).toBe("-1");
  });

  it("jumps to the first empty cell", () => {
    render(<Harness initial={{ a1: { l1: "a", l2: "b" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Aller à la première cellule vide" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Axe 1, Niveau 3"));
  });

  it("flags counts outside the limits given as props", () => {
    render(<Harness lv={levels.slice(0, 2)} />);
    expect(screen.getByRole("alert").textContent).toContain("entre 3 et 6");
  });
});
