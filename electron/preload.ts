import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/contracts.js';
const bridge: DesktopBridge = {
  workbench: {
    inspect: (page) => ipcRenderer.invoke('workbench:inspect', page),
    clear: (expected) => ipcRenderer.invoke('workbench:clear', expected),
    undo: (expected) => ipcRenderer.invoke('workbench:undo', expected),
    select: (page, id, revision) => ipcRenderer.invoke('workbench:select', page, id, revision),
  },
  prompts: {
    list: (page) => ipcRenderer.invoke('prompts:list', page),
    save: (page, name, text) => ipcRenderer.invoke('prompts:save', page, name, text),
  },
  materials: {
    stageFiles: (page, files) => ipcRenderer.invoke('materials:stage', page, files),
    pasteImage: (page) => ipcRenderer.invoke('materials:paste-image', page),
    pickFiles: (page) => ipcRenderer.invoke('materials:pick', page),
    importPickedFiles: (page, draftId, assignments) =>
      ipcRenderer.invoke('materials:import-picked', page, draftId, assignments),
    discardPickedFiles: (page, draftId) =>
      ipcRenderer.invoke('materials:discard-picked', page, draftId),
    setPurpose: (page, id, revision, purpose) =>
      ipcRenderer.invoke('materials:purpose', page, id, revision, purpose),
    removeMany: (page, selections) => ipcRenderer.invoke('materials:remove-many', page, selections),
    importText: (page, purpose, input) =>
      ipcRenderer.invoke('materials:text', page, purpose, input),
    list: (page) => ipcRenderer.invoke('materials:list', page),
    manifest: (page, sendImages) => ipcRenderer.invoke('materials:manifest', page, sendImages),
    importFiles: (page, purpose) => ipcRenderer.invoke('materials:import', page, purpose),
    importUrl: (page, purpose, url, allowPublicDns) =>
      ipcRenderer.invoke('materials:url', page, purpose, url, allowPublicDns),
    cancelImport: () => ipcRenderer.invoke('materials:cancel'),
    select: (page, id, revision, selected) =>
      ipcRenderer.invoke('materials:select', page, id, revision, selected),
    remove: (page, id, revision) => ipcRenderer.invoke('materials:remove', page, id, revision),
  },
  match: {
    prepare: (sendImages) => ipcRenderer.invoke('match:prepare', sendImages),
    run: (c) => ipcRenderer.invoke('match:run', c),
    cancel: (id) => ipcRenderer.invoke('ai:cancel', id),
    history: () => ipcRenderer.invoke('match:history'),
    deleteMany: (ids, revision) => ipcRenderer.invoke('match:delete-many', ids, revision),
    takeFailedPreview: (runId) => ipcRenderer.invoke('match:preview:take', runId),
    discardFailedPreview: (runId) => ipcRenderer.invoke('match:preview:discard', runId),
  },
  interview: {
    prepare: (sendImages) => ipcRenderer.invoke('interview:prepare', sendImages),
    run: (request) => ipcRenderer.invoke('interview:run', request),
    cancel: (id) => ipcRenderer.invoke('ai:cancel', id),
    history: () => ipcRenderer.invoke('interview:history'),
    deleteMany: (ids, revision) => ipcRenderer.invoke('interview:delete-many', ids, revision),
  },
  score: {
    takeFailedPreview: (runId) => ipcRenderer.invoke('score:preview:take', runId),
    discardFailedPreview: (runId) => ipcRenderer.invoke('score:preview:discard', runId),
    prepare: (sendImages) => ipcRenderer.invoke('score:prepare', sendImages),
    run: (request) => ipcRenderer.invoke('score:run', request),
    cancel: (id) => ipcRenderer.invoke('ai:cancel', id),
    history: () => ipcRenderer.invoke('score:history'),
    deleteMany: (ids, revision) => ipcRenderer.invoke('score:delete-many', ids, revision),
  },
  ai: {
    getHistory: (page) => ipcRenderer.invoke('ai:history', page),
    restoreDocumentVersion: (page, number, expected) =>
      ipcRenderer.invoke('ai:rollback', page, number, expected),
    deleteVersions: (page, items, expected) =>
      ipcRenderer.invoke('ai:delete-versions', page, items, expected),
    recoverVersions: (page, items) => ipcRenderer.invoke('ai:recover-versions', page, items),
    purgeVersions: (page, items) => ipcRenderer.invoke('ai:purge-versions', page, items),
    recoverDraft: (page, id, expected) =>
      ipcRenderer.invoke('ai:recover-draft', page, id, expected),
    deleteDrafts: (page, ids) => ipcRenderer.invoke('ai:delete-drafts', page, ids),
    generateDocument: (request) => ipcRenderer.invoke('ai:generate', request),
    registry: {
      catalog: () => ipcRenderer.invoke('registry:catalog'),
      saveProvider: (input) => ipcRenderer.invoke('registry:provider', input),
      saveModel: (input) => ipcRenderer.invoke('registry:model', input),
      deleteItems: (request) => ipcRenderer.invoke('registry:delete', request),
      selectModel: (page, modelId, overrides, revision) =>
        ipcRenderer.invoke('registry:select', page, modelId, overrides, revision),
      testModel: (modelId, revision, kind) =>
        ipcRenderer.invoke('registry:test', modelId, revision, kind),
      testProvider: (id, revision) => ipcRenderer.invoke('registry:test-provider', id, revision),
      discoverModels: (id, revision, session) =>
        ipcRenderer.invoke('registry:discover', id, revision, session),
      importModels: (session, ids) => ipcRenderer.invoke('registry:import-models', session, ids),
      cancelTest: () => ipcRenderer.invoke('registry:cancel-test'),
    },
    getConnection: () => ipcRenderer.invoke('ai:connection'),
    saveConnection: (input) => ipcRenderer.invoke('ai:save-connection', input),
    removeConnection: () => ipcRenderer.invoke('ai:remove-connection'),
    testConnection: (revision) => ipcRenderer.invoke('ai:test', revision),
    generateResume: (request) => ipcRenderer.invoke('ai:generate', request),
    cancelGeneration: (runId) => ipcRenderer.invoke('ai:cancel', runId),
    listResumeVersions: () => ipcRenderer.invoke('ai:versions'),
    restoreResumeVersion: (number, expectedDraft) =>
      ipcRenderer.invoke('ai:restore-version', number, expectedDraft),
    onGeneration: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: import('../shared/ai').AiEvent) =>
        listener(value);
      ipcRenderer.on('ai:delta', handler);
      return () => ipcRenderer.removeListener('ai:delta', handler);
    },
  },
  load: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (id, draft) => ipcRenderer.invoke('workspace:save', id, draft),
  savePreferences: (preferences) => ipcRenderer.invoke('preferences:save', preferences),
  exportDocument: (id, format, text) => ipcRenderer.invoke('document:export', id, format, text),
  onBeforeClose: (handler) => {
    const listener = () => {
      void handler()
        .then((saved) => ipcRenderer.invoke('app:close-ready', saved))
        .catch(() => ipcRenderer.invoke('app:close-ready', false));
    };
    ipcRenderer.on('app:prepare-close', listener);
    return () => ipcRenderer.removeListener('app:prepare-close', listener);
  },
};
contextBridge.exposeInMainWorld('career', bridge);
