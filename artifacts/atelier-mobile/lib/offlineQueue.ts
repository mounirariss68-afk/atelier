import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";

import { apiJson, putFileToSignedUrl } from "@/lib/api";
import type { AtelierSelfExpenseCreate } from "@workspace/api-client-react";

const STORAGE_KEY = "atelier_expense_queue";

export interface QueuedExpense {
  id: string;
  localUri: string | null;
  mime: string;
  fields: AtelierSelfExpenseCreate;
  createdAt: string;
}

async function readQueue(): Promise<QueuedExpense[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedExpense[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/** Copy a captured receipt into app storage so it survives after the picker temp files vanish. */
async function persistLocalCopy(uri: string): Promise<string> {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const dir = FileSystem.documentDirectory;
    if (!dir) return uri;
    const dest = `${dir}queued_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

export async function enqueueExpense(input: {
  localUri: string | null;
  mime?: string;
  fields: AtelierSelfExpenseCreate;
}): Promise<void> {
  const localUri = input.localUri ? await persistLocalCopy(input.localUri) : null;
  const item: QueuedExpense = {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    localUri,
    mime: input.mime ?? "image/jpeg",
    fields: input.fields,
    createdAt: new Date().toISOString(),
  };
  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);
}

export async function getQueueCount(): Promise<number> {
  return (await readQueue()).length;
}

async function processItem(item: QueuedExpense): Promise<void> {
  let receiptPath: string | undefined;
  if (item.localUri) {
    const { uploadURL } = await apiJson<{ uploadURL: string }>(
      "/api/atelier/me/expenses/receipt-upload",
      { method: "POST" },
    );
    await putFileToSignedUrl(uploadURL, item.localUri, item.mime);
    receiptPath = uploadURL;
  }
  const created = await apiJson<{ expense: { id: string } }>(
    "/api/atelier/me/expenses",
    {
      method: "POST",
      body: { ...item.fields, receiptPath },
    },
  );
  if (receiptPath && created.expense?.id) {
    try {
      await apiJson(`/api/atelier/me/expenses/${created.expense.id}/parse-receipt`, {
        method: "POST",
      });
    } catch {
      // parsing is best-effort / non-fatal
    }
  }
}

/**
 * Flush queued expenses when back online. Returns number successfully synced.
 * Items that fail are kept for the next attempt.
 */
export async function flushQueue(): Promise<number> {
  if (!(await isOnline())) return 0;
  const queue = await readQueue();
  if (queue.length === 0) return 0;
  const remaining: QueuedExpense[] = [];
  let synced = 0;
  for (const item of queue) {
    try {
      await processItem(item);
      synced += 1;
    } catch {
      remaining.push(item);
    }
  }
  await writeQueue(remaining);
  return synced;
}
