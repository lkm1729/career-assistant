import { InterviewStore } from './interview-store.js';
import { AiError } from '../shared/ai';
import { FileImportDrafts } from './material-file-drafts';
import { readWeb, webReadDiagnostic } from './web-material';
import { MaterialStore, assertMaterialPage, assertPurpose } from './material-store';
import { parseMaterial } from './material-parser';
import { ScoreStore } from './scoring';
import { MatchStore } from './matching';
import { rendererLocation, releaseDebugSwitches } from './runtime-policy.js';
import { AiStore } from './ai-store.js';
import { AiService, publicAiError, publicAiDiagnostic } from './ai-service.js';
import {
  app,
  clipboard,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  safeStorage,
  type IpcMainInvokeEvent,
} from 'electron';
import { mkdirSync } from 'node:fs';
import { atomicExport } from './atomic-export.js';
import { isTrustedDocument } from './trusted-document.js';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { WorkspaceStore } from './workspace-store.js';
import { assertWorkspaceId } from '../shared/validation.js';

app.setName('Career Assistant');
// Release binaries are app-only: no renderer debugging endpoints or dev server override.
if (app.isPackaged) {
  for (const name of releaseDebugSwitches) {
    app.commandLine.removeSwitch(name);
  }
}
// Prevent Windows Chromium GPU initialization crashes before any BrowserWindow is created.
app.disableHardwareAcceleration();
const testMode = process.env.CAREER_TEST_MODE === '1';
if (testMode) app.commandLine.appendSwitch('disable-gpu');
if (testMode && process.env.CAREER_TEST_DATA) app.setPath('userData', process.env.CAREER_TEST_DATA);
const locked = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let store: WorkspaceStore | null = null;
let aiStore: AiStore | null = null;
let aiService: AiService | null = null;
let materials: MaterialStore | null = null;
let scores: ScoreStore | null = null;
let matches: MatchStore | null = null;
let interviews: InterviewStore | null = null;
let importing: AbortController | null = null;
let closeAllowed = false;
let closing = false;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
const rendererURL = rendererLocation(
  app.isPackaged,
  process.env.CAREER_DEV_URL,
  pathToFileURL(join(__dirname, '../dist/index.html')).href,
);

