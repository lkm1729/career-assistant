import { expect, _electron as electron, type Page, type Locator } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { MaterialStore } from '../electron/material-store';
const require = createRequire(import.meta.url);
export type Sample = {
  name: string;
  elapsed: number;
  frames: number[];
  longTasks: number[];
  nodes: number;
  commits: number;
  streamUpdates: number;
};
// Timing/counts only: never captures text, keys or responses.
export async function measure(
  page: Page,
  name: string,
  action: () => Promise<unknown>,
): Promise<Sample> {
  await page.evaluate(() => {
    const state = {
      start: performance.now(),
      frames: [] as number[],
      longTasks: [] as number[],
      last: performance.now(),
      raf: 0,
      commits: (window as unknown as { o6Commits: number }).o6Commits,
      streamUpdates: 0,
    };
    const observer = new PerformanceObserver((list) =>
      state.longTasks.push(...list.getEntries().map((e) => e.duration)),
    );
    observer.observe({ type: 'longtask' });
    const tick = (now: number) => {
      state.frames.push(now - state.last);
      state.last = now;
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    const streamObserver = new MutationObserver(() => {
      state.streamUpdates++;
    });
    const stream = document.querySelector('.stream-preview');
    if (stream)
      streamObserver.observe(stream, { childList: true, characterData: true, subtree: true });
    Object.assign(window, { o6Sample: { state, observer, streamObserver } });
  });
  await action();
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  return page.evaluate((name) => {
    const { state, observer, streamObserver } = (
      window as unknown as {
        o6Sample: {
          state: {
            start: number;
            frames: number[];
            longTasks: number[];
            raf: number;
            commits: number;
            streamUpdates: number;
          };
          observer: PerformanceObserver;
          streamObserver: MutationObserver;
        };
      }
    ).o6Sample;
    state.longTasks.push(...observer.takeRecords().map((e) => e.duration));
    observer.disconnect();
    streamObserver.disconnect();
    cancelAnimationFrame(state.raf);
    return {
      name,
      elapsed: performance.now() - state.start,
      frames: state.frames,
      longTasks: state.longTasks,
      nodes: document.querySelectorAll('*').length,
      commits: (window as unknown as { o6Commits: number }).o6Commits - state.commits,
      streamUpdates: state.streamUpdates,
    };
  }, name);
}
// Exclude automation scrolling/actionability waits from interaction timing.
export async function activate(locator: Locator) {
  await locator.evaluate((el: HTMLElement) => el.click());
}
export async function fixture(size: number) {
  let posts = 0;
  const timers = new Set<ReturnType<typeof setInterval>>();
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET') {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            data: Array.from({ length: size }, (_, i) => ({ id: `discover-${i}` })),
          }),
        );
        return;
      }
      posts++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const timer = setInterval(
        () =>
          res.write(
            'data: ' +
              JSON.stringify({
                choices: [{ index: 0, delta: { content: 'fixture ' }, finish_reason: null }],
              }) +
              '\n\n',
          ),
        10,
      );
      timers.add(timer);
      res.on('close', () => {
        clearInterval(timer);
        timers.delete(timer);
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture address');
  mkdirSync('.test-data', { recursive: true });
  const data = mkdtempSync(resolve('.test-data/o6-performance-'));
  // Score has no pasted-web import UI. Seed actual isolated TXT copies instead.
  const materials = new MaterialStore(join(data, 'workspace.sqlite'));
  try {
    const paths = Array.from({ length: size === 9 ? 2 : 16 }, (_, i) => {
      const path = join(data, `score-private-${i}.txt`);
      writeFileSync(path, 'score fictional evidence. '.repeat(size === 9 ? 2 : 100));
      return path;
    });
    await materials.importPaths(
      'score',
      'evidence',
      paths,
      async (_kind, bytes) => ({
        totalPages: 1,
        pages: [{ number: 1, text: bytes.toString(), source: 'text', warnings: [] }],
        warnings: [],
      }),
      new AbortController().signal,
    );
    expect(materials.list('score').every((m) => m.status === 'ready')).toBe(true);
  } finally {
    materials.close();
  }
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    CAREER_TEST_MODE: '1',
    CAREER_TEST_DATA: data,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAREER_DEV_URL;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [process.env.CAREER_E2E_APP_PATH ?? '.'],
    env,
  });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation', { name: '求职工具' })).toBeVisible();
  await page.evaluate(
    async ({ size, baseUrl }) => {
      const api = window.career!;
      const providers: string[] = [];
      for (let p = 0; p < 2; p++) {
        const r = await api.ai.registry.saveProvider({
          name: `Perf ${p}`,
          baseUrl,
          protocol: 'chat-completions',
          apiKey: 'FAKE-O6',
        });
        if (!r.ok) throw Error(r.message);
        providers.push(r.catalog.providers[p].id);
      }
      let first = '';
      for (let i = 0; i < size; i++) {
        const r = await api.ai.registry.saveModel({
          providerId: providers[i % 2],
          name: `Perf Model ${i}`,
          modelId: `perf-${i}`,
          protocol: 'inherit',
          capabilities: { images: 'unknown', files: 'unknown', structuredOutput: 'unknown' },
          parameterSupport: {
            temperature: false,
            maxCompletionTokens: false,
            reasoningEffort: false,
          },
          parameters: {},
        });
        if (!r.ok) throw Error(r.message);
        if (!i) first = r.catalog.models[0].id;
      }
      const snapshot = await api.load();
      for (const id of ['resume', 'score', 'match', 'letter'] as const) {
        const c = await api.ai.registry.catalog();
        await api.ai.registry.selectModel(id, first, {}, c.pages[id].revision);
        await api.saveWorkspace(id, {
          ...snapshot.workspaces[id],
          prompt: `${id} Python required`,
          document:
            '# Fictional resume\n\n' +
            '## Project\n\n- **Python** testing and delivery.\n\n'.repeat(size === 9 ? 5 : 300),
          resumeText: `${id} Python projects`,
          evidenceText: `${id} evidence`,
        });
        for (let m = 0; id !== 'score' && m < (size === 9 ? 2 : 16); m++) {
          const imported = await api.materials.importText(id, 'evidence', {
            title: `${id}-private-${m}`,
            text: `${id} fictional evidence. `.repeat(size === 9 ? 2 : 100),
          });
          if (!imported.ok) throw Error(imported.diagnostic.message);
        }
        const items = await api.materials.list(id);
        if (items.length !== (size === 9 ? 2 : 16) || items.some((m) => m.selected))
          throw Error('Invalid isolated material fixture');
      }
    },
    { size, baseUrl: `http://127.0.0.1:${address.port}/v1` },
  );
  // Test-only aggregate commit counter, verified against the installed React renderer hook.
  // Do not retain or traverse fibers: they can contain application data.
  await page.addInitScript(() => {
    let count = 0;
    Object.defineProperty(window, 'o6Commits', { get: () => count });
    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => 1,
        onCommitFiberRoot: () => {
          count++;
        },
        onCommitFiberUnmount: () => {},
      },
    });
  });
  await page.reload();
  await expect(page.getByRole('combobox', { name: '本页模型' })).not.toHaveValue('');
  return {
    page,
    app,
    get posts() {
      return posts;
    },
    async close() {
      await app.close();
      for (const timer of timers) clearInterval(timer);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
