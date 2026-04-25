// SQLite database layer using the sqlite-wasm OPFS (Origin Private File System) VFS.
// All SQL is run in a dedicated Worker thread via the sqlite3Worker1 message bridge.
// The OPFS VFS stores campfixer.db persistently in the browser's private storage.

import sqlite3Worker1Promiser from '../vendor/sqlite/index.mjs';

let promiser = null; // sqlite3Worker1 message bridge, set once by initDB
let dbId = null;     // handle for the open database connection, set once by initDB

// Starts the SQLite worker, opens (or creates) campfixer.db via OPFS, ensures
// the three core tables exist, and requests persistent storage so the browser
// won't evict the database under storage pressure. Must be called before any
// other function in this module.
async function initDB() {
  promiser = await sqlite3Worker1Promiser({
    worker: () => new Worker(
      new URL('../vendor/sqlite/sqlite3-worker1.mjs', import.meta.url),
      { type: 'module' }
    ),
  });

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
    packed INTEGER DEFAULT 0
  )`);

  // Request durable storage — without this the browser may clear OPFS under quota pressure.
  await navigator.storage.persist();
}

// Runs a query that returns rows (SELECT). Returns an array of plain row objects.
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

// Runs a write statement (INSERT / UPDATE / DELETE / DDL) with no return value.
async function run(sql, bind = []) {
  await promiser('exec', { dbId, sql, bind });
}

// Wraps fn in an explicit BEGIN/COMMIT block. Rolls back and re-throws on error.
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

// Returns the raw database file bytes (Uint8Array) for backup download.
async function exportDB() {
  const result = await promiser('export', { dbId });
  return result.result.byteArray;
}

export { initDB, exec, run, transaction, exportDB };