function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isTrustedDocument(event.senderFrame?.url ?? '', rendererURL)
  ) {
    throw new Error('Untrusted sender');
  }
}
function database() {
  if (!store) throw new Error('本地存储不可用；未覆盖任何资料。');
  return store;
}
async function finishClose(saved: boolean) {
  clearTimeout(closeTimer);
  if (!window || window.isDestroyed() || !closing) return;
  if (!saved) {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: '草稿尚未保存',
      message: '有修改尚未保存到本机。',
      detail:
        '可能有未保存的修改或正在生成的内容。留在应用中等待/重试，或放弃本次未保存内容后退出。已有草稿和版本不会被删除。',
      buttons: ['留在应用', '放弃未保存修改并退出'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) {
      closing = false;
      return;
    }
  }
  importing?.abort();
  aiService?.cancelAll();
  closeAllowed = true;
  window.close();
}
if (!locked) app.quit();
else {
  app.on('second-instance', () => {
    window?.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(() => {
      mkdirSync(app.getPath('userData'), { recursive: true });
      try {
        store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.sqlite'));
        aiStore = new AiStore(join(app.getPath('userData'), 'workspace.sqlite'), {
          encrypt(text) {
            if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable');
            return safeStorage.encryptString(text);
          },
          decrypt(data) {
            return safeStorage.decryptString(data);
          },
        });
        materials = new MaterialStore(join(app.getPath('userData'), 'workspace.sqlite'));
        scores = new ScoreStore(join(app.getPath('userData'), 'workspace.sqlite'));
        matches = new MatchStore(
          new DatabaseSync(join(app.getPath('userData'), 'workspace.sqlite')),
        );
        interviews = new InterviewStore(join(app.getPath('userData'), 'workspace.sqlite'));
        aiService = new AiService(aiStore, store, materials, scores, matches, interviews);
      } catch {
        /* Keep the window usable for a non-destructive storage error. */
      }
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const ready = () => {
        if (!aiStore || !aiService) throw new Error('AI store unavailable');
        return { storage: aiStore, service: aiService };
      };
      const ensureMaterials = () => {
        if (!materials) throw new Error('Material store unavailable');
        return materials;
      };
      const canChangeMaterials = () => {
        ready().service.assertIdle();
        if (importing) throw new Error('Import in progress');
      };
      ipcMain.handle('prompts:list', (event, page) => {
        trusted(event);
        assertWorkspaceId(page);
        return store!.listPrompts(page);
      });
      ipcMain.handle('prompts:save', (event, page, name, text) => {
        trusted(event);
        try {
          return { ok: true, items: store!.savePrompt(page, name, text) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:list', (event, page) => {
        trusted(event);
        return ensureMaterials().list(page);
      });
      ipcMain.handle('materials:manifest', (event, page, sendImages) => {
        trusted(event);
        if (importing) throw new Error('请等待本地解析完成');
        return ensureMaterials().manifest(page, sendImages);
      });
      const fileDrafts = new FileImportDrafts();
      ipcMain.handle('materials:stage', (event, page, files) => {
        trusted(event);
        try {
          canChangeMaterials();
          return { ok: true, draft: fileDrafts.createTransferred(page, files) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:paste-image', async (event, page) => {
        trusted(event);
        try {
          canChangeMaterials();
          assertMaterialPage(page);
          const controller = new AbortController();
          importing = controller;
          try {
            const items = await clipboard.read();
            const item = items.find((entry) => entry.types.includes('image/png'));
            if (!item)
              throw new AiError('剪贴板中没有图片；文件可拖入下方区域，文本请粘贴到文字输入框。');
            const blob = await item.getType('image/png');
            if (!(blob instanceof Blob) || !blob.size || blob.size > 12 * 1024 * 1024)
              throw new AiError('剪贴板图片为空或超过12 MiB，请缩小后重试。');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            return {
              ok: true,
              draft: controller.signal.aborted
                ? null
                : fileDrafts.createTransferred(page, [
                    { name: `粘贴图片-${Date.now()}.png`, bytes },
                  ]),
            };
          } finally {
            importing = null;
          }
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:pick', async (event, page) => {
        trusted(event);
        try {
          canChangeMaterials();
          assertMaterialPage(page);
          const controller = new AbortController();
          importing = controller;
          try {
            const picked = await dialog.showOpenDialog(window!, {
              title: '选择本页资料（下一步逐项设置用途）',
              properties: ['openFile', 'multiSelections'],
              filters: [
                {
                  name: '参考资料',
                  extensions: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'],
                },
              ],
            });
            return {
              ok: true,
              draft:
                picked.canceled || controller.signal.aborted
                  ? null
                  : fileDrafts.create(page, picked.filePaths),
            };
          } finally {
            importing = null;
          }
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:discard-picked', (event, page, id) => {
        trusted(event);
        fileDrafts.discard(page, id);
      });
      ipcMain.handle('materials:import-picked', async (event, page, id, assignments) => {
        trusted(event);
        try {
          canChangeMaterials();
          const entries = fileDrafts.take(page, id, assignments);
          const controller = new AbortController();
          importing = controller;
          try {
            return {
              ok: true,
              items: await ensureMaterials().importAssignedPaths(
                page,
                entries,
                parseMaterial,
                controller.signal,
              ),
            };
          } finally {
            importing = null;
          }
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:purpose', (event, page, id, revision, purpose) => {
        trusted(event);
        try {
          canChangeMaterials();
          return { ok: true, items: ensureMaterials().setPurpose(page, id, revision, purpose) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:remove-many', (event, page, selections) => {
        trusted(event);
        try {
          canChangeMaterials();
          return { ok: true, items: ensureMaterials().removeMany(page, selections) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:import', async (event, page, purpose) => {
        trusted(event);
        try {
          canChangeMaterials();
          assertMaterialPage(page);
          assertPurpose(purpose);
          const controller = new AbortController();
          importing = controller;
          try {
            const picked = await dialog.showOpenDialog(window!, {
              title: '导入本页资料（仅本机解析）',
              properties: ['openFile', 'multiSelections'],
              filters: [
                {
                  name: '简历资料',
                  extensions: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'],
                },
              ],
            });
            if (picked.canceled || controller.signal.aborted)
              return { ok: true, items: ensureMaterials().list(page) };
            const items = await ensureMaterials().importPaths(
              page,
              purpose,
              picked.filePaths,
              parseMaterial,
              controller.signal,
            );
            return { ok: true, items };
          } finally {
            importing = null;
          }
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:url', async (event, page, purpose, url, allowPublicDns) => {
        trusted(event);
        try {
          canChangeMaterials();
          assertMaterialPage(page);
          assertPurpose(purpose);
          const controller = new AbortController();
          importing = controller;
          try {
            const source = await readWeb(url, controller.signal, {}, allowPublicDns);
            controller.signal.throwIfAborted();
            return { ok: true, items: ensureMaterials().importWeb(page, purpose, source) };
          } finally {
            importing = null;
          }
        } catch (error) {
          return { ok: false, diagnostic: webReadDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:text', (event, page, purpose, input) => {
        trusted(event);
        try {
          canChangeMaterials();
          return { ok: true, items: ensureMaterials().importText(page, purpose, input) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('materials:cancel', (event) => {
        trusted(event);
        importing?.abort();
      });
      for (const remove of [false, true])
        ipcMain.handle(
          remove ? 'materials:remove' : 'materials:select',
          (event, page, id, revision, selected) => {
            trusted(event);
            try {
              canChangeMaterials();
              return {
                ok: true,
                items: ensureMaterials().update(
                  page,
                  id,
                  revision,
                  remove ? false : selected,
                  remove,
                ),
              };
            } catch (error) {
              return { ok: false, diagnostic: publicAiDiagnostic(error) };
            }
          },
        );
      ipcMain.handle('match:prepare', (event, sendImages) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          return { ok: true, value: ready().service.prepareMatch(sendImages) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('match:run', async (event, request) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          return { ok: true, value: await ready().service.match(request) };
        } catch (error) {
          return {
            ok: false,
            diagnostic: publicAiDiagnostic(error),
            previewAvailable: ready().service.hasMatchPreview(request?.runId),
          };
        }
      });
      ipcMain.handle('match:preview:take', (event, runId) => {
        trusted(event);
        return ready().service.takeMatchPreview(runId);
      });
      ipcMain.handle('match:preview:discard', (event, runId) => {
        trusted(event);
        if (typeof runId === 'string') ready().service.discardMatchPreview(runId);
      });
      ipcMain.handle('match:history', (event) => {
        trusted(event);
        if (!matches) throw new Error('Match store unavailable');
        return matches.list();
      });
      ipcMain.handle('match:delete-many', (event, ids, revision) => {
        trusted(event);
        try {
          if (!matches) throw new Error('Match store unavailable');
          ready().service.assertIdle();
          return { ok: true, deleted: matches.deleteMany(ids, revision).deleted };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('interview:prepare', (event, sendImages) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          return { ok: true, value: ready().service.prepareInterview(sendImages) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('interview:run', async (event, request) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          return { ok: true, value: await ready().service.interview(request) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('interview:history', (event) => {
        trusted(event);
        if (!interviews) throw new Error('Interview store unavailable');
        return interviews.list();
      });
      ipcMain.handle('interview:delete-many', (event, ids, revision) => {
        trusted(event);
        try {
          ready().service.assertIdle();
          return { ok: true, deleted: interviews!.deleteMany(ids, revision).deleted };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('score:prepare', (event, sendImages) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          return { ok: true, value: ready().service.prepareScore(sendImages) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('score:run', async (event, request) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          return { ok: true, value: await ready().service.score(request) };
        } catch (error) {
          return {
            ok: false,
            diagnostic: publicAiDiagnostic(error),
            previewAvailable: ready().service.hasScorePreview(request?.runId),
          };
        }
      });
      ipcMain.handle('score:preview:take', (event, runId) => {
        trusted(event);
        return ready().service.takeScorePreview(runId);
      });
      ipcMain.handle('score:preview:discard', (event, runId) => {
        trusted(event);
        ready().service.discardScorePreview(runId);
      });
      ipcMain.handle('score:history', (event) => {
        trusted(event);
        if (!scores) throw new Error('Score store unavailable');
        return scores.list();
      });
      ipcMain.handle('score:delete-many', (event, ids, revision) => {
        trusted(event);
        try {
          if (!scores) throw new Error('Score store unavailable');
          ready().service.assertIdle();
          return { ok: true, deleted: scores.deleteMany(ids, revision).deleted };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('registry:catalog', (event) => {
        trusted(event);
        return ready().storage.registry.catalog();
      });
      const registryMutation = (event: IpcMainInvokeEvent, operation: () => void) => {
        trusted(event);
        try {
          operation();
          return { ok: true, catalog: ready().storage.registry.catalog() };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      };
      ipcMain.handle('registry:provider', (event, input) =>
        registryMutation(event, () => {
          ready().service.assertIdle();
          ready().storage.registry.saveProvider(input);
        }),
      );
      ipcMain.handle('registry:model', (event, input) =>
        registryMutation(event, () => {
          ready().service.assertIdle();
          ready().storage.registry.saveModel(input);
        }),
      );
      ipcMain.handle('registry:delete', (event, request) =>
        registryMutation(event, () => {
          ready().service.assertIdle();
          ready().storage.registry.deleteItems(request);
        }),
      );
      ipcMain.handle('registry:select', (event, page, modelId, overrides, revision) =>
        registryMutation(event, () => {
          ready().service.assertIdle();
          ready().storage.registry.select(page, modelId, overrides, revision);
        }),
      );
      ipcMain.handle('registry:discover', async (event, id, revision, session) => {
        trusted(event);
        try {
          return { ok: true, result: await ready().service.discoverModels(id, revision, session) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('registry:import-models', (event, session, ids) =>
        registryMutation(event, () => ready().service.importModels(session, ids)),
      );
      ipcMain.handle('registry:cancel-test', (event) => {
        trusted(event);
        ready().service.cancelTest();
      });
      ipcMain.handle('registry:test', async (event, modelId, revision, kind) => {
        trusted(event);
        try {
          return { ok: true, message: await ready().service.testModel(modelId, revision, kind) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('registry:test-provider', async (event, id, revision) => {
        trusted(event);
        try {
          return { ok: true, message: await ready().service.testProvider(id, revision) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('ai:history', (event, page) => {
        trusted(event);
        return ready().storage.historyState(page);
      });
      ipcMain.handle('ai:rollback', (event, page, number, expected) => {
        trusted(event);
        try {
          ready().service.assertIdle();
          return { ok: true, version: ready().storage.restoreVersion(number, expected, page) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      const historyMutation = (
        event: IpcMainInvokeEvent,
        page: import('../shared/ai').WritingPage,
        action: () => void,
      ) => {
        trusted(event);
        try {
          ready().service.assertIdle();
          action();
          return { ok: true, history: ready().storage.historyState(page) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      };
      ipcMain.handle('ai:delete-versions', (event, page, items, expected) =>
        historyMutation(event, page, () => ready().storage.deleteVersions(page, items, expected)),
      );
      ipcMain.handle('ai:recover-versions', (event, page, items) =>
        historyMutation(event, page, () => ready().storage.recoverVersions(page, items)),
      );
      ipcMain.handle('ai:purge-versions', (event, page, items) =>
        historyMutation(event, page, () => ready().storage.purgeVersions(page, items)),
      );
      ipcMain.handle('ai:recover-draft', (event, page, id, expected) =>
        historyMutation(event, page, () => ready().storage.recoverDraft(page, id, expected)),
      );
      ipcMain.handle('ai:delete-drafts', (event, page, ids) =>
        historyMutation(event, page, () => ready().storage.deleteDrafts(page, ids)),
      );
      ipcMain.handle('ai:connection', (event) => {
        trusted(event);
        return ready().storage.getConnection();
      });
      ipcMain.handle('ai:versions', (event) => {
        trusted(event);
        return ready().storage.listVersions();
      });
      ipcMain.handle('ai:restore-version', (event, number, expectedDraft) => {
        trusted(event);
        try {
          const { storage, service } = ready();
          service.assertIdle();
          return { ok: true, version: storage.restoreVersion(number, expectedDraft) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('ai:save-connection', (event, input) => {
        trusted(event);
        try {
          const { storage, service } = ready();
          service.assertIdle();
          return { ok: true, connection: storage.saveConnection(input) };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('ai:remove-connection', (event) => {
        trusted(event);
        try {
          const { storage, service } = ready();
          service.assertIdle();
          storage.removeConnection();
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('ai:test', async (event, revision) => {
        trusted(event);
        try {
          const connection = ready().storage.getConnection();
          if (!connection || connection.revision !== revision) throw new Error('Stale connection');
          const testConnection = ready().storage.registry.modelConnection(
            connection.modelConfigId!,
          );
          await ready().service.testModel(
            connection.modelConfigId!,
            testConnection.revision,
            'text',
          );
          return {
            ok: true,
            message: '认证、模型访问与文本流式生成测试通过；不代表图片或文件能力已验证。',
          };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('ai:generate', async (event, request) => {
        trusted(event);
        try {
          if (importing) throw new Error('Import in progress');
          const version = await ready().service.generate(request, (delta) => {
            if (!event.sender.isDestroyed()) event.sender.send('ai:delta', delta);
          });
          return { ok: true, version };
        } catch (error) {
          return {
            ok: false,
            message: publicAiError(error),
            diagnostic: publicAiDiagnostic(error),
          };
        }
      });
      ipcMain.handle('ai:cancel', (event, runId) => {
        trusted(event);
        ready().service.cancel(runId);
      });
      ipcMain.handle('workbench:inspect', (event, page) => {
        trusted(event);
        return database().workbench.inspect(page);
      });
      for (const action of ['clear', 'undo'] as const) {
        ipcMain.handle(`workbench:${action}`, (event, expected) => {
          trusted(event);
          try {
            if (importing) throw new Error('资料导入运行中，请等待结束后操作。');
            return { ok: true, value: ready().service.changeWorkbench(action, expected) };
          } catch (error) {
            return { ok: false, diagnostic: publicAiDiagnostic(error) };
          }
        });
      }
      ipcMain.handle('workbench:select', (event, page, id, revision) => {
        trusted(event);
        try {
          if (importing) throw new Error('资料导入运行中，请等待结束后操作。');
          return { ok: true, value: ready().service.selectAssessment(page, id, revision) };
        } catch (error) {
          return { ok: false, diagnostic: publicAiDiagnostic(error) };
        }
      });
      ipcMain.handle('workspace:load', (event) => {
        trusted(event);
        return database().load();
      });
      ipcMain.handle('workspace:save', (event, id, draft) => {
        trusted(event);
        if (aiService?.isPageBusy(id)) throw new Error('生成期间本页输入已锁定');
        return database().saveWorkspace(id, draft);
      });
      ipcMain.handle('preferences:save', (event, preferences) => {
        trusted(event);
        database().savePreferences(preferences);
      });
      ipcMain.handle('document:export', async (event, id, format, text) => {
        trusted(event);
        assertWorkspaceId(id);
        if (
          !['resume', 'letter'].includes(id) ||
          !['md', 'txt'].includes(format) ||
          typeof text !== 'string' ||
          text.length > 500_000
        )
          throw new Error('Invalid export');
        const result = await dialog.showSaveDialog(window!, {
          title: '保存本地草稿',
          defaultPath: `${id === 'resume' ? '简历' : '求职信'}-草稿.${format}`,
          filters: [{ name: format === 'md' ? 'Markdown' : '纯文本', extensions: [format] }],
        });
        if (result.canceled || !result.filePath) return false;
        await atomicExport(result.filePath, text);
        return true;
      });
      ipcMain.handle('app:close-ready', (event, saved) => {
        trusted(event);
        void finishClose(saved === true && !aiService?.busy && !importing);
      });
      window = new BrowserWindow({
        width: 1440,
        height: 1000,
        minWidth: 860,
        minHeight: 640,
        title: 'Career Assistant · 求职助手',
        backgroundColor: '#f6f8f7',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          devTools: !app.isPackaged,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          offscreen: false,
          backgroundThrottling: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.on('ready-to-show', () => {
        if (!testMode || app.isPackaged) window?.show();
      });
      window.on('close', (event) => {
        if (closeAllowed) return;
        event.preventDefault();
        if (closing) return;
        closing = true;
        window?.webContents.send('app:prepare-close');
        closeTimer = setTimeout(() => void finishClose(false), 8000);
      });
      window.on('closed', () => {
        clearTimeout(closeTimer);
        window = null;
      });
      void window.loadURL(rendererURL);
    })
    .catch(() => {
      dialog.showErrorBox(
        'Career Assistant 启动失败',
        '无法初始化本地工作区。没有清空或重置已有资料，请检查目录访问权限。',
      );
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    importing?.abort();
    aiService?.cancelAll();
    materials?.close();
    scores?.close();
    matches?.close();
    interviews?.close();
    aiStore?.close();
    store?.close();
  });
}
