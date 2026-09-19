import { useCallback, useEffect, useRef, useState } from 'react';
import { WriteQueue } from './write-queue';
import type { Preferences, Snapshot, WorkspaceDraft, WorkspaceId } from '../shared/contracts';

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const current = useRef<Snapshot | null>(null);
  const queue = useRef<WriteQueue | null>(null);
  if (!queue.current)
    queue.current = new WriteQueue((state) => {
      setSaving(state.saving);
      setSaveError(state.failed);
    });

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      if (!window.career) throw new Error('Desktop bridge unavailable');
      const data = await window.career.load();
      current.current = data;
      setSnapshot(data);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const enqueue = useCallback((key: string, operation: () => Promise<unknown>) => {
    queue.current!.enqueue(key, operation);
  }, []);

  const updateDraft = useCallback(
    (id: WorkspaceId, patch: Partial<WorkspaceDraft>) => {
      if (!current.current || !window.career) return;
      const draft = { ...current.current.workspaces[id], ...patch };
      const next = {
        ...current.current,
        workspaces: { ...current.current.workspaces, [id]: draft },
      };
      current.current = next;
      setSnapshot(next);
      enqueue(id, async () => {
        const saved = await window.career!.saveWorkspace(id, draft);
        if (current.current?.workspaces[id] === draft) {
          const updated = {
            ...current.current,
            workspaces: { ...current.current.workspaces, [id]: saved },
          };
          current.current = updated;
          setSnapshot(updated);
        }
      });
    },
    [enqueue],
  );

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      if (!current.current || !window.career) return;
      const next = {
        ...current.current,
        preferences: { ...current.current.preferences, ...patch },
      };
      current.current = next;
      setSnapshot(next);
      enqueue('preferences', () => window.career!.savePreferences(next.preferences));
    },
    [enqueue],
  );

  const retrySave = useCallback(() => {
    if (!current.current || !window.career) return;
    for (const [id, draft] of Object.entries(current.current.workspaces)) {
      enqueue(id, () => window.career!.saveWorkspace(id as WorkspaceId, draft));
    }
    enqueue('preferences', () => window.career!.savePreferences(current.current!.preferences));
  }, [enqueue]);

  useEffect(
    () =>
      window.career?.onBeforeClose(async () => {
        const saved = await queue.current!.flush();
        return current.current !== null && saved;
      }),
    [],
  );

  const refreshResume = useCallback(async (page: WorkspaceId = 'resume') => {
    if (!window.career || !current.current) return;
    const saved = await window.career.load();
    const next = {
      ...current.current,
      workspaces: { ...current.current.workspaces, [page]: saved.workspaces[page] },
    };
    current.current = next;
    setSnapshot(next);
  }, []);

  return {
    refreshResume,
    snapshot,
    loadError,
    saving,
    saveError,
    load,
    updateDraft,
    updatePreferences,
    retrySave,
    flush: () => queue.current!.flush(),
  };
}
