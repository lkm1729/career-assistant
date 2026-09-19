import { request } from 'node:https';
import { isIP } from 'node:net';
import { AiError } from '../shared/ai';

function dnsFailure() {
  return new AiError('公共 DNS 未返回可验证的地址；未连接目标网站。', {
    code: 'WEB_PUBLIC_DNS_FAILED',
    message: '公共 DNS 查询失败或结果无效，未连接目标网站。',
    possibleCauses: ['公共 DNS 不可达、响应无效或域名没有可用 IPv4 地址'],
    solutions: [
      '检查网络或将代理切换为真实 DNS 解析后手动重试；不放行保留地址',
      '也可粘贴岗位正文或导入 PDF，不需要更改模型设置',
    ],
  });
}
const canonical = (name: string) => name.toLowerCase().replace(/\.$/, '');
/** A bounded, exact-question CNAME chain. Ignore unrelated records, never follow remote URLs. */
export function publicDnsAnswers(raw: unknown, host: string): string[] {
  if (!raw || typeof raw !== 'object') throw dnsFailure();
  const data = raw as Record<string, unknown>;
  const questions = data.Question;
  if (
    data.Status !== 0 ||
    data.TC !== false ||
    !Array.isArray(questions) ||
    questions.length !== 1 ||
    !Array.isArray(data.Answer) ||
    data.Answer.length > 64
  )
    throw dnsFailure();
  const question = questions[0];
  if (
    !question ||
    question.type !== 1 ||
    typeof question.name !== 'string' ||
    canonical(question.name) !== canonical(host)
  )
    throw dnsFailure();
  let name = canonical(host);
  const seen = new Set<string>();
  for (let hop = 0; hop <= 8; hop++) {
    if (seen.has(name)) throw dnsFailure();
    seen.add(name);
    const records = data.Answer.filter(
      (r) => r && typeof r === 'object' && typeof r.name === 'string' && canonical(r.name) === name,
    );
    const addresses = records.filter((r) => r.type === 1);
    const aliases = records.filter((r) => r.type === 5);
    if (addresses.length) {
      if (aliases.length || addresses.some((r) => typeof r.data !== 'string' || isIP(r.data) !== 4))
        throw dnsFailure();
      return [...new Set(addresses.map((r) => r.data as string))];
    }
    if (
      aliases.length !== 1 ||
      typeof aliases[0].data !== 'string' ||
      !/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+\.?$/.test(aliases[0].data) ||
      aliases[0].data.length > 254
    )
      throw dnsFailure();
    name = canonical(aliases[0].data);
  }
  throw dnsFailure();
}

/** Only invoked after per-import consent. Fixed IP + TLS name avoid the synthetic system DNS. */
export function resolvePublicWebHost(host: string, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (host.length > 253 || !/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(host)) {
      reject(dnsFailure());
      return;
    }
    const req = request(
      {
        hostname: '1.1.1.1',
        port: 443,
        servername: 'cloudflare-dns.com',
        path: '/dns-query?' + new URLSearchParams({ name: host, type: 'A' }),
        method: 'GET',
        agent: false,
        signal,
        headers: {
          Host: 'cloudflare-dns.com',
          Accept: 'application/dns-json',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        const type = String(res.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (
          res.statusCode !== 200 ||
          !['application/dns-json', 'application/json'].includes(type) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
        ) {
          res.destroy();
          reject(dnsFailure());
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 32768) res.destroy(dnsFailure());
          else chunks.push(chunk);
        });
        res.on('error', () => reject(dnsFailure()));
        res.on('aborted', () => reject(dnsFailure()));
        res.on('end', () => {
          try {
            resolve(
              publicDnsAnswers(
                JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
                host,
              ),
            );
          } catch {
            reject(dnsFailure());
          }
        });
      },
    );
    req.on('error', () => reject(dnsFailure()));
    req.end();
  });
}
