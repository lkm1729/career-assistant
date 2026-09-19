import { resolvePublicWebHost } from './web-dns';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { publicJobEndpoint } from '../shared/web-sources';
import { AiError } from '../shared/ai';
import type { AiDiagnostic } from '../shared/diagnostics';
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
export function publicAddress(address: string) {
  // Deliberately IPv4 only; no mapped IPv6, NAT64, scope IDs or transition tunnels.
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}
export function webUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f]/.test(value))
    throw new AiError('请每次提供一个完整 HTTPS 岗位或补充证据链接。');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AiError('网页链接格式无效。');
  }
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    !url.hostname.includes('.') ||
    url.hostname.endsWith('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(url.hostname) ||
    (isIP(url.hostname) && !publicAddress(url.hostname))
  )
    throw new AiError('只读取公开 HTTPS 网页（443端口），不允许内网、本机、带账号密码或危险链接。');
  if (
    [...url.searchParams.keys()].some((k) =>
      /^(?:key|api[_-]?key|token|access_token|auth|password|signature)$/i.test(k),
    )
  )
    throw new AiError('链接含疑似凭证参数，请使用公开岗位链接，不要粘贴带登录凭证的地址。');
  url.hash = '';
  return url;
}
function entities(text: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    bull: '•',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
  };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key: string) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? all;
    const value = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : '';
  });
}
export function webpageText(body: string, contentType: string): string {
  return webpageContent(body, contentType).text;
}
function webpageContent(body: string, contentType: string): { text: string; title?: string } {
  if (contentType === 'text/plain') return { text: body.trim() };
  // A bounded forward-only scanner, not an HTML renderer. Avoid regex rescanning
  // malformed multi-megabyte markup on the Electron main thread.
  const lower = body.toLowerCase();
  const parts: string[] = [];
  let title = '',
    heading = '',
    capture = '';
  const append = (text: string) => {
    parts.push(text);
    if (capture === 'title' && title.length < 1000) title += text.slice(0, 1000 - title.length);
    if (capture === 'h1' && heading.length < 1000) heading += text.slice(0, 1000 - heading.length);
  };
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf('<', cursor);
    if (start < 0) {
      append(body.slice(cursor));
      break;
    }
    append(body.slice(cursor, start));
    if (body.startsWith('<!--', start)) {
      const end = body.indexOf('-->', start + 4);
      cursor = end < 0 ? body.length : end + 3;
      parts.push(' ');
      continue;
    }
    let end = start + 1,
      quote = '';
    for (; end < body.length; end++) {
      const char = body[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === body.length) break;
    const tag = /^<\s*(\/?)([a-z][a-z0-9]*)/i.exec(body.slice(start, end + 1));
    cursor = end + 1;
    if (
      tag &&
      !tag[1] &&
      ['script', 'style', 'noscript', 'svg', 'template', 'iframe'].includes(tag[2].toLowerCase())
    ) {
      const close = lower.indexOf('</' + tag[2].toLowerCase(), cursor);
      if (close < 0) break;
      const closeEnd = body.indexOf('>', close);
      cursor = closeEnd < 0 ? body.length : closeEnd + 1;
      parts.push(' ');
      continue;
    }
    if (tag) {
      const name = tag[2].toLowerCase();
      if (tag[1] && name === capture) capture = '';
      else if (!tag[1] && ((name === 'title' && !title) || (name === 'h1' && !heading)))
        capture = name;
    }
    append(
      tag &&
        [
          'br',
          'p',
          'div',
          'li',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'tr',
          'section',
          'article',
        ].includes(tag[2].toLowerCase())
        ? '\n'
        : ' ',
    );
  }
  const cleanTitle = (value: string) =>
    entities(value)
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  return {
    title: cleanTitle(title) || cleanTitle(heading) || undefined,
    text: entities(parts.join(''))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]*/g, '\n')
      .replace(/\n\s*\n/g, '\n')
      .trim(),
  };
}

