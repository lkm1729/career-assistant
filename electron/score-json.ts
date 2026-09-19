import { scoreProseQuotes } from './score-prose';
/** Bounded JSON grammar for score responses only.
 * Default presentation deviations: trailing commas, comments outside strings,
 * and literal CR/LF/TAB in string values. Never infer keys, values, quotes or containers.
 * Opt-in score prose may preserve paired raw quotes within known structural boundaries.
 * No eval, dependency repair library, source echo, network access or raw response storage.
 */
export type JsonPresentation = 'TRAILING_COMMA' | 'STRING_CONTROLS' | 'COMMENTS' | 'PROSE_QUOTES';
export type JsonReason =
  | 'UNEXPECTED_TOKEN'
  | 'UNTERMINATED_STRING'
  | 'INVALID_ESCAPE'
  | 'STRING_CONTROL'
  | 'KEY_REQUIRED'
  | 'COLON_REQUIRED'
  | 'VALUE_REQUIRED'
  | 'SEPARATOR_REQUIRED'
  | 'UNCLOSED_CONTAINER'
  | 'MISMATCHED_CONTAINER'
  | 'UNTERMINATED_COMMENT'
  | 'DUPLICATE_KEY'
  | 'EXTRA_CONTENT'
  | 'NUMBER_RANGE'
  | 'DEPTH_LIMIT'
  | 'SIZE_LIMIT';
export class ScoreJsonSyntaxError extends Error {
  constructor(readonly reason: JsonReason) {
    super(reason);
  }
}
export function decodeScoreJson(
  input: string,
  options: { scoreProseQuotes?: boolean } = {},
): { value: unknown; normalized: JsonPresentation[] } {
  // Valid documents always take the normal grammar; compatibility cannot reinterpret them.
  if (options.scoreProseQuotes) {
    try {
      return decodeScoreJson(input);
    } catch (error) {
      if (!(error instanceof ScoreJsonSyntaxError)) throw error;
    }
  }
  const fail = (reason: JsonReason): never => {
    throw new ScoreJsonSyntaxError(reason);
  };
  if (input.length > 700_000) fail('SIZE_LIMIT');
  let at = 0;
  const fixes = new Set<JsonPresentation>();
  const space = () => {
    while (at < input.length) {
      if (/^[ \t\r\n]$/.test(input[at])) {
        at++;
        continue;
      }
      if (input.startsWith('//', at)) {
        fixes.add('COMMENTS');
        at += 2;
        while (at < input.length && input[at] !== '\n' && input[at] !== '\r') at++;
        continue;
      }
      if (input.startsWith('/*', at)) {
        const end = input.indexOf('*/', at + 2);
        if (end < 0) fail('UNTERMINATED_COMMENT');
        fixes.add('COMMENTS');
        at = end + 2;
        continue;
      }
      return;
    }
  };
  const string = (key = false, prose?: 'array' | 'object'): string => {
    if (input[at] !== '"') fail('KEY_REQUIRED');
    const rawQuotes = prose ? scoreProseQuotes(input, at, prose) : undefined;
    at++;
    let value = '';
    while (at < input.length) {
      const ch = input[at++];
      if (ch === '"' && !rawQuotes?.has(at - 1)) return value;
      if (ch === '"') fixes.add('PROSE_QUOTES');
      if (ch === '\\') {
        if (at >= input.length) fail('UNTERMINATED_STRING');
        const escaped = input[at++];
        if (escaped === 'u') {
          const hex = input.slice(at, at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('INVALID_ESCAPE');
          value += String.fromCharCode(parseInt(hex, 16));
          at += 4;
        } else {
          const escapes: Record<string, string> = {
            '"': '"',
            '\\': '\\',
            '/': '/',
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
          };
          if (!Object.hasOwn(escapes, escaped)) fail('INVALID_ESCAPE');
          value += escapes[escaped];
        }
      } else {
        if (ch.charCodeAt(0) < 32) {
          if (key || !['\n', '\r', '\t'].includes(ch)) fail('STRING_CONTROL');
          fixes.add('STRING_CONTROLS');
        }
        value += ch;
      }
    }
    return fail('UNTERMINATED_STRING');
  };
  const value = (depth: number, path: readonly (string | number)[] = []): unknown => {
    space();
    if (at >= input.length) fail('VALUE_REQUIRED');
    const ch = input[at];
    if (ch === '"') {
      const dimension = path[0] === 'dimensions' && typeof path[1] === 'number';
      const arrayProse =
        dimension &&
        path.length === 4 &&
        (path[2] === 'issues' || path[2] === 'suggestions') &&
        typeof path[3] === 'number';
      const objectProse =
        (path.length === 1 && path[0] === 'summary') ||
        (dimension && path.length === 3 && path[2] === 'example') ||
        (dimension &&
          path.length === 5 &&
          path[2] === 'evidence' &&
          typeof path[3] === 'number' &&
          path[4] === 'quote');
      return string(
        false,
        options.scoreProseQuotes
          ? arrayProse
            ? 'array'
            : objectProse
              ? 'object'
              : undefined
          : undefined,
      );
    }
    if (ch === '{' || ch === '[') {
      if (depth >= 64) fail('DEPTH_LIMIT');
      const object = ch === '{',
        close = object ? '}' : ']';
      const result: Record<string, unknown> | unknown[] = object ? {} : [];
      const keys = new Set<string>();
      at++;
      space();
      if (input[at] === close) {
        at++;
        return result;
      }
      while (true) {
        if (at >= input.length) fail('UNCLOSED_CONTAINER');
        if (object) {
          const key = string(true);
          if (keys.has(key)) fail('DUPLICATE_KEY');
          keys.add(key);
          space();
          if (input[at] !== ':') fail('COLON_REQUIRED');
          at++;
          const v = value(depth + 1, [...path, key]);
          // Preserve __proto__ as an own data property, never invoke its setter.
          Object.defineProperty(result, key, {
            value: v,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        } else
          (result as unknown[]).push(value(depth + 1, [...path, (result as unknown[]).length]));
        space();
        if (input[at] === close) {
          at++;
          return result;
        }
        if (at >= input.length) fail('UNCLOSED_CONTAINER');
        if (input[at] === '}' || input[at] === ']') fail('MISMATCHED_CONTAINER');
        if (input[at] !== ',') fail('SEPARATOR_REQUIRED');
        at++;
        space();
        if (input[at] === close) {
          fixes.add('TRAILING_COMMA');
          at++;
          return result;
        }
      }
    }
    for (const [token, literal] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (input.startsWith(token, at)) {
        at += token.length;
        return literal;
      }
    }
    if (ch === '-' || /[0-9]/.test(ch)) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(at));
      if (!match) fail('UNEXPECTED_TOKEN');
      const n = Number(match![0]);
      if (!Number.isFinite(n)) fail('NUMBER_RANGE');
      at += match![0].length;
      return n;
    }
    if (ch === '}' || ch === ']' || ch === ',') fail('VALUE_REQUIRED');
    return fail('UNEXPECTED_TOKEN');
  };
  const parsed = value(0);
  space();
  if (at !== input.length) fail('EXTRA_CONTENT');
  return { value: parsed, normalized: [...fixes].sort() };
}
