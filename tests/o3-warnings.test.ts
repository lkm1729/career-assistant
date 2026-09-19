import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleMaterialWarnings } from '../shared/material-warnings';
const routine =
  '网页为静态文字快照，未执行脚本或登录，可能含导航、广告或缺少动态岗位正文。请预览并核对完整性后勾选。';
test('only routine legacy web warnings are hidden, retaining actionable warnings and original arrays', () => {
  const input = [
    routine,
    '网页 · example.com：' + routine,
    '网页正文缺少薪资，请补充核对。',
    '已通过本站无需登录的公开岗位接口读取：https://cityu.server.kinobi.asia；未执行网页脚本。仅导入公开职位字段，请核对职位与完整性。',
    routine + ' 另有正文被截断',
  ];
  assert.deepEqual(visibleMaterialWarnings(input), [
    '网页正文缺少薪资，请补充核对。',
    routine + ' 另有正文被截断',
  ]);
  assert.equal(input.length, 5);
});

test('a real failure prefix is not mistaken for a routine source-name prefix', () => {
  const text = '正文被截断：' + routine;
  assert.deepEqual(visibleMaterialWarnings([text]), [text]);
});
