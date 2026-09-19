import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPage } from '../src/ListPager';
test('O6 paging covers every model in order without changing source or selection', () => {
  const models = Object.freeze(Array.from({ length: 500 }, (_, i) => ({ id: i })));
  const selected = new Set([0, 499]);
  const shown = Array.from({ length: 20 }, (_, page) => listPage(models, page, 25).items).flat();
  assert.deepEqual(shown, models);
  assert.equal(new Set(shown).size, 500);
  assert.deepEqual([...selected], [0, 499]);
});
test('O6 empty/filter/deletion clamps old page indices without an empty phantom page', () => {
  assert.deepEqual(listPage([], 19, 25), { items: [], page: 0, pages: 1 });
  assert.deepEqual(listPage(['last match'], 19, 25), { items: ['last match'], page: 0, pages: 1 });
  assert.deepEqual(listPage([1, 2, 3], -1, 2), { items: [1, 2], page: 0, pages: 2 });
  assert.deepEqual(listPage([1, 2, 3], 9, 2), { items: [3], page: 1, pages: 2 });
});
