import { DatabaseSync } from 'node:sqlite';
import type { InterviewRecord } from '../shared/interview';
import {
  WorkbenchStore,
  initWorkbench,
  workbenchTransaction,
  writeWorkbench,
} from './workbench-store';
export class InterviewStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS interview_records (id TEXT PRIMARY KEY,payload TEXT NOT NULL);',
    );
    initWorkbench(this.db);
  }
  list(): InterviewRecord[] {
    return this.db
      .prepare('SELECT payload FROM interview_records ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(String(row.payload)));
  }
  has(id: string) {
    return !!this.db.prepare('SELECT 1 FROM interview_records WHERE id=?').get(id);
  }
  save(record: InterviewRecord) {
    workbenchTransaction(this.db, () => {
      this.db
        .prepare('INSERT INTO interview_records VALUES(?,?)')
        .run(record.id, JSON.stringify(record));
      writeWorkbench(this.db, 'interview', record.id);
    });
    return record;
  }
  deleteMany(ids: string[], revision: string) {
    return new WorkbenchStore(this.db).deleteHistory('interview', ids, revision);
  }
  close() {
    this.db.close();
  }
}
