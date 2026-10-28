// F7-S3: French labels of the rights, extracted from the PO-validated catalogue (DECISION-072) — code → label only,
// so the bundle never carries the catalogue's other fields (holders, file paths). `--check` fails when out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const catalogue = fileURLToPath(new URL("../../docs/governance/droits-acces/catalogue.json", import.meta.url));
const target = fileURLToPath(new URL("../src/api/rightLabels.json", import.meta.url));

const { rights } = JSON.parse(readFileSync(catalogue, "utf8"));
const labels = Object.fromEntries(
  rights.filter((r) => r.kind === "permission").map((r) => [r.code, r.label]).sort(([a], [b]) => a.localeCompare(b)),
);
const content = `${JSON.stringify(labels, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch { /* missing = out of date */ }
  if (current !== content) {
    console.error("src/api/rightLabels.json is out of date: run `node scripts/extract-right-labels.mjs`.");
    process.exit(1);
  }
} else {
  writeFileSync(target, content);
}
