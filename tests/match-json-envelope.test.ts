import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatch } from '../shared/matching';
import { publicAiDiagnostic } from '../electron/ai-service';
const result = {
  requirements: [
    {
      id: 'r1',
      requirement: 'Python',
      hard: false,
      status: 'met',
      jobEvidence: [{ sourceId: 'job', quote: 'Python' }],
      evidence: [{ sourceId: 'resume', quote: 'Python' }],
      note: 'Verified',
    },
  ],
  summary: 'Fictional result',
  recommendation: 'consider',
  reasons: [],
  warnings: [],
};
const json = JSON.stringify(result);
for (const [name, response] of [
  ['plain', json],
  ['whole fence', '```json\n' + json + '\n```'],
  [
    'single explicit fence with prose',
    'Here is the matching result:\n```json\n' + json + '\n```\nBased only on supplied sources.',
  ],
  ['uppercase language and CRLF', '结果如下：\r\n```JSON\r\n' + json + '\r\n```'],
] as const)
  test(`matching JSON envelope: ${name}`, () => {
    assert.equal(parseMatch(response, 'Python', 'Python').coverage, 100);
  });
for (const [name, response] of [
  ['two fenced results', '```json\n' + json + '\n```\n```json\n' + json + '\n```'],
  ['two raw results', json + '\n' + json],
  ['broken JSON in fence', '```json\n' + json.slice(0, -1) + '\n```'],
  ['unclosed fence', '```json\n' + json],
  ['prose only', 'PRIVATE-PROVIDER-BODY'],
  ['nested result in prose', 'Example {"fake":' + json + '} PRIVATE-PROVIDER-BODY'],
  ['bad fenced result plus raw object', '```json\nno\n```\n' + json],
  ['fenced result plus raw object', '```json\n' + json + '\n```\n' + json],
] as const)
  test(`matching refuses ambiguous or incomplete envelope: ${name}`, () => {
    assert.throws(
      () => parseMatch(response, 'Python', 'Python'),
      (error) => {
        const d = publicAiDiagnostic(error);
        assert.equal(d.code, 'AI_MATCH_JSON');
        assert.doesNotMatch(JSON.stringify(d), /PRIVATE-PROVIDER-BODY|Python|Fictional result/);
        return true;
      },
    );
  });
test('envelope extraction still rejects fabricated evidence', () => {
  const raw = JSON.stringify({
    ...result,
    requirements: [
      {
        ...result.requirements[0],
        evidence: [{ sourceId: 'resume', quote: 'PRIVATE-FAKE-QUOTE' }],
      },
    ],
  });
  assert.throws(
    () => parseMatch('Result:\n```json\n' + raw + '\n```', 'Python', 'Python'),
    (error) => {
      assert.equal(publicAiDiagnostic(error).code, 'AI_MATCH_QUOTE');
      return true;
    },
  );
});

test('non-JSON failures provide a content-free response shape rather than only NOT_DOCUMENT', () => {
  const cases = [
    [
      'PRIVATE-RESPONSE: a narrative report',
      '正文首部=其他文字',
      '含左花括号=否',
      '含think标签=否',
    ],
    ['Here is the result:\n' + json, '正文首部=其他文字', '含左花括号=是', '含think标签=否'],
    [
      '<think>PRIVATE-RESPONSE</think>\n' + json,
      '正文首部=标签',
      '含左花括号=是',
      '含think标签=是',
    ],
  ];
  for (const [response, ...shape] of cases) {
    assert.throws(
      () => parseMatch(response, 'Python', 'Python'),
      (error) => {
        const diagnostic = publicAiDiagnostic(error);
        assert.equal(diagnostic.code, 'AI_MATCH_JSON');
        assert.match(diagnostic.message, /JSON_NOT_DOCUMENT/);
        for (const part of shape) assert.ok(diagnostic.message.includes(part), part);
        assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE-RESPONSE|Python|Fictional result/);
        return true;
      },
    );
  }
});
