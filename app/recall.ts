"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecallStatus } from "../lib/models";

export type RecallStatuses = Record<string, RecallStatus>;
const learnerStorageKey = "kotoba-no-tabi:learner-id";
const legacyStorageKey = "kotoba-no-tabi:recall-statuses";
const syncStorageKey = "kotoba-no-tabi:progress-sync";

type ProgressData = {
  statuses: RecallStatuses;
  learnedCount: number;
  unsureCount: number;
  vocabularyCount: number;
};

async function loadProgress(userId: string): Promise<ProgressData> {
  const response = await fetch(`/api/progress?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("学習状態を読み込めませんでした。");
  return response.json() as Promise<ProgressData>;
}

async function saveStatuses(userId: string, statuses: RecallStatuses, legacyMigration = false) {
  const response = await fetch("/api/progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, statuses, legacyMigration }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? "学習状態を保存できませんでした。");
  }
}

export function useRecallStatuses() {
  const [statuses, setStatuses] = useState<RecallStatuses>({});
  const [progress, setProgress] = useState({ learnedCount: 0, unsureCount: 0, vocabularyCount: 0 });
  const [userId, setUserId] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await loadProgress(id);
      setStatuses(data.statuses);
      setProgress(data);
      setStorageMessage("");
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : "学習状態を読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    const storedId = window.localStorage.getItem(learnerStorageKey);
    const id = storedId ?? window.crypto.randomUUID();
    if (!storedId) window.localStorage.setItem(learnerStorageKey, id);
    setUserId(id);

    async function initializeProgress() {
      try {
        const legacyData = window.localStorage.getItem(legacyStorageKey);
        const existing = await loadProgress(id);
        if (legacyData) {
          const parsed: unknown = JSON.parse(legacyData);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const migrated: RecallStatuses = {};
            for (const [term, status] of Object.entries(parsed)) {
              if (status === "learned" || status === "unsure") {
                migrated[term] = status;
              }
            }
            if (Object.keys(migrated).length) await saveStatuses(id, { ...migrated, ...existing.statuses }, true);
            window.localStorage.removeItem(legacyStorageKey);
          }
        }
        const data = await loadProgress(id);
        setStatuses(data.statuses);
        setProgress(data);
        setStorageMessage("");
      } catch (error) {
        setStorageMessage(error instanceof Error ? error.message : "学習状態を読み込めませんでした。");
      } finally {
        setStorageReady(true);
      }
    }
    void initializeProgress();

    function syncFromAnotherTab(event: StorageEvent) {
      if (event.key === syncStorageKey) void refresh(id);
    }
    window.addEventListener("storage", syncFromAnotherTab);
    return () => window.removeEventListener("storage", syncFromAnotherTab);
  }, [refresh]);

  const setStatus = useCallback(async (term: string, status: RecallStatus) => {
    if (!userId) return;
    setStatuses((previous) => ({ ...previous, [term]: status }));
    try {
      await saveStatuses(userId, { [term]: status });
      const data = await loadProgress(userId);
      setStatuses(data.statuses);
      setProgress(data);
      setStorageMessage("");
      window.localStorage.setItem(syncStorageKey, String(Date.now()));
    } catch (error) {
      setStorageMessage(error instanceof Error ? error.message : "学習状態を保存できませんでした。");
    }
  }, [userId]);

  return { statuses, setStatus, storageMessage, storageReady, userId, progress };
}
