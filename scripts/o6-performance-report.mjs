import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const quantile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
};
for (const directory of process.argv.slice(2)) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let report;
    try {
      report = JSON.parse(readFileSync(join(directory, entry.name, 'performance.json'), 'utf8'));
    } catch {
      continue;
    }
    console.log(`\n${directory}: ${report.size} models; ${report.cpu}`);
    const summaries = [...new Set(report.samples.map((s) => s.name))].map((name) => {
      const samples = report.samples.filter((s) => s.name === name);
      const times = samples.map((s) => s.elapsed);
      const frames = samples.flatMap((s) => s.frames);
      const tasks = samples.flatMap((s) => s.longTasks);
      return {
        name,
        n: samples.length,
        p50: quantile(times, 0.5),
        p95: quantile(times, 0.95),
        frameP95: quantile(frames, 0.95),
        frameMax: quantile(frames, 1),
        framesOver50: frames.filter((v) => v > 50).length,
        longTasks: tasks.length,
        longTaskMs: Math.round(tasks.reduce((a, b) => a + b, 0)),
        commits: samples.map((s) => s.commits).join('/'),
        streamHz:
          Math.round(
            (samples.reduce((n, s) => n + (s.streamUpdates ?? 0), 0) /
              times.reduce((a, b) => a + b, 0)) *
              10000,
          ) / 10,
      };
    });
    console.table(summaries);
  }
}
