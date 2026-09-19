import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseScore } from '../electron/scoring';
import { AiError } from '../shared/ai';
const manifest = { revision: 'test', items: [], warnings: [], imageCount: 0, textCount: 0 };
for (const [body, shape] of [
  ['{"summary":"PRIVATE', 'UNTERMINATED_STRING'],
  ['{"dimensions":[', 'UNCLOSED_CONTAINER'],
  ['{"dimensions":]}', 'MISMATCHED_CONTAINER'],
  ['{"dimensions":[] "summary":"PRIVATE"}', 'INVALID_SYNTAX'],
])
  test('JSON syntax diagnosis: ' + shape, () => {
    assert.throws(
      () => parseScore('```json\n' + body + '\n```', manifest, ''),
      (e: unknown) => {
        assert.ok(e instanceof AiError);
        assert.equal(e.diagnostic?.code, 'AI_SCORE_JSON');
        assert.match(e.diagnostic.message, new RegExp('shape=' + shape));
        assert.doesNotMatch(JSON.stringify(e.diagnostic), /PRIVATE/);
        return true;
      },
    );
  });
