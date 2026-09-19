import {
  WorkbenchStore,
  initWorkbench,
  writeWorkbench,
  workbenchTransaction,
} from './workbench-store';
import { DatabaseSync } from 'node:sqlite';
import type { MatchRecord } from '../shared/matching';
export class MatchStore {
  constructor(private db: DatabaseSync) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS match_records (id TEXT PRIMARY KEY,payload TEXT NOT NULL);',
    );
    initWorkbench(this.db);
  }
  list(): MatchRecord[] {
    return this.db
      .prepare('SELECT payload FROM match_records ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.payload)));
  }
  has(id: string) {
    return !!this.db.prepare('SELECT id FROM match_records WHERE id=?').get(id);
  }
  save(r: MatchRecord) {
    workbenchTransaction(this.db, () => {
      this.db.prepare('INSERT INTO match_records VALUES(?,?)').run(r.id, JSON.stringify(r));
      writeWorkbench(this.db, 'match', r.id);
    });
    return r;
  }
  deleteMany(ids: string[], revision: string) {
    return new WorkbenchStore(this.db).deleteHistory('match', ids, revision);
  }
  close() {
    this.db.close();
  }
}
