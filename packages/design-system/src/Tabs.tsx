import "./Tabs.css";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (value: T) => void;
}

/**
 * Navigation between pages, not a tablist (`aria-current="page"`, no
 * `role="tab"`): real tabs only when a screen needs them.
 *
 * Fixes a real accessibility bug (DESIGN_NOTES.md section 1): the previous
 * pattern used `disabled={isActive}` to mark the current tab, which pulls
 * it out of the tab order and gets announced as "disabled" rather than
 * "current page" by screen readers. Uses `aria-current="page"` and a
 * visual class instead — the tab stays keyboard-activatable either way.
 */
export function Tabs<T extends string>({ items, active, onChange }: TabsProps<T>) {
  return (
    <nav className="gs-tabs">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={item.value === active ? "gs-tab gs-tab-active" : "gs-tab"}
          aria-current={item.value === active ? "page" : undefined}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
