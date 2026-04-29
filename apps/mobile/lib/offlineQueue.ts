/**
 * Offline Queue: Local SQLite buffer for bookmarks pending sync.
 *
 * When the user shares a link/text to Karakeep, the bookmark payload is
 * stored here immediately (no network required). A background task later
 * picks up pending items and pushes them to the server.
 */
import * as SQLite from "expo-sqlite";

// ── Types ────────────────────────────────────────────────────────────

export interface PendingBookmark {
  id: number;
  /** JSON-serialised bookmark creation payload */
  payload: string;
  capturedAt: string;
  status: "pending" | "synced" | "failed";
  retryCount: number;
}

// ── Database singleton ───────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("karakeep_offline.db");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_bookmarks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      payload     TEXT    NOT NULL,
      capturedAt  TEXT    NOT NULL DEFAULT (datetime('now')),
      status      TEXT    NOT NULL DEFAULT 'pending',
      retryCount  INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

// ── Queue operations ─────────────────────────────────────────────────

/**
 * Add a bookmark payload to the local queue.
 * @param payload – The raw object that would be sent to `bookmarks.createBookmark`.
 */
export async function enqueue(payload: Record<string, unknown>): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    "INSERT INTO pending_bookmarks (payload) VALUES (?)",
    JSON.stringify(payload),
  );
}

/**
 * Retrieve all items that still need to be synced.
 */
export async function getPending(): Promise<PendingBookmark[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<PendingBookmark>(
    "SELECT * FROM pending_bookmarks WHERE status = 'pending' ORDER BY id ASC",
  );
  return rows;
}

/**
 * Remove a successfully synced item from the queue.
 */
export async function markSynced(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync("DELETE FROM pending_bookmarks WHERE id = ?", id);
}

/**
 * Increment the retry counter after a failed sync attempt.
 */
export async function markFailed(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    "UPDATE pending_bookmarks SET retryCount = retryCount + 1 WHERE id = ?",
    id,
  );
}

/**
 * Return the number of items waiting to be synced.
 */
export async function pendingCount(): Promise<number> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM pending_bookmarks WHERE status = 'pending'",
  );
  return row?.count ?? 0;
}
