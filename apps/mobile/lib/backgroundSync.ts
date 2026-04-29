/**
 * Background Sync: Periodically pushes locally queued bookmarks to the server.
 *
 * Uses expo-task-manager + expo-background-fetch to run approximately every
 * 15 minutes (OS-dependent). Each run reads the SQLite queue and attempts
 * an HTTP POST for every pending item.
 */
import * as BackgroundFetch from "expo-background-fetch";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import superjson from "superjson";

import { getPending, markFailed, markSynced } from "./offlineQueue";

export const SYNC_TASK_NAME = "KARAKEEP_SYNC_TASK";

const SETTINGS_KEY = "settings";

/** Timeout per request (ms). Keep short so the task doesn't get killed. */
const REQUEST_TIMEOUT_MS = 10_000;

// ── Helpers ──────────────────────────────────────────────────────────

interface StoredSettings {
  apiKey?: string;
  address?: string;
  customHeaders?: Record<string, string>;
}

async function loadSettings(): Promise<StoredSettings | null> {
  const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSettings;
  } catch {
    return null;
  }
}

/**
 * Call the tRPC `bookmarks.createBookmark` mutation via raw HTTP.
 * We bypass the tRPC client because this runs outside React context.
 */
async function syncOneBookmark(
  settings: StoredSettings,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { tags, ...createPayload } = payload;
  const baseUrl = `${settings.address}/api/trpc`;
  const headers = {
    "Content-Type": "application/json",
    ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    ...(settings.customHeaders ?? {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // 1. Create the bookmark
    const createResponse = await fetch(`${baseUrl}/bookmarks.createBookmark`, {
      method: "POST",
      headers,
      body: JSON.stringify(superjson.serialize(createPayload)),
      signal: controller.signal,
    });

    if (!createResponse.ok) return false;

    // If there are no tags to sync, we're done
    const tagsArray = tags as string[] | undefined;
    if (!tagsArray || tagsArray.length === 0) return true;

    // Get the bookmark ID from the response
    const createResult = (await createResponse.json()) as any;
    // tRPC response format: { result: { data: { json: { id: "..." } } } }
    const bookmarkId = createResult.result.data.json.id;

    if (!bookmarkId) return true; // Created but couldn't get ID for tags

    // 2. Attach tags
    const tagPayload = {
      bookmarkId,
      attach: tagsArray.map((tagName) => ({ tagName, attachedBy: "human" })),
      detach: [],
    };

    const tagResponse = await fetch(`${baseUrl}/bookmarks.updateTags`, {
      method: "POST",
      headers,
      body: JSON.stringify(superjson.serialize(tagPayload)),
      signal: controller.signal,
    });

    return tagResponse.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Task definition ──────────────────────────────────────────────────

TaskManager.defineTask(SYNC_TASK_NAME, async () => {
  try {
    const settings = await loadSettings();
    if (!settings?.address || !settings?.apiKey) {
      // Can't sync without server config.
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const pending = await getPending();
    if (pending.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    let synced = 0;
    for (const item of pending) {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;
      const ok = await syncOneBookmark(settings, payload);
      if (ok) {
        await markSynced(item.id);
        synced++;
      } else {
        await markFailed(item.id);
      }
    }

    return synced > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.Failed;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ── Registration ─────────────────────────────────────────────────────

export async function registerBackgroundSync(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK_NAME);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(SYNC_TASK_NAME, {
    minimumInterval: 15 * 60, // 15 minutes (OS may adjust)
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

/**
 * Manually trigger a sync attempt (e.g. when the app comes to foreground).
 * Reuses the same logic as the background task but runs immediately.
 */
export async function triggerSync(): Promise<void> {
  const settings = await loadSettings();
  if (!settings?.address || !settings?.apiKey) return;

  const pending = await getPending();
  for (const item of pending) {
    const payload = JSON.parse(item.payload) as Record<string, unknown>;
    const ok = await syncOneBookmark(settings, payload);
    if (ok) {
      await markSynced(item.id);
    } else {
      await markFailed(item.id);
    }
  }
}
