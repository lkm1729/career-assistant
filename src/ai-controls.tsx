import { versionLabel } from '../shared/version-display';
import { BulkHistory } from './BulkHistory';
import { referenceLabels } from '../shared/reference-display';
import { AdviceText } from './Advice';
import { jobReviewSources } from '../shared/job-review';
import { JobSourceReview } from './JobSourceReview';
import { MaterialSendPreview } from './Materials';
import { DiagnosticPanel } from './DiagnosticPanel';
import { protocolLabel } from '../shared/ai';
import { ConfirmationIntro, ConnectionDetails, Disclosure } from './RunInfo';
import { useEffect, useState } from 'react';
import { ShieldCheck, LoaderCircle, Square } from 'lucide-react';
import type { ResumeVersion } from '../shared/ai';
import { useAi } from './useAi';
import { Modal } from './Modal';
export function GenerationConfirmation() {
  const ai = useAi();
  const connection = ai.confirmationConnection;
  if (!ai.confirmation) return null;
  return (
    <Modal title="确认本次发送内容" onClose={() => ai.setConfirmation(null)}>
      <ConfirmationIntro
        operation={
          ai.confirmation.operation === 'refine'
            ? '调整当前正文'
            : ai.confirmation.page === 'letter'
              ? '撰写求职信'
              : '设计简历'
        }
        connection={connection}
        materials={ai.confirmationMaterials}
        input={{
          ...ai.confirmation.input,
          ...(ai.confirmation.operation === 'refine'
            ? { refinement: ai.confirmation.refinement ?? '' }
            : {}),
        }}
      />
      <p className="field-hint">成功后保存新版本；取消或失败不覆盖旧内容。</p>
      {ai.confirmation.page === 'letter' && (
        <>
          <p>请核对岗位资料属于同一目标职位，冲突时返回取消相应资料。简历及经历只来自本页。</p>
        </>
      )}
      {ai.confirmation.page === 'letter' && (
        <JobSourceReview
          sources={jobReviewSources(ai.confirmationMaterials, ai.confirmation.input.prompt)}
          confirmed={ai.confirmation.sameJobConfirmed === true}
          onChange={(sameJobConfirmed) =>
            ai.setConfirmation({ ...ai.confirmation!, sameJobConfirmed })
          }
        />
      )}
      <Disclosure title="查看本次发送内容">
        {ai.confirmation.operation === 'refine' && (
          <details className="send-preview">
            <summary>本次修改要求 · {ai.confirmation.refinement?.length ?? 0} 字符</summary>
            <pre>{ai.confirmation.refinement}</pre>
          </details>
        )}
        <MaterialSendPreview manifest={ai.confirmationMaterials} />
        {Object.entries(ai.confirmation.input).map(([key, value]) => (
          <details key={key} className="send-preview">
            <summary>
              {key === 'prompt'
                ? '本次要求与经历'
                : key === 'systemPrompt'
                  ? '系统提示词'
                  : key === 'resumeText'
                    ? '本页简历文字'
                    : key === 'evidenceText'
                      ? '补充材料文字'
                      : '当前正文'}{' '}
              · {value.length} 字符
            </summary>
            <pre>{value || '（空，不包含现有正文）'}</pre>
          </details>
        ))}
      </Disclosure>
      <ConnectionDetails connection={connection}>
        <p className="confirmation-warning">
          程序会补充输出格式约束：正文、排版建议、设计说明。成功后创建新版本并更新工作区；当前输入正文会保存在版本的输入快照中。取消或失败不覆盖旧内容。
        </p>
      </ConnectionDetails>
      <div className="modal-footer">
        <button className="secondary" onClick={() => ai.setConfirmation(null)}>
          返回修改
        </button>
        <button
          className="primary"
          disabled={
            ai.confirmation.page === 'letter' &&
            jobReviewSources(ai.confirmationMaterials, ai.confirmation.input.prompt).length > 1 &&
            ai.confirmation.sameJobConfirmed !== true
          }
          onClick={() => void ai.generate()}
        >
          {ai.confirmation.operation === 'refine' ? '确认发送并调整' : '确认发送并生成'}
        </button>
      </div>
    </Modal>
  );
}
export function GenerationStatus() {
  const ai = useAi();
  if (!ai.pageBusy && !ai.message) return null;
  if (ai.diagnostic)
    return (
      <section className="generation-status" aria-label={`${ai.documentLabel}生成状态`}>
        <DiagnosticPanel diagnostic={ai.diagnostic} />
      </section>
    );
  return (
    <section
      className="card generation-status"
      aria-label={`${ai.documentLabel}生成状态`}
      aria-live="off"
      aria-busy={ai.pageBusy}
    >
      <div className="section-title">
        {ai.pageBusy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
        <h3 className={ai.pageBusy ? 'ai-thinking' : undefined}>
          {ai.cancelling && ai.pageBusy
            ? '正在请求停止生成…'
            : ai.preparing
              ? '正在保存草稿并准备发送确认…'
              : ai.restoring
                ? `正在回滚${ai.documentLabel}版本，请稍候`
                : ai.generating
                  ? `正在起草${ai.documentLabel}，原有内容暂时锁定`
                  : ai.pageBusy
                    ? '正在保存本地操作，请稍候…'
                    : ai.message}
        </h3>
        {ai.generating && (
          <button className="secondary" disabled={ai.cancelling} onClick={() => void ai.cancel()}>
            <Square size={13} />
            取消生成
          </button>
        )}
      </div>
      {ai.generating && (
        <>
          <p>流式内容尚未校验，不是正式版本；结束后会分成正文、建议与说明。</p>
          <details className="stream-details">
            <summary>查看未校验的原始流内容</summary>
            <pre className="stream-preview">{ai.stream || '正在等待供应商响应…'}</pre>
          </details>
        </>
      )}
    </section>
  );
}
export function VersionHistory({ onEdit }: { onEdit: () => void }) {
  const ai = useAi();
  const [tab, setTab] = useState<'versions' | 'trash' | 'drafts'>('versions');
  const [selectedNumber, setSelectedNumber] = useState<number | null>(ai.currentVersionNumber);
  const [checked, setChecked] = useState<number[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const selected = ai.versions.find((v) => v.number === selectedNumber);
  const records = tab === 'trash' ? ai.deletedVersions : ai.versions;
  const eligible = records.filter((v) => tab === 'trash' || v.number !== ai.currentVersionNumber);
  const items = eligible.filter((v) => checked.includes(v.number));
  const checkpoint = ai.checkpoints.find((item) => item.id === checkpointId);
  useEffect(() => () => ai.setRestoreConfirmation(null), []);
  function toggle(number: number) {
    setChecked((values) =>
      values.includes(number) ? values.filter((v) => v !== number) : [...values, number],
    );
    setConfirmDelete(false);
  }
  return (
    <div className="version-history">
      <div className="history-tabs" role="group" aria-label="历史分类">
        {(
          [
            ['versions', '正文版本'],
            ['trash', '回收站'],
            ['drafts', '切换前草稿'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className="secondary"
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setChecked([]);
              setConfirmDelete(false);
            }}
          >
            {label} (
            {value === 'versions'
              ? ai.versions.length
              : value === 'trash'
                ? ai.deletedVersions.length
                : ai.checkpoints.length}
            )
          </button>
        ))}
      </div>
      {ai.diagnostic && <DiagnosticPanel diagnostic={ai.diagnostic} />}
      {!ai.diagnostic && ai.message && <p role="status">{ai.message}</p>}
      {tab === 'versions' && (
        <>
          <div className="registry-batch">
            <label>
              <input
                type="checkbox"
                aria-label="全选可操作版本"
                disabled={ai.busy || !eligible.length}
                checked={!!eligible.length && items.length === eligible.length}
                onChange={(event) => {
                  setChecked(event.target.checked ? eligible.map((v) => v.number) : []);
                  setConfirmDelete(false);
                }}
              />
              全选{'旧版本（排除当前版本）'}
            </label>
            <button
              className="secondary"
              disabled={ai.busy || !items.length}
              onClick={() => setConfirmDelete(true)}
            >
              删除所选版本 ({items.length})
            </button>
          </div>
          <div className="version-list">
            {records.map((version) => (
              <div className="version-row" key={version.runId}>
                <input
                  type="checkbox"
                  aria-label={`选择版本 ${versionLabel(ai.versions, version.number)}`}
                  checked={checked.includes(version.number)}
                  disabled={
                    ai.busy || (tab === 'versions' && version.number === ai.currentVersionNumber)
                  }
                  onChange={() => toggle(version.number)}
                />
                <button
                  className="secondary"
                  aria-pressed={selectedNumber === version.number}
                  disabled={ai.busy}
                  onClick={() => {
                    setSelectedNumber(version.number);
                    ai.setRestoreConfirmation(null);
                  }}
                >
                  <strong>
                    {versionLabel(ai.versions, version.number)}
                    {ai.currentVersionNumber === version.number ? ' · 当前工作版本' : ''}
                  </strong>
                  <span>
                    {new Date(version.createdAt).toLocaleString('zh-CN')} ·{' '}
                    {version.operation === 'refine'
                      ? '调整'
                      : version.operation === 'restore'
                        ? '旧版恢复记录'
                        : '生成'}
                  </span>
                </button>
              </div>
            ))}
          </div>
          {!records.length && <p>这里还没有正式版本。</p>}
          {confirmDelete && (
            <section className="inline-action-confirm" aria-label="确认删除旧版本">
              <h4>
                确认将 {items.map((v) => `${versionLabel(ai.versions, v.number)}`).join('、')}{' '}
                移入回收站？
              </h4>
              <p>
                不会删除当前工作版本、草稿或其他标签页内容。此操作可在回收站撤销；显示编号将按现存记录重新连续排列，内部来源关联不变。
              </p>
              <button
                className="primary"
                disabled={ai.busy || !items.length}
                onClick={() =>
                  void ai.deleteVersions(items).then((ok) => {
                    if (ok) {
                      setChecked([]);
                      setSelectedNumber(null);
                      setConfirmDelete(false);
                    }
                  })
                }
              >
                确认移入回收站
              </button>
              <button
                className="text-button"
                disabled={ai.busy}
                onClick={() => setConfirmDelete(false)}
              >
                取消删除
              </button>
            </section>
          )}
        </>
      )}
      {tab === 'trash' && (
        <BulkHistory
          items={ai.deletedVersions}
          identity={(v) => v.runId}
          label="回收站版本"
          disabled={ai.busy || !!ai.testing}
          impact="仅删除所选回收站正文版本，不改当前正文、草稿备份、资料或其他页面。其他备份可能仍保留相同文字；永久删除不是安全擦除。"
          remove={(items) => ai.purgeVersions(items)}
          recover={(items) => ai.recoverVersions(items)}
          render={(v) => (
            <div className="history-item-label">
              <strong>{versionLabel(ai.versions, v.number)}</strong>
              <span>{new Date(v.createdAt).toLocaleString('zh-CN')}</span>
            </div>
          )}
        />
      )}
      {tab === 'versions' && selected && (
        <div className="version-detail">
          <h3>
            {versionLabel(ai.versions, selected.number)} ·{' '}
            {ai.currentVersionNumber === selected.number ? '当前工作版本' : '历史版本'}
          </h3>
          <p>
            {protocolLabel(selected.connection.protocol)} · {selected.connection.modelName}
          </p>
          <p className="version-lineage">
            {selected.parentNumber
              ? `前一正式版本 ${versionLabel(ai.versions, selected.parentNumber)}`
              : '基于本地草稿'}
          </p>
          <AdviceText
            text={selected.document}
            listFallback={false}
            labels={referenceLabels(selected.materials)}
          />
          <details>
            <summary>原始正文（含技术编号）</summary>
            <pre>{selected.document}</pre>
          </details>
          <div className="history-actions">
            <button
              className="primary"
              disabled={ai.busy}
              onClick={() =>
                void ai.switchVersion(selected.number).then((ok) => {
                  if (ok) onEdit();
                })
              }
            >
              切换到 {versionLabel(ai.versions, selected.number)} 并编辑
            </button>
            <button
              className="secondary"
              disabled={ai.busy}
              onClick={() => void ai.prepareRestore(selected.number)}
            >
              回滚到 {versionLabel(ai.versions, selected.number)}
            </button>
          </div>
          <p>
            切换和回滚都不会生成 V4/V5 等新编号。切换前的草稿会自动备份；只有再次生成或 AI
            调整成功才创建新版本。
          </p>
          {ai.restoreConfirmation?.number === selected.number && (
            <section className="restore-confirmation" aria-label="确认回滚版本">
              <h4>确认回滚到 {versionLabel(ai.versions, selected.number)}？</h4>
              <p>
                仅在本机替换正文并清空待处理修改要求，不调用
                AI。保留基础资料、系统提示词、模型配置和全部版本；回滚前草稿可在“切换前草稿”恢复。
              </p>
              <details>
                <summary>回滚前正文（将保留草稿备份）</summary>
                <pre>{ai.restoreConfirmation.expectedDraft.document || '（空）'}</pre>
              </details>
              <button
                className="primary"
                disabled={ai.busy}
                onClick={() => void ai.restoreVersion()}
              >
                确认回滚，不创建新版本
              </button>
              <button
                className="text-button"
                disabled={ai.busy}
                onClick={() => ai.setRestoreConfirmation(null)}
              >
                取消回滚
              </button>
            </section>
          )}
          <details>
            <summary>查看本次输入快照（含生成前正文）</summary>
            <h4>建议</h4>
            <AdviceText text={selected.suggestions} labels={referenceLabels(selected.materials)} />
            <h4>设计说明</h4>
            <AdviceText text={selected.rationale} labels={referenceLabels(selected.materials)} />
            <h4>基础资料与要求</h4>
            <pre>{selected.input.prompt}</pre>
            <h4>系统提示词</h4>
            <pre>{selected.input.systemPrompt}</pre>
            <h4>生成前正文</h4>
            <pre>{selected.input.document || '（空）'}</pre>
            <h4>修改要求</h4>
            <pre>{selected.refinement || '（无）'}</pre>
          </details>
        </div>
      )}
      {tab === 'drafts' && (
        <>
          <p>
            这里是切换、回滚或清空前的备份，不是当前工作区草稿。删除备份不清空当前正文；其他版本和即时撤销可能仍保留相同文字。
          </p>
          <BulkHistory
            items={ai.checkpoints}
            identity={(item) => item.id}
            label="草稿备份"
            disabled={ai.busy || !!ai.testing}
            impact="不删除当前正文、正式版本、回收站、原始资料或其他标签页内容。"
            remove={(items) => ai.deleteDrafts(items.map((item) => item.id))}
            render={(item) => (
              <button
                className="secondary checkpoint-row"
                disabled={ai.busy || !!ai.testing}
                onClick={() => setCheckpointId(item.id)}
              >
                {new Date(item.createdAt).toLocaleString('zh-CN')} ·{' '}
                {item.draft.currentVersionNumber
                  ? `基于 ${versionLabel(ai.versions, item.draft.currentVersionNumber)}`
                  : '本地草稿'}{' '}
                · {item.draft.document.length} 字
              </button>
            )}
          />
          {checkpoint && (
            <section className="inline-action-confirm" aria-label="恢复草稿备份">
              <h4>恢复这份草稿备份？</h4>
              <pre>{checkpoint.draft.document || '（空正文）'}</pre>
              <p>将恢复当时的正文、输入资料、系统提示词和修改要求；不影响供应商或模型设置。</p>
              <button
                className="primary"
                disabled={ai.busy}
                onClick={() =>
                  void ai.recoverDraft(checkpoint.id).then((ok) => {
                    if (ok) setCheckpointId(null);
                  })
                }
              >
                确认恢复草稿备份
              </button>
              <button className="text-button" onClick={() => setCheckpointId(null)}>
                取消
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
export function GeneratedAdvice() {
  const ai = useAi();
  const latest = ai.versions.find(
    (version) =>
      version.number === ai.currentVersionNumber && version.document === ai.currentDocument,
  );
  const labels = referenceLabels(latest?.materials);
  return (
    <div className="advice-row generated-advice">
      <div>
        <span className="small-label">
          排版与美化建议{latest ? ` · ${versionLabel(ai.versions, latest.number)}` : ''}
        </span>
        <AdviceText
          labels={labels}
          text={
            latest?.suggestions ??
            '当前为本地草稿，尚无对应的正式版本建议。生成或恢复后将在此展示。'
          }
        />
      </div>
      <div>
        <span className="small-label">
          设计说明{latest ? ` · ${versionLabel(ai.versions, latest.number)}` : ''}
        </span>
        <AdviceText
          labels={labels}
          text={
            latest?.rationale ?? '当前草稿不沿用旧版本的设计说明；旧版建议和说明可在本页记录查看。'
          }
        />
      </div>
    </div>
  );
}
