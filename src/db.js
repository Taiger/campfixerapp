// SQLite database layer using the sqlite-wasm OPFS (Origin Private File System) VFS.
//
// Architecture overview
// ─────────────────────
// All SQL runs inside a dedicated Web Worker (sqlite3-worker1.mjs from the
// @sqlite.org/sqlite-wasm package, vendored under /vendor/sqlite/).  The worker
// owns the WASM instance and the OPFS file handle; the main thread communicates
// with it exclusively through the promiser message bridge.
//
// Why a worker?  The OPFS synchronous read/write API (used by the sqlite-wasm
// OPFS VFS) is only available inside workers — it is deliberately blocked on the
// main thread to prevent jank.
//
// Why OPFS?  OPFS (Origin Private File System) is a sandboxed, high-performance
// storage bucket that persists across sessions.  Unlike IndexedDB or localStorage
// it supports the file-like random-access I/O that SQLite requires, and data
// is never visible to other origins.
//
// SharedArrayBuffer requirement
// ─────────────────────────────
// The OPFS VFS uses SharedArrayBuffer for zero-copy data passing between the
// main thread and the worker.  SharedArrayBuffer is only available on pages
// served with COOP + COEP security headers.  On GitHub Pages (which can't set
// server headers) coi-serviceworker.js injects those headers via a service
// worker on every response — see coi-serviceworker.js for details.

// Named export — the default export of index.mjs is the full sqlite3 API object,
// not the promiser factory; importing the wrong thing gives a silent type error.
import { sqlite3Worker1Promiser } from '../vendor/sqlite/index.mjs';

// sqlite3Worker1Promiser v2 message bridge — set once by initDB, then reused by
// every exec/run call for the lifetime of the page.
let promiser = null;
// Handle returned by the sqlite3 worker when the database file is opened.
// Required on every subsequent promiser call that targets a specific database.
let dbId = null;

// Starts the SQLite worker, opens (or creates) campfixer.db in OPFS, creates
// the three core tables if they don't exist, then requests durable storage so
// the browser won't silently evict the database file under quota pressure.
//
// sqlite3Worker1Promiser is the v2 variant: it accepts a config object and
// returns a Promise that resolves to the promiser function once the worker has
// posted its "worker1-ready" message.  All subsequent calls use that function.
//
// Must be awaited before any other function in this module.
async function initDB() {
  promiser = await sqlite3Worker1Promiser({
    // Explicit worker factory so the path resolves correctly whether the app is
    // served from the root or from a sub-path (e.g. a GitHub Pages repo name).
    worker: () => new Worker(
      new URL('../vendor/sqlite/sqlite3-worker1.mjs', import.meta.url),
      { type: 'module' }
    ),
  });

  // The "file:" URI with "?vfs=opfs" tells sqlite-wasm to use the OPFS VFS.
  // The filename becomes the OPFS entry name; changing it creates a new database.
  const openResult = await promiser('open', {
    filename: 'file:campfixer.db?vfs=opfs',
  });
  dbId = openResult.dbId;

  await run(`CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    updatedAt TEXT,
    data TEXT DEFAULT '[]'
  )`);

  await run(`CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    templateId TEXT,
    name TEXT NOT NULL,
    lastSyncedVersion INTEGER DEFAULT 1,
    createdAt TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS plan_items (
    planItemId TEXT PRIMARY KEY,
    planId TEXT NOT NULL,
    sourceTemplateId TEXT,
    sourceItemId TEXT,
    name TEXT DEFAULT '',
    importance TEXT DEFAULT 'Medium',
    description TEXT DEFAULT '',
    size TEXT DEFAULT '',
    weight TEXT DEFAULT '',
    packed INTEGER DEFAULT 0,
    extraFields TEXT DEFAULT '{}'
  )`);

  // Migrate existing databases that predate the extraFields column.
  try { await run(`ALTER TABLE plan_items ADD COLUMN extraFields TEXT DEFAULT '{}'`); } catch (_) {}

  // Ask the browser to treat this origin's storage as durable.  Without this,
  // Chrome/Edge may silently delete OPFS data when the device runs low on space.
  // The call is best-effort — the browser may decline without any error.
  await navigator.storage.persist();
}

// Runs a SELECT and returns all rows as an array of plain objects.
// returnValue:'resultRows' + rowMode:'object' tells the worker to gather every
// row into an array of {columnName: value} objects rather than streaming them
// individually via callbacks.
async function exec(sql, bind = []) {
  const result = await promiser('exec', {
    dbId,
    sql,
    bind,
    returnValue: 'resultRows',
    rowMode: 'object',
  });
  return result.result.resultRows || [];
}

// Runs an INSERT / UPDATE / DELETE / DDL statement.
// Uses the same 'exec' message type as exec() but omits returnValue so the
// worker doesn't accumulate rows — important for large writes.
async function run(sql, bind = []) {
  await promiser('exec', { dbId, sql, bind });
}

// Wraps an async callback in a BEGIN / COMMIT block.
// Any throw inside fn causes an immediate ROLLBACK so the database is never
// left in a partially-written state.
async function transaction(fn) {
  await run('BEGIN');
  try {
    await fn();
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

// Returns the raw bytes of the live database file as a Uint8Array.
// Used by the "Download database" backup button; the caller wraps the bytes in
// a Blob and triggers a browser file download.
async function exportDB() {
  const result = await promiser('export', { dbId });
  return result.result.byteArray;
}

export { initDB, exec, run, transaction, exportDB };
