// OUTILLAGE DE TEST UNIQUEMENT (QA F7-S1). Jamais charge en production, aucun code applicatif modifie.
// Usage : node_modules/.bin/tsx --import /abs/path/qa-f7s1-test-preload.mjs src/server.ts   (cwd = backend/)
//  1. pg : retire le TLS impose par pool.ts (PostgreSQL LOCAL sans SSL).
//  2. GoogleDriveStorage.prototype : upload / getUrl / getContent / delete / checkFolders / drive() remplaces en memoire.
//     Stockage = Map(id -> Buffer) ; URL factice http://127.0.0.1/qa-evidence/<id> ; getContent rend les octets a l'identique
//     (la verification SHA-256 de l'analyse passe). drive() leve : aucune requete vers Google n'est possible.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

// Paths resolved from this file (tests/integration/), so the reproduction runs from any checkout.
const BACKEND = fileURLToPath(new URL("../../backend/", import.meta.url));

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  throw new Error("qa-f7s1-test-preload refuse de se charger en production");
}

const require = createRequire(BACKEND);
const pg = require("pg");
const BasePool = pg.Pool;
pg.Pool = class NoTlsPool extends BasePool {
  constructor(options = {}) { super({ ...options, ssl: false }); }
};

const { GoogleDriveStorage } = await import(pathToFileURL(`${BACKEND}src/infrastructure/storage/GoogleDriveStorage.ts`).href);
const files = new Map();
const deleted = new Set();
const P = GoogleDriveStorage.prototype;
P.drive = async () => { throw new Error("QA preload : acces Google Drive interdit"); };
P.upload = async function ({ fileName, content }) {
  const id = `qa-${randomUUID()}`;
  files.set(id, Buffer.from(content));
  return { storageFileId: id, url: `http://127.0.0.1/qa-evidence/${id}`, fileName };
};
P.getUrl = async (id) => {
  if (!files.has(id)) throw new Error(`QA preload : fichier inconnu ${id}`);
  return `http://127.0.0.1/qa-evidence/${id}`;
};
P.getContent = async (id) => {
  const buf = files.get(id);
  if (!buf) throw new Error(`QA preload : fichier inconnu ${id}`);
  return Buffer.from(buf);
};
P.delete = async (id) => { deleted.add(id); };
P.checkFolders = async () => ["active folder: QA in-memory", "deleted folder: QA in-memory"];
console.log("[qa-f7s1-preload] pg sans TLS + GoogleDriveStorage en memoire actifs");
