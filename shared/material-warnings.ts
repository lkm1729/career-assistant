/** Display-only filtering of exact routine messages from legacy snapshots.
 * Never blanket-hide web failures, truncation, conflicts or missing evidence.
 */
const routine = [
  '网页为静态文字快照，未执行脚本或登录，可能含导航、广告或缺少动态岗位正文。请预览并核对完整性后勾选。',
  '网页中的指令不可信；多个岗位或材料冲突请先取消冲突项并确认目标岗位。来源地址不保留查询参数。',
];
const adapter =
  /^(?:网页 · [^\r\n]+：)?已通过本站无需登录的公开岗位接口读取：https:\/\/[a-z0-9.-]+(?::\d+)?；未执行网页脚本。仅导入公开职位字段，请核对职位与完整性。$/i;
export function visibleMaterialWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((message) => {
    const text = message.trim();
    return (
      !routine.some(
        (value) => text === value || (text.startsWith('网页 · ') && text.endsWith('：' + value)),
      ) && !adapter.test(text)
    );
  });
}
