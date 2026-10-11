import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Collapsible, FormField, Input, Modal, RefusalDialog, ScaleEditor, Stepper, Textarea, Tooltip } from "./index";
import type { ScaleValue } from "./index";

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
    this.dispatchEvent(new Event("close"));
  };
});

/** Fails the test if React logged any warning/error while `fn` ran. */
function noReactWarning(fn: () => void) {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fn();
  expect(spy).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
}

describe("QA-DS1b: FormField compatibilité ascendante", () => {
  it("QA-DS1b: enfant texte, fragment, null, false : pas de crash ni d'avertissement", () => {
    noReactWarning(() => {
      render(<FormField label="A" htmlFor="a" help="h">texte seul</FormField>);
      render(<FormField label="B" htmlFor="b" error="e"><><input id="b" /></></FormField>);
      render(<FormField label="C" htmlFor="c">{null}</FormField>);
      render(<FormField label="D" htmlFor="d">{false}</FormField>);
    });
    expect(screen.getByText("texte seul")).toBeTruthy();
    expect(document.getElementById("b")?.getAttribute("aria-describedby")).toBeNull();
  });

  it("QA-DS1b: plusieurs enfants laissés intacts (aucun aria ajouté)", () => {
    noReactWarning(() => {
      render(
        <FormField label="M" htmlFor="m" help="aide" error="err" required>
          <input id="m" />
          <span>suffixe</span>
        </FormField>,
      );
    });
    const input = document.getElementById("m") as HTMLInputElement;
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(input.required).toBe(false);
  });

  it("QA-DS1b: aria-describedby existant de l'enfant fusionné avec l'aide", () => {
    render(
      <FormField label="N" htmlFor="n" help="aide">
        <input id="n" aria-describedby="ext" />
      </FormField>,
    );
    expect(document.getElementById("n")?.getAttribute("aria-describedby")).toBe("ext n-help");
  });

  it("QA-DS1b: sans help/error/required, l'enfant natif n'a aucun attribut ARIA ajouté", () => {
    render(
      <FormField label="P" htmlFor="p">
        <select id="p"><option>x</option></select>
      </FormField>,
    );
    const el = document.getElementById("p")!;
    expect(el.getAttribute("aria-describedby")).toBeNull();
    expect(el.getAttribute("aria-invalid")).toBeNull();
    expect(el.hasAttribute("required")).toBe(false);
  });

  it("QA-DS1b: required/disabled natifs de l'enfant conservés quand FormField ne les fixe pas", () => {
    render(
      <FormField label="Q" htmlFor="q">
        <input id="q" required disabled />
      </FormField>,
    );
    const el = document.getElementById("q") as HTMLInputElement;
    expect(el.required).toBe(true);
    expect(el.disabled).toBe(true);
  });

  it("QA-DS1b: composant personnalisé qui ignore les props : pas d'avertissement, label lié", () => {
    const Custom = (_props: { "aria-describedby"?: string }) => <input id="cu" />;
    noReactWarning(() => {
      render(
        <FormField label="Cu" htmlFor="cu" error="e" required>
          <Custom />
        </FormField>,
      );
    });
    expect(screen.getByLabelText(/Cu/)).toBeTruthy();
  });

  it("QA-DS1b: usage RolesAdmin (div wrapper + input, sans help/error) : div non altérée", () => {
    render(
      <FormField label="Rechercher" htmlFor="ps">
        <div className="w"><input id="ps" /></div>
      </FormField>,
    );
    const div = document.querySelector(".w")!;
    expect(div.getAttributeNames()).toEqual(["class"]);
  });

  it("QA-DS1b: usage RisksPage (enfant conditionnel select/input) lié à l'aide", () => {
    const show = (dir: boolean) => (
      <FormField label="Owner" htmlFor="o" help="Laisser vide">
        {dir ? <select id="o"><option>a</option></select> : <input id="o" />}
      </FormField>
    );
    const { rerender } = render(show(true));
    expect(document.getElementById("o")?.getAttribute("aria-describedby")).toBe("o-help");
    rerender(show(false));
    expect(document.getElementById("o")?.getAttribute("aria-describedby")).toBe("o-help");
  });

  it("QA-DS1b: usage AuditFindings (textarea + error) : invalid + erreur annoncée, effacée ensuite", () => {
    const { rerender } = render(
      <FormField label="Com" htmlFor="c" error="Obligatoire"><textarea id="c" /></FormField>,
    );
    const ta = document.getElementById("c")!;
    expect(ta.getAttribute("aria-invalid")).toBe("true");
    expect(ta.getAttribute("aria-describedby")).toBe("c-error");
    rerender(<FormField label="Com" htmlFor="c"><textarea id="c" /></FormField>);
    expect(ta.getAttribute("aria-invalid")).toBeNull();
    expect(ta.getAttribute("aria-describedby")).toBeNull();
  });

  // BUG latent FormField.tsx:36-40 : un wrapper <div> reçoit aria-describedby/required/disabled
  // (le contrôle réel n'est pas lié), alors que la JSDoc promet "wrapped children are left untouched".
  it("QA-DS1b: fixed — wrapper div avec error/required devrait rester intact", () => {
    render(
      <FormField label="W" htmlFor="w" error="err" required>
        <div className="w2"><input id="w" /></div>
      </FormField>,
    );
    expect(document.querySelector(".w2")!.getAttributeNames()).toEqual(["class"]);
  });

  // BUG latent FormField.tsx:38 : aria-invalid posé par l'enfant est écrasé par undefined.
  it("QA-DS1b: fixed — aria-invalid propre à l'enfant doit être conservé", () => {
    render(
      <FormField label="I" htmlFor="i">
        <input id="i" aria-invalid="true" />
      </FormField>,
    );
    expect(document.getElementById("i")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("QA-DS1b: Input/Textarea via FormField : disabled et readOnly propagés", () => {
    render(
      <>
        <FormField label="I1" htmlFor="i1" disabled><Input id="i1" /></FormField>
        <FormField label="T1" htmlFor="t1" readOnly><Textarea id="t1" /></FormField>
      </>,
    );
    expect((document.getElementById("i1") as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById("t1") as HTMLTextAreaElement).readOnly).toBe(true);
  });
});

describe("QA-DS1b: Modal", () => {
  function FormInModal({ onSubmit }: { onSubmit: (v: string) => void }) {
    const [v, setV] = useState("");
    return (
      <Modal open onClose={() => {}} title="Clôture">
        <FormField label="Commentaire" htmlFor="cm" error={v === "" ? "Obligatoire" : undefined}>
          <textarea id="cm" value={v} onChange={(e) => setV(e.target.value)} />
        </FormField>
        <button type="button" onClick={() => onSubmit(v)}>Valider</button>
      </Modal>
    );
  }

  it("QA-DS1b: formulaire dans Modal : saisie et action fonctionnent, focus initial sur le titre", () => {
    const onSubmit = vi.fn();
    render(<FormInModal onSubmit={onSubmit} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Clôture", hidden: true }));
    const ta = document.getElementById("cm") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "ok" } });
    expect(ta.value).toBe("ok");
    expect(ta.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(screen.getByText("Valider"));
    expect(onSubmit).toHaveBeenCalledWith("ok");
  });

  it("QA-DS1b: dialog nommé par son titre ; busy -> aria-busy, absent sinon", () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="T">x</Modal>);
    const d = document.querySelector("dialog")!;
    const id = d.getAttribute("aria-labelledby")!;
    expect(document.getElementById(id)?.textContent).toBe("T");
    expect(d.getAttribute("aria-busy")).toBeNull();
    rerender(<Modal open onClose={() => {}} title="T" busy>x</Modal>);
    expect(d.getAttribute("aria-busy")).toBe("true");
  });

  it("QA-DS1b: fermeture -> onClose ; rouverture -> titre refocalisé", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Modal open onClose={onClose} title="T">x</Modal>);
    rerender(<Modal open={false} onClose={onClose} title="T">x</Modal>);
    expect(onClose).toHaveBeenCalled();
    rerender(<Modal open onClose={onClose} title="T">x</Modal>);
    expect(document.activeElement?.tagName).toBe("H2");
  });

  // REGRESSION Modal.tsx:36 : React `autoFocus` ne pose PAS l'attribut `autofocus` ;
  // querySelector("[autofocus]") ne le voit donc pas et le titre vole le focus
  // (cas réel : AppetitePage.tsx:88, textarea autoFocus dans Modal).
  it("QA-DS1b: fixed — enfant React autoFocus conserve le focus à l'ouverture", () => {
    render(
      <Modal open onClose={() => {}} title="Retrait">
        <textarea id="af" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(document.getElementById("af"));
  });
});