function webFailure(code: string, message: string, causes: string[], solutions: string[]): AiError {
  return new AiError(message, { code, message, possibleCauses: causes, solutions });
}
function publicJobText(body: string, endpoint: URL): string {
  const invalid = () =>
    webFailure(
      'WEB_PUBLIC_DATA_INVALID',
      '公开岗位数据不完整或与请求岗位不一致，未导入。',
      ['站点公开数据格式变化、职位已下架或正文不可公开读取'],
      ['在浏览器核对岗位，复制正文或导入PDF；不需要提供登录Cookie或密钥'],
    );
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body).data;
  } catch {
    throw invalid();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
  const requested = endpoint.pathname.split('/')[3];
  if (data.slug !== requested && data._id !== requested) throw invalid();
  const text = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length <= 200)
      return value
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
          throw invalid();
        })
        .join('\n');
    throw invalid();
  };
  const company =
    data.company && typeof data.company === 'object'
      ? (data.company as Record<string, unknown>).name
      : '';
  const description =
    text(data.description_text) || webpageText(text(data.description), 'text/html');
  const duties =
    text(data.responsibilities_text) || webpageText(text(data.responsibilities), 'text/html');
  const requirements =
    text(data.requirements_text) || webpageText(text(data.requirements), 'text/html');
  if (!text(data.title).trim() || (description + duties + requirements).trim().length < 40)
    throw invalid();
  // Allowlist public job facts only; never persist contacts, recipients, owner or applicant data.
  const fields = [
    ['职位', text(data.title)],
    ['公司', text(company)],
    ['职位描述', description],
    ['职责', duties],
    ['要求', requirements],
    ['雇佣类型', text(data.employment_type)],
    ['工作安排', text(data.work_arrangement)],
    ['城市', text(data.city)],
    ['地区', text(data.country_code)],
    ['截止时间', text(data.expired_at)],
  ];
  return (
    fields
      .filter(([, v]) => v.trim())
      .map(([k, v]) => k + '：\n' + v)
      .join('\n\n') + (data.is_expired === true ? '\n\n网站标记该岗位已过期。' : '')
  );
}
export interface WebResponse {
  status: number;
  location?: string;
  contentType: string;
  body: string;
}
export type WebTransport = (url: URL, address: string, signal: AbortSignal) => Promise<WebResponse>;
export const downloadWeb: WebTransport = (url, address, signal) =>
  new Promise((resolve, reject) => {
    // Pin the already validated IP. TLS verifies the original hostname; no second DNS lookup.
    const req = request(
      {
        hostname: address,
        port: 443,
        servername: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        agent: false,
        signal,
        headers: {
          Host: url.host,
          Accept: 'text/html, text/plain, application/json',
          'Accept-Encoding': 'identity',
          'User-Agent': 'CareerAssistant/LocalWebImport',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy();
          resolve({ status, location: res.headers.location, contentType: '', body: '' });
          return;
        }
        if (status !== 200) {
          res.destroy();
          reject(
            new AiError(
              `网页读取返回 HTTP ${status}。不绕过登录或验证码；请复制岗位正文或导入截图。`,
            ),
          );
          return;
        }
        const type = String(res.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (
          !['text/html', 'text/plain', 'application/xhtml+xml', 'application/json'].includes(
            type,
          ) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
        ) {
          res.destroy();
          reject(new AiError('网页格式或压缩方式不支持。请在浏览器保存PDF后导入，或粘贴正文。'));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            res.destroy(new AiError('网页超过2 MiB读取上限，请粘贴岗位正文。'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const charset =
              /charset\s*=\s*["']?([\w-]+)/i.exec(String(res.headers['content-type']))?.[1] ??
              'utf-8';
            resolve({
              status,
              contentType: type,
              body: new TextDecoder(charset).decode(Buffer.concat(chunks)),
            });
          } catch {
            reject(new AiError('网页编码不支持，请粘贴正文。'));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
export async function readWeb(
  value: unknown,
  signal: AbortSignal,
  dependencies: {
    resolve?: (host: string) => Promise<string[]>;
    download?: WebTransport;
    publicResolve?: (host: string, signal: AbortSignal) => Promise<string[]>;
  } = {},
  allowPublicDns = false,
) {
  if (typeof allowPublicDns !== 'boolean') throw new AiError('公共 DNS 授权无效，未联网读取。');
  const original = webUrl(value);
  const adapter = publicJobEndpoint(original.href);
  const retrieval = adapter ? webUrl(adapter) : original;
  let url = retrieval;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  // Race DNS too: a nonresponsive resolver must not retain the UI import lock.
  const aborted = new Promise<never>((_, reject) => {
    if (deadline.aborted) reject(new AiError('网页读取已取消或超时。'));
    else
      deadline.addEventListener('abort', () => reject(new AiError('网页读取已取消或超时。')), {
        once: true,
      });
  });
  const work = async () => {
    for (let hop = 0; hop <= 3; hop++) {
      deadline.throwIfAborted();
      let addresses = await (
        dependencies.resolve ??
        (async (host) => (await lookup(host, { all: true, family: 4 })).map((a) => a.address))
      )(url.hostname);
      deadline.throwIfAborted();
      // Never connect to the benchmark range. Only an explicit import consent permits
      // querying a fixed public resolver when ALL system answers are synthetic-range IPv4.
      if (addresses.length && addresses.every((a) => isIP(a) === 4 && /^198\.(18|19)\./.test(a))) {
        if (!allowPublicDns)
          throw webFailure(
            'WEB_DNS_SYNTHETIC',
            '本机 DNS 返回了保留网段地址，可能是代理的 Fake-IP；未访问该地址。',
            [
              '本次 DNS 结果全部位于 198.18.0.0/15；可能来自代理/TUN 合成解析，并非已确认网站属于内网',
            ],
            [
              '重新打开读取确认，按需勾选“允许公共 DNS 兼容解析”；仅查询主机名，不发送路径或简历',
              '或将代理调整为真实 DNS 解析后手动重试；不会关闭内网保护，也不会自动重试',
            ],
          );
        addresses = await (dependencies.publicResolve ?? resolvePublicWebHost)(
          url.hostname,
          deadline,
        );
        deadline.throwIfAborted();
      }
      if (!addresses.length || addresses.some((a) => !publicAddress(a)))
        throw new AiError('网页解析到内网、保留地址或不支持的地址，已阻止访问。');
      const response = await (dependencies.download ?? downloadWeb)(url, addresses[0], deadline);
      deadline.throwIfAborted();
      if (response.status >= 300 && response.status < 400) {
        if (!response.location || hop === 3)
          throw new AiError('网页重定向缺失或超过3次，请粘贴浏览器最终公开地址。');
        const next = webUrl(new URL(response.location, url).href);
        if (adapter || next.origin !== original.origin)
          throw new AiError(
            '网页跳转到另一网站，未自动跟随。请在浏览器确认最终公开地址后重新粘贴。',
          );
        url = next;
        continue;
      }
      if (response.status !== 200) throw new AiError('网页读取失败，请粘贴正文或导入截图。');
      if (adapter && response.contentType !== 'application/json')
        throw webFailure(
          'WEB_PUBLIC_DATA_INVALID',
          '公开岗位接口未返回JSON，未导入。',
          ['站点接口变化或要求登录'],
          ['请复制公开岗位正文；不会绕过登录'],
        );
      if (
        !adapter &&
        !['text/html', 'text/plain', 'application/xhtml+xml'].includes(response.contentType)
      )
        throw webFailure(
          'WEB_CONTENT_TYPE',
          '该链接不是支持的网页正文，未导入。',
          ['返回了非网页内容'],
          ['请使用岗位页面链接或粘贴正文'],
        );
      const content = adapter ? undefined : webpageContent(response.body, response.contentType);
      const text = adapter ? publicJobText(response.body, retrieval) : content!.text;
      const title = adapter ? text.split('\n')[1]?.trim().slice(0, 240) : content?.title;
      if (text.length < 40)
        throw webFailure(
          'WEB_CONTENT_EMPTY',
          '网页未提供足够的可读正文，尚未调用模型。',
          ['当前页面可能只返回动态网页外壳、登录提示或空内容；与所选模型无关'],
          [
            '可使用已支持的公开岗位数据适配；其他页面请复制浏览器中可见的岗位正文或导入PDF/截图',
            '不要提供账号密码、Cookie或API Key',
          ],
        );
      if (text.length > 120000)
        throw webFailure(
          'WEB_CONTENT_TOO_LARGE',
          '网页正文超过120000字符，未导入，也未调用模型。',
          ['页面包含过多岗位、导航或其他内容'],
          ['仅复制目标岗位正文，或将相关页面保存为PDF后导入'],
        );
      // Query parameters are used for retrieval but never persisted in source metadata.
      return {
        url: original.origin + original.pathname,
        retrievedUrl: url.origin + url.pathname,
        title,
        text,
        warnings: [],
      };
    }
    throw new AiError('网页读取失败。');
  };
  try {
    return await Promise.race([work(), aborted]);
  } catch (error) {
    if (signal.aborted)
      throw webFailure(
        'WEB_CANCELLED',
        '已取消网页读取，未保存本次未完成资料。',
        ['用户取消了网页请求'],
        ['此前成功导入的资料保留；如需读取请重新确认'],
      );
    if (deadline.aborted)
      throw webFailure(
        'WEB_TIMEOUT',
        '网页读取超时，尚未调用模型。',
        ['目标网站或DNS响应过慢'],
        ['稍后手动重试网页读取，或复制岗位正文/导入PDF；此步骤不调用付费模型'],
      );
    if (error instanceof AiError) throw error;
    throw webFailure(
      'WEB_NETWORK',
      '网页连接或读取失败，尚未调用模型。',
      ['网络、DNS、TLS连接异常或网站中途关闭连接'],
      [
        '检查网站是否可访问，稍后手动重试或复制正文；不要关闭证书验证',
        '这不是供应商模型错误；不会自动重试或发送简历',
      ],
    );
  }
}

/** Web-only diagnostics; never suggest changing provider credentials or expose raw exceptions. */
export function webReadDiagnostic(error: unknown): AiDiagnostic {
  if (error instanceof AiError && error.diagnostic?.code.startsWith('WEB_'))
    return error.diagnostic;
  return {
    code: 'WEB_READ_FAILED',
    message: error instanceof AiError ? error.message : '网页读取失败，未改变已导入资料。',
    possibleCauses: ['网页地址、访问策略或静态读取结果不符合要求；此步骤尚未调用模型'],
    solutions: [
      '核对公开 HTTPS 地址；不要提供密码、Cookie或令牌，不绕过内网/重定向保护',
      '可手动粘贴正文或导入截图/PDF；不会自动重试，也不需要更改供应商配置',
    ],
  };
}
