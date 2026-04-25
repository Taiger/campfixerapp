import sqlite3Worker1Promiser from '../vendor/sqlite/index.mjs';

let promiser = null;
let dbId = null;

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

  await navigator.storage.persist();
}

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

async function run(sql, bind = []) {
  await promiser('exec', { dbId, sql, bind });
}

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

async function exportDB() {
  const result = await promiser('export', { dbId });
  return result.result.byteArray;
}

export { initDB, exec, run, transaction, exportDB };
