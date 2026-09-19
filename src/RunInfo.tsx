import { useState, type ReactNode } from 'react';
import { protocolLabel, type ConnectionInfo } from '../shared/ai';
import type { MaterialManifest } from '../shared/materials';
import { wireParameters } from '../shared/models';
import { localRecordTime, sendSummary } from '../shared/run-display';

/** Never resolve a historic or running snapshot against today's catalog. */
export function ConnectionBadge({
  connection,
  label = '下次使用',
}: {
  connection: ConnectionInfo | null | undefined;
  label?: string;
}) {
  return (
    <div className="connection-badge" aria-label={label}>
      <span className="connection-label">{label}</span>
      {connection ? (
        <>
          <strong>
            {connection.providerName || '供应商未记录'} /{' '}
            {connection.modelName || connection.modelId || '模型未记录'}
          </strong>
          <span>
            {protocolLabel(connection.protocol) || '协议未记录'}
            {!connection.hasKey && label === '下次使用' ? ' · 尚未配置密钥' : ''}
          </span>
        </>
      ) : (
        <span>
          {label === '下次使用'
            ? '尚未选择模型，请在本页选择供应商与模型。'
            : '此记录未保存连接信息'}
        </span>
      )}
    </div>
  );
}
export function HistoricalRunInfo({
  record,
}: {
  record: { createdAt?: string; connection?: ConnectionInfo | null };
}) {
  const time = localRecordTime(record.createdAt);
  return (
    <footer role="group" className="historical-run-info" aria-label="当次评估信息">
      <span>
        评估记录时间（本地）· <time dateTime={time.iso}>{time.label}</time>
      </span>
      <span>
        当次供应商 / 模型 · {record.connection?.providerName || '未记录'} /{' '}
        {record.connection?.modelName || record.connection?.modelId || '未记录'}
      </span>
    </footer>
  );
}
/** Unopened previews do not mount large text/image subtrees. Consent lives outside. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="confirmation-details"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && <div className="confirmation-details-body">{children}</div>}
    </details>
  );
}
export function ConfirmationIntro({
  operation,
  connection,
  materials,
  input,
}: {
  operation: string;
  connection: ConnectionInfo | null;
  materials: MaterialManifest | null;
  input: Record<string, string>;
}) {
  const summary = sendSummary(input, materials);
  return (
    <section className="confirmation-intro" aria-label="本次发送摘要">
      <p className="confirmation-operation">{operation}</p>
      <ConnectionBadge connection={connection} label="本次发送给" />
      <p className="confirmation-counts">
        本页文字 {summary.inputCharacters.toLocaleString()} 字符 · 所选资料 {summary.materials} 项 ·
        页面图像 {summary.images} 张
      </p>
      <p className="field-hint">
        资料文字另计 {summary.materialCharacters.toLocaleString()}{' '}
        字符；程序还会附加任务与格式要求。不是计费字数。
      </p>
      <p className="confirmation-warning">
        确认后联网发送上述本页内容，使用你的密钥，可能产生费用。不会发送其他页面或未选资料；供应商可能保留日志。可展开下方预览核对。
      </p>
    </section>
  );
}
export function ConnectionDetails({
  connection,
  children,
}: {
  connection: ConnectionInfo | null;
  children?: ReactNode;
}) {
  return (
    <Disclosure title="连接、参数与处理说明">
      <p>
        请求地址：<code>{connection?.endpoint || '未配置'}</code>
      </p>
      <p>
        模型接口 ID：<code>{connection?.modelId || '未配置'}</code>
      </p>
      <p>本次启用参数（未列出的参数不发送）：</p>
      <pre>{JSON.stringify(connection?.parameters ?? {}, null, 2)}</pre>
      {connection && (
        <>
          <p>接口实际参数：</p>
          <pre>
            {JSON.stringify(
              wireParameters(connection.parameters ?? {}, connection.protocol),
              null,
              2,
            )}
          </pre>
        </>
      )}
      {connection?.protocol === 'responses' && (
        <p>
          store: false。不启用工具、不发送服务端会话
          ID；仅本机管理版本。不代表第三方供应商绝不保留日志。
        </p>
      )}
      {(connection?.protocol === 'anthropic' || connection?.protocol === 'gemini') && (
        <p>
          仅发送本次确认的消息，不启用工具、后台任务或远程会话链。
          {connection.protocol === 'anthropic'
            ? 'Messages 必填 max_tokens，未覆盖时为 4096。'
            : '参数位于 generationConfig；模型 ID 位于请求路径。'}
        </p>
      )}
      {children}
    </Disclosure>
  );
}