describe("QA-DS1b: RefusalDialog sensitive", () => {
  const names = ["Alice Martin", "Bob Durand"];
  it("QA-DS1b: sensitive + authorized fourni : aucun nom, aucun titre de liste, contact conformité", () => {
    render(<RefusalDialog open onClose={() => {}} action="Valider" reason="Interdit" authorized={names} sensitive />);
    const html = document.body.innerHTML;
    for (const n of names) expect(html).not.toContain(n);
    expect(screen.queryByText("Personnes autorisées")).toBeNull();
    expect(document.querySelector("li")).toBeNull();
    expect(screen.getByText("Contactez la fonction conformité.")).toBeTruthy();
  });

  it("QA-DS1b: sensitive + authorized vide ou absent : aucun nom ni message 'Aucune personne'", () => {
    render(<RefusalDialog open onClose={() => {}} action="A" reason="R" sensitive />);
    expect(screen.queryByText(/Aucune personne/)).toBeNull();
  });

  it("QA-DS1b: non sensitive : noms listés, doublons sans avertissement ; vide -> message", () => {
    noReactWarning(() => {
      render(<RefusalDialog open onClose={() => {}} action="A" reason="R" authorized={["X", "X"]} />);
    });
    expect(screen.getAllByText("X")).toHaveLength(2);
    cleanup();
    render(<RefusalDialog open onClose={() => {}} action="A" reason="R" authorized={[]} />);
    expect(screen.getByText("Aucune personne n'est indiquée.")).toBeTruthy();
  });

  it("QA-DS1b: bouton Fermer appelle onClose", () => {
    const onClose = vi.fn();
    render(<RefusalDialog open onClose={onClose} action="A" reason="R" sensitive />);
    fireEvent.click(screen.getByText("Fermer"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("QA-DS1b: ScaleEditor", () => {
  const mk = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, label: `${p.toUpperCase()}${i}` }));
  const props = { minLevels: 3, maxLevels: 6, maxAxes: 7, ariaLabel: "Échelle" };

  it("QA-DS1b: 3..6 niveaux x 1..7 axes (bornes) : grille complète, aucune alerte", () => {
    for (const [l, a] of [[3, 1], [6, 7], [3, 7], [6, 1]]) {
      render(<ScaleEditor {...props} levels={mk(l, "l")} axes={mk(a, "a")} value={{}} onChange={() => {}} />);
      expect(screen.getAllByRole("textbox")).toHaveLength(l * a);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText(`0 / ${l * a} renseignés`)).toBeTruthy();
      cleanup();
    }
  });

  it("QA-DS1b: hors bornes (2 ou 7 niveaux, 0 ou 8 axes) : alerte, pas de crash", () => {
    for (const [l, a] of [[2, 1], [7, 1], [3, 0], [3, 8]]) {
      render(<ScaleEditor {...props} levels={mk(l, "l")} axes={mk(a, "a")} value={{}} onChange={() => {}} />);
      expect(screen.getByRole("alert")).toBeTruthy();
      cleanup();
    }
  });

  it("QA-DS1b: valeurs vides/espaces -> 'À compléter', compteur ignore les espaces", () => {
    const value: ScaleValue = { a0: { l0: "   ", l1: "ok" } };
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(1, "a")} value={value} onChange={() => {}} />);
    expect(screen.getAllByText("À compléter")).toHaveLength(2);
    expect(screen.getByText("1 / 3 renseignés")).toBeTruthy();
  });

  it("QA-DS1b: onChange immuable : nouvel objet, autres cellules préservées, entrée non mutée", () => {
    const value: ScaleValue = { a0: { l0: "x" }, a1: { l1: "y" } };
    const snapshot = JSON.stringify(value);
    const onChange = vi.fn();
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(2, "a")} value={value} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("A0, L1"), { target: { value: "nouveau" } });
    const next = onChange.mock.calls[0][0] as ScaleValue;
    expect(next).not.toBe(value);
    expect(next.a0).not.toBe(value.a0);
    expect(next.a1).toBe(value.a1);
    expect(next.a0).toEqual({ l0: "x", l1: "nouveau" });
    expect(JSON.stringify(value)).toBe(snapshot);
  });

  it("QA-DS1b: composant contrôlé : sans mise à jour du parent la valeur ne change pas", () => {
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(1, "a")} value={{}} onChange={() => {}} />);
    const ta = screen.getByLabelText("A0, L0") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "z" } });
    expect(ta.value).toBe("");
  });

  function nav(key: string, from: string, caret: "start" | "end" | "mid") {
    const value: ScaleValue = { a0: { l0: "abc", l1: "abc", l2: "abc" }, a1: { l0: "abc", l1: "abc", l2: "abc" } };
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(2, "a")} value={value} onChange={() => {}} />);
    const el = screen.getByLabelText(from) as HTMLTextAreaElement;
    el.focus();
    const pos = caret === "start" ? 0 : caret === "end" ? 3 : 1;
    el.setSelectionRange(pos, pos);
    const notPrevented = fireEvent.keyDown(el, { key });
    return { el, notPrevented };
  }

  it("QA-DS1b: flèches aux bords : pas de sortie de grille, pas de preventDefault", () => {
    for (const [key, from, caret] of [
      ["ArrowLeft", "A0, L0", "start"],
      ["ArrowUp", "A0, L0", "start"],
      ["ArrowRight", "A1, L2", "end"],
      ["ArrowDown", "A1, L2", "end"],
    ] as const) {
      const { el, notPrevented } = nav(key, from, caret);
      expect(notPrevented).toBe(true);
      expect(document.activeElement).toBe(el);
      cleanup();
    }
  });

  it("QA-DS1b: flèches : déplacement quand le curseur est au bord, texte préservé sinon", () => {
    let r = nav("ArrowRight", "A0, L0", "end");
    expect(r.notPrevented).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("A0, L1"));
    cleanup();
    r = nav("ArrowDown", "A0, L1", "end");
    expect(document.activeElement).toBe(screen.getByLabelText("A1, L1"));
    cleanup();
    r = nav("ArrowRight", "A0, L0", "mid");
    expect(r.notPrevented).toBe(true);
    expect(document.activeElement).toBe(r.el);
    cleanup();
    r = nav("ArrowLeft", "A0, L1", "start");
    expect(document.activeElement).toBe(screen.getByLabelText("A0, L0"));
  });

  it("QA-DS1b: un seul tab stop (roving tabindex)", () => {
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(2, "a")} value={{}} onChange={() => {}} />);
    expect(screen.getAllByRole("textbox").filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });

  it("QA-DS1b: 'première cellule vide' focalise la bonne cellule, désactivé si tout rempli", () => {
    const value: ScaleValue = { a0: { l0: "x", l1: "y" } };
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(1, "a")} value={value} onChange={() => {}} />);
    fireEvent.click(screen.getByText("Aller à la première cellule vide"));
    expect(document.activeElement).toBe(screen.getByLabelText("A0, L2"));
    cleanup();
    const full: ScaleValue = { a0: { l0: "x", l1: "y", l2: "z" } };
    render(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(1, "a")} value={full} onChange={() => {}} />);
    expect((screen.getByText("Aller à la première cellule vide") as HTMLButtonElement).disabled).toBe(true);
  });

  // BUG ScaleEditor.tsx:45,114 : `active` n'est pas recalé quand la grille rétrécit ;
  // si la cellule active disparaît, plus aucune cellule n'a tabIndex=0 (grille inaccessible au Tab).
  it("QA-DS1b: fixed — grille rétrécie : un tab stop doit subsister", () => {
    const value: ScaleValue = {};
    const { rerender } = render(<ScaleEditor {...props} levels={mk(4, "l")} axes={mk(1, "a")} value={value} onChange={() => {}} />);
    fireEvent.focus(screen.getByLabelText("A0, L3"));
    rerender(<ScaleEditor {...props} levels={mk(3, "l")} axes={mk(1, "a")} value={value} onChange={() => {}} />);
    expect(screen.getAllByRole("textbox").filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });

  // BUG ScaleEditor.tsx:112 : ids `${axe}-${niveau}-empty` non uniques entre deux instances
  // (même page, mêmes ids d'axes/niveaux) -> aria-describedby ambigu.
  it("QA-DS1b: fixed — deux ScaleEditor sur la page : ids uniques", () => {
    const el = (
      <ScaleEditor {...props} levels={mk(3, "l")} axes={mk(1, "a")} value={{}} onChange={() => {}} />
    );
    render(<>{el}{el}</>);
    const ids = Array.from(document.querySelectorAll("[id]")).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("QA-DS1b: Stepper", () => {
  const steps = [
    { id: "a", label: "Un" },
    { id: "b", label: "Deux", disabled: true },
    { id: "c", label: "Trois", error: true },
    { id: "d", label: "Quatre" },
  ];

  it("QA-DS1b: états, aria-current, texte d'état pour lecteurs d'écran", () => {
    render(<Stepper steps={steps} current="a" onStepChange={() => {}} ariaLabel="Étapes" />);
    expect(screen.getByRole("button", { name: /Un/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: /Trois.*en erreur/ })).toBeTruthy();
    expect(screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current"))).toHaveLength(1);
  });

  it("QA-DS1b: flèches/Home/End sautent l'étape désactivée et restent aux bords", () => {
    render(<Stepper steps={steps} current="a" onStepChange={() => {}} ariaLabel="Étapes" />);
    const [b1, , b4] = [screen.getByRole("button", { name: /Un/ }), 0, screen.getByRole("button", { name: /Quatre/ })];
    const b3 = screen.getByRole("button", { name: /Trois/ });
    b1.focus();
    fireEvent.keyDown(b1, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b3);
    fireEvent.keyDown(b3, { key: "End" });
    expect(document.activeElement).toBe(b4);
    fireEvent.keyDown(b4, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b4);
    fireEvent.keyDown(b4, { key: "Home" });
    expect(document.activeElement).toBe(b1);
    fireEvent.keyDown(b1, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(b1);
  });

  it("QA-DS1b: étape désactivée non cliquable ; clic appelle onStepChange(id)", () => {
    const onStepChange = vi.fn();
    render(<Stepper steps={steps} current="a" onStepChange={onStepChange} ariaLabel="Étapes" />);
    fireEvent.click(screen.getByRole("button", { name: /Deux/ }));
    expect(onStepChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Quatre/ }));
    expect(onStepChange).toHaveBeenCalledWith("d");
  });

  it("QA-DS1b: lecture seule (sans onStepChange) : aucun bouton ; current inconnu : pas de crash", () => {
    noReactWarning(() => {
      render(<Stepper steps={steps} current="zzz" ariaLabel="Étapes" />);
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("QA-DS1b: liste d'étapes vide : pas de crash", () => {
    noReactWarning(() => {
      render(<Stepper steps={[]} current="a" onStepChange={() => {}} ariaLabel="Vide" />);
    });
  });
});

describe("QA-DS1b: Tooltip", () => {
  it("QA-DS1b: focus ouvre (aria-describedby), blur ferme", () => {
    render(<Tooltip content="Aide"><button>Bouton</button></Tooltip>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-describedby")).toBeNull();
    fireEvent.focus(b);
    const tip = screen.getByRole("tooltip");
    expect(b.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.blur(b);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(b.getAttribute("aria-describedby")).toBeNull();
  });

  it("QA-DS1b: Échap ferme sans retirer le focus ; survol ouvre/ferme", () => {
    render(<Tooltip content="Aide"><button>Bouton</button></Tooltip>);
    const b = screen.getByRole("button");
    b.focus();
    fireEvent.focus(b);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(b);
    fireEvent.mouseEnter(b.parentElement!);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(b.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("QA-DS1b: aria-describedby existant conservé et fusionné", () => {
    render(<Tooltip content="Aide"><button aria-describedby="ext">B</button></Tooltip>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-describedby")).toBe("ext");
    fireEvent.focus(b);
    expect(b.getAttribute("aria-describedby")).toMatch(/^ext .+/);
  });

  it("QA-DS1b: listener Escape retiré au démontage (pas de fuite)", () => {
    const rm = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<Tooltip content="A"><button>B</button></Tooltip>);
    fireEvent.focus(screen.getByRole("button"));
    unmount();
    expect(rm).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});

describe("QA-DS1b: Collapsible", () => {
  it("QA-DS1b: fermé par défaut, ouverture au clic, aria-expanded/controls/region cohérents", () => {
    render(<Collapsible title="Détails"><p>contenu</p></Collapsible>);
    const b = screen.getByRole("button", { name: "Détails" });
    expect(b.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(b.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    expect(panel.getAttribute("aria-labelledby")).toBe(b.id);
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
  });

  it("QA-DS1b: clavier : Entrée/Espace via bouton natif, titre de niveau demandé", () => {
    render(<Collapsible title="T" level={2}><p>c</p></Collapsible>);
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    expect(screen.getByRole("button").tagName).toBe("BUTTON");
  });

  it("QA-DS1b: mode contrôlé : l'état suit la prop, onOpenChange reçoit la valeur inverse", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Collapsible title="T" open={false} onOpenChange={onOpenChange}>c</Collapsible>);
    const b = screen.getByRole("button");
    fireEvent.click(b);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(b.getAttribute("aria-expanded")).toBe("false");
    rerender(<Collapsible title="T" open onOpenChange={onOpenChange}>c</Collapsible>);
    expect(b.getAttribute("aria-expanded")).toBe("true");
  });

  it("QA-DS1b: defaultOpen ouvre au rendu ; deux instances ont des ids distincts", () => {
    render(<><Collapsible title="A" defaultOpen>x</Collapsible><Collapsible title="B">y</Collapsible></>);
    const [a, b] = screen.getAllByRole("button");
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(a.getAttribute("aria-controls")).not.toBe(b.getAttribute("aria-controls"));
  });
});

