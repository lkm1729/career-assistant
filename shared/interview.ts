import type { ConnectionInfo } from './ai';
import type { MaterialManifest } from './materials';
import type { AiDiagnostic } from './diagnostics';

export interface InterviewPair {
  question: string;
  answer: string;
  /** 0.14.0 records have only English text. Never invent a translation on display. */
  questionZh?: string;
  answerZh?: string;
}
export interface InterviewConfirmation {
  runId: string;
  revision: string;
  workbenchRevision: string;
  connection: ConnectionInfo;
  input: { job: string; resume: string; evidence: string; systemPrompt: string };
  materials: MaterialManifest;
  sendImages: boolean;
  sameJobConfirmed?: boolean;
}
export interface InterviewRecord {
  id: string;
  createdAt: string;
  connection: ConnectionInfo;
  input: InterviewConfirmation['input'];
  materials: unknown;
  pairs: InterviewPair[];
}
export type InterviewReply<T> = { ok: true; value: T } | { ok: false; diagnostic: AiDiagnostic };
export interface InterviewBridge {
  prepare(sendImages: boolean): Promise<InterviewReply<InterviewConfirmation>>;
  run(confirmation: InterviewConfirmation): Promise<InterviewReply<InterviewRecord>>;
  cancel(runId: string): Promise<void>;
  history(): Promise<InterviewRecord[]>;
  deleteMany(ids: string[], revision: string): Promise<import('./ai').HistoryBulkDeleteReply>;
}
/** Fail closed on incomplete/misnumbered translations. Legacy saved pairs remain readable. */
export function parseInterview(text: string): InterviewPair[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:text|markdown)?\s*|\s*```$/g, '')
    .trim();
  const marks = [...cleaned.matchAll(/(?:^|\n)[ \t]*(Q|A)(\d{1,2})(-ZH)?\.[ \t]+/g)];
  if (marks.length !== 80)
    throw new Error('面试问答响应需包含完整的20组中英双语 Q/A；未保存结果。');
  const pairs: InterviewPair[] = [];
  for (let i = 0; i < 80; i += 4) {
    const expected = [
      ['Q', undefined],
      ['Q', '-ZH'],
      ['A', undefined],
      ['A', '-ZH'],
    ] as const;
    const fields = expected.map(([kind, language], offset) => {
      const mark = marks[i + offset];
      if (mark[1] !== kind || mark[3] !== language || Number(mark[2]) !== i / 4 + 1)
        throw new Error('面试问答语言标签、编号或顺序错误；未保存结果。');
      const value = cleaned
        .slice(mark.index! + mark[0].length, marks[i + offset + 1]?.index ?? cleaned.length)
        .trim();
      if (!value || value.length > (kind === 'Q' ? 2000 : 10000))
        throw new Error('面试问答内容不完整；未保存结果。');
      if (language && !/\p{Script=Han}/u.test(value))
        throw new Error('面试问答中文翻译缺失；未保存结果。');
      return value;
    });
    pairs.push({
      question: fields[0],
      questionZh: fields[1],
      answer: fields[2],
      answerZh: fields[3],
    });
  }
  return pairs;
}
