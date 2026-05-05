import { useCallback, useEffect, useMemo, useState } from "react";
import { usePriceHistory } from "./usePriceHistory";
import { useArcelikData } from "./useArcelikData";
import {
  buildPriceNotifications,
  CRITICAL_THRESHOLD_PERCENT,
  type PriceNotification,
} from "@/data/arcelik-notifications";

const READ_STORAGE_KEY = "arcelik:notifications:read";
const TOAST_STORAGE_KEY = "arcelik:notifications:toasted";
const MAX_TRACKED_IDS = 200;

function loadIds(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed);
  } catch {
    // ignore
  }
  return new Set();
}

function persistIds(key: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(ids).slice(-MAX_TRACKED_IDS);
    window.localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

export interface NotificationsState {
  notifications: PriceNotification[];
  unreadCount: number;
  unreadCriticalCount: number;
  isLoading: boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  acknowledgeToasts: (ids: string[]) => void;
  pendingToasts: PriceNotification[];
  isRead: (id: string) => boolean;
}

export function useNotifications(): NotificationsState {
  const { products, competitorPrices } = useArcelikData();
  const { data: history, isLoading } = usePriceHistory({ limit: 200 });

  const [readIds, setReadIds] = useState<Set<string>>(() => loadIds(READ_STORAGE_KEY));
  const [toastedIds, setToastedIds] = useState<Set<string>>(() => loadIds(TOAST_STORAGE_KEY));

  const notifications = useMemo(
    () => buildPriceNotifications(history, products, competitorPrices, { maxItems: 30 }),
    [history, products, competitorPrices],
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !readIds.has(n.id)).length,
    [notifications, readIds],
  );

  const unreadCriticalCount = useMemo(
    () =>
      notifications.filter(
        (n) => !readIds.has(n.id) && Math.abs(n.changePercent) >= CRITICAL_THRESHOLD_PERCENT,
      ).length,
    [notifications, readIds],
  );

  const pendingToasts = useMemo(
    () =>
      notifications.filter(
        (n) =>
          Math.abs(n.changePercent) >= CRITICAL_THRESHOLD_PERCENT && !toastedIds.has(n.id),
      ),
    [notifications, toastedIds],
  );

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      persistIds(READ_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      persistIds(READ_STORAGE_KEY, next);
      return next;
    });
  }, [notifications]);

  const acknowledgeToasts = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setToastedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      persistIds(TOAST_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);

  // Garbage-collect stale ids that no longer appear in notifications, to keep storage bounded
  useEffect(() => {
    if (notifications.length === 0) return;
    const valid = new Set(notifications.map((n) => n.id));
    setReadIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => { if (valid.has(id)) next.add(id); });
      if (next.size === prev.size) return prev;
      persistIds(READ_STORAGE_KEY, next);
      return next;
    });
    setToastedIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => { if (valid.has(id)) next.add(id); });
      if (next.size === prev.size) return prev;
      persistIds(TOAST_STORAGE_KEY, next);
      return next;
    });
  }, [notifications]);

  return {
    notifications,
    unreadCount,
    unreadCriticalCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    acknowledgeToasts,
    pendingToasts,
    isRead,
  };
}
