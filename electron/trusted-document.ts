export function isTrustedDocument(actual: string, expected: string): boolean {
  try {
    const document = new URL(actual);
    const target = new URL(expected);
    document.hash = '';
    target.hash = '';
    return document.href === target.href;
  } catch {
    return false;
  }
}
