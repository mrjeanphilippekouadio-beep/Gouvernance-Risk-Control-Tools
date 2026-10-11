import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { Button, DatePicker, StatusBadge, Table } from "./index";

afterEach(cleanup);

describe("QA-DS1a: Button backward compat", () => {
  it("QA-DS1a: sans nouvelles props, onClick appelé, pas d'aria-*", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ok</Button>);
    const b = screen.getByRole("button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b.getAttribute("aria-disabled")).toBeNull();
    expect(b.getAttribute("aria-busy")).toBeNull();
    expect(b.getAttribute("type")).toBe("button");
  });

  it("QA-DS1a: disabled natif seul reste inchangé (non cliquable, pas d'aria-disabled)", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Ok</Button>);
    const b = screen.getByRole("button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("QA-DS1a: aria-describedby fourni par l'appelant est conservé avec disabledReason", () => {
    render(<Button aria-describedby="ext" disabledReason="raison">Ok</Button>);
    const ids = screen.getByRole("button").getAttribute("aria-describedby")!.split(" ");
    expect(ids).toContain("ext");
    expect(ids.length).toBe(2);
  });

  it("QA-DS1a: disabled + disabledReason : natif gagne, raison toujours décrite", () => {
    const onClick = vi.fn();
    render(<Button disabled disabledReason="raison" onClick={onClick}>Ok</Button>);
    const b = screen.getByRole("button") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByText("raison")).toBeTruthy();
  });

  it("QA-DS1a: loading + disabledReason : aria-busy et raison, clic bloqué", () => {
    const onClick = vi.fn();
    render(<Button loading disabledReason="raison" onClick={onClick}>Ok</Button>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("QA-DS1a: submit en loading ne soumet pas le formulaire ; hors loading il soumet", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}><Button type="submit" loading>Go</Button></form>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<form onSubmit={onSubmit}><Button type="submit">Go</Button></form>);
    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("QA-DS1a: submit avec disabledReason ne soumet pas", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button type="submit" disabledReason="r">Go</Button></form>);
    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("QA-DS1a: deux boutons avec raison ont des ids de raison distincts", () => {
    render(<><Button disabledReason="a">A</Button><Button disabledReason="b">B</Button></>);
    const [x, y] = screen.getAllByRole("button").map((b) => b.getAttribute("aria-describedby"));
    expect(x).not.toBe(y);
  });
});

describe("QA-DS1a: Table", () => {
  const cols = [{ key: "n", header: "Nom", render: (r: { id: string }) => r.id }];
  it("QA-DS1a: vide + caption : pas de table, message affiché, pas de caption orpheline", () => {
    const { container } = render(
      <Table columns={cols} rows={[]} rowKey={(r) => r.id} loading={false} emptyMessage="Vide" caption="Légende" />,
    );
    expect(screen.getByText("Vide")).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("caption")).toBeNull();
  });
  it("QA-DS1a: sans caption, aucun <caption> rendu", () => {
    const { container } = render(
      <Table columns={cols} rows={[{ id: "1" }]} rowKey={(r) => r.id} loading={false} emptyMessage="Vide" />,
    );
    expect(container.querySelector("caption")).toBeNull();
  });
});

describe("QA-DS1a: StatusBadge", () => {
  it("QA-DS1a: ton inconnu (donnée runtime hors union) ne doit pas faire planter le rendu", () => {
    expect(() => render(<StatusBadge label="Inconnu" tone={"bogus" as never} />)).not.toThrow();
    expect(screen.getByText("Inconnu")).toBeTruthy();
  });
  it("QA-DS1a: ton undefined (map de statuts incomplète) ne doit pas faire planter le rendu", () => {
    expect(() => render(<StatusBadge label="X" tone={undefined as never} />)).not.toThrow();
  });
});

describe("QA-DS1a: DatePicker clavier", () => {
  it("QA-DS1a: valeur null -> champ vide, combobox fermé, pas d'aria-controls", () => {
    render(<DatePicker label="Date" value={null} onChange={() => {}} />);
    const i = screen.getByRole("combobox") as HTMLInputElement;
    expect(i.value).toBe("");
    expect(i.getAttribute("aria-expanded")).toBe("false");
    expect(i.getAttribute("aria-controls")).toBeNull();
  });
  it("QA-DS1a: valeur invalide -> champ vide, pas de plantage, ouverture clavier OK", () => {
    render(<DatePicker label="Date" value="pas-une-date" onChange={() => {}} />);
    const i = screen.getByRole("combobox") as HTMLInputElement;
    expect(i.value).toBe("");
    fireEvent.keyDown(i, { key: "Enter" });
    expect(i.getAttribute("aria-expanded")).toBe("true");
    const popId = i.getAttribute("aria-controls")!;
    expect(document.getElementById(popId)?.getAttribute("role")).toBe("dialog");
  });
  it("QA-DS1a: Espace ouvre, Escape ferme, onChange non appelé", () => {
    const onChange = vi.fn();
    render(<DatePicker label="Date" value={null} onChange={onChange} />);
    const i = screen.getByRole("combobox");
    fireEvent.keyDown(i, { key: " " });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("QA-DS1a: disabled -> Enter n'ouvre pas", () => {
    render(<DatePicker label="Date" value={null} onChange={() => {}} disabled />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("QA-DS1a: axe sur états non couverts", () => {
  it("QA-DS1a: Button loading+disabledReason, disabled+disabledReason, datepicker invalide ouvert", async () => {
    const { container } = render(
      <>
        <Button loading disabledReason="r1">A</Button>
        <Button disabled disabledReason="r2">B</Button>
        <DatePicker label="Date" value="invalide" onChange={() => {}} />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Date"));
    expect((await axe(container)).violations).toEqual([]);
  });
});
