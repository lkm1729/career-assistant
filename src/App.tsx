import { useInterview } from './useInterview';
import { InterviewPanel, InterviewConfirmationDialog, InterviewHistory } from './InterviewPanel';
import { ClearResultControl } from './ClearResultControl';
import { appVersion } from '../shared/version';
import { useScore } from './useScore';
import { ScorePanel, ScoreConfirmationDialog } from './ScorePanel';
import { useMatch } from './useMatch';
import { MatchPanel, MatchConfirmation } from './MatchPanel';
import { AiContext, useAiState } from './useAi';
import { GenerationConfirmation, GenerationStatus } from './ai-controls';
import { useEffect, useState } from 'react';
import {
  BriefcaseBusiness,
  ArrowUpRight,
  Settings2,
  History as HistoryIcon,
  ShieldCheck,
  CircleCheck,
  LoaderCircle,
  AlertCircle,
  ChevronRight,
  Leaf,
  PanelLeft,
} from 'lucide-react';
import { workspaceIds, type WorkspaceId } from '../shared/contracts';
import { pages } from './content';
import { useWorkspace } from './useWorkspace';
import { ThemePicker, Settings, History } from './controls';
import { HeroArt, InputPanel, WritingPanel, EvaluationPanel } from './panels';

export function App() {
  const {
    snapshot,
    loadError,
    saving,
    saveError,
    load,
    updateDraft,
    updatePreferences,
    retrySave,
    flush,
    refreshResume,
  } = useWorkspace();
  const ai = useAiState(snapshot, flush, refreshResume);
  const score = useScore(flush, ai, snapshot?.preferences.activeTab === 'score');
  const match = useMatch(flush, ai, snapshot?.preferences.activeTab === 'match');
  const interview = useInterview(flush, ai);
  const [resultChanging, setResultChanging] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'history' | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [editRequests, setEditRequests] = useState({ resume: 0, letter: 0 });
  const theme = snapshot?.preferences.theme ?? 'system';
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (query.matches ? 'dark' : 'light') : theme;
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);
  if (!snapshot)
    return (
      <main className="startup">
        <div className="brand-mark">
          <BriefcaseBusiness size={28} />
        </div>
        <h1>Career Assistant</h1>
        {loadError ? (
          <>
            <p role="alert">无法读取本地草稿。为保护已有资料，应用不会自动重置数据库。</p>
            <p>
              {window.career
                ? '请检查本地目录权限，或保留数据后重试。'
                : '请通过 npm run dev 启动 Electron 桌面版；浏览器预览不提供本地存储服务。'}
            </p>
            <button className="primary" onClick={() => void load()}>
              重试读取
            </button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={16} /> 正在打开你的本地工作区…
          </p>
        )}
      </main>
    );
  const id = snapshot.preferences.activeTab;
  const page = pages[id];
  const draft = snapshot.workspaces[id];
  function navigate(next: WorkspaceId) {
    if (resultChanging) return;
    updatePreferences({ activeTab: next });
  }
  return (
    <AiContext.Provider value={ai}>
      <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <a href="#main-content" className="skip-link">
          跳转到工作区
        </a>
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">
              <BriefcaseBusiness size={23} strokeWidth={1.8} />
            </div>
            <div className="brand-text">
              <strong>
                Career<span>Assistant</span>
              </strong>
              <span>每一步，都更靠近。</span>
            </div>
          </div>
          <div className="nav-label">你的求职工具</div>
          <nav aria-label="求职工具">
            {workspaceIds.map((tab) => {
              const item = pages[tab];
              const Icon = item.icon;
              return (
                <button
                  key={tab}
                  className={`nav-item ${id === tab ? 'active' : ''}`}
                  aria-current={id === tab ? 'page' : undefined}
                  aria-label={item.name}
                  title={item.name}
                  onClick={() => navigate(tab)}
                >
                  <Icon size={20} strokeWidth={1.7} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.english}</small>
                  </span>
                  {id === tab && <span className="active-dot" />}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-card">
              <div className="local-card-icon">
                <Leaf size={20} />
              </div>
              <h3>你的经历，由你掌握</h3>
              <p>
                五个独立空间。
                <br />
                从你需要的那一步开始。
              </p>
              <span>
                <ShieldCheck size={13} />
                独立草稿 · 发送前确认
              </span>
            </div>
            <button className="settings-link" onClick={() => setDialog('settings')}>
              <Settings2 size={19} />
              <span>应用设置</span>
              <ChevronRight size={15} />
            </button>
            <div className="sidebar-meta">
              <span>DESKTOP / {appVersion}</span>
              <span className="version-dot" />
            </div>
          </div>
        </aside>
        <div className="workspace-shell">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="icon-button sidebar-toggle"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              >
                <PanelLeft size={18} />
              </button>
              <span>工作空间</span>
              <ChevronRight size={14} />
              <strong>{page.name}</strong>
            </div>
            <div className="topbar-actions">
              <div
                className={`save-state ${saveError ? 'error' : ''}`}
                role="status"
                aria-live="polite"
              >
                {saveError ? (
                  <AlertCircle size={14} />
                ) : saving ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <CircleCheck size={14} />
                )}
                <span>{saveError ? '保存失败' : saving ? '正在保存' : '草稿已同步到本机'}</span>
              </div>
              <ThemePicker theme={theme} onChange={(next) => updatePreferences({ theme: next })} />
              <div className="avatar" aria-label="本地工作区">
                我
              </div>
            </div>
          </header>
          <main id="main-content" className="main-content">
            <div className="page-heading">
              <div className="page-eyebrow">
                <span className="eyebrow-dot" />
                {page.eyebrow}
              </div>
              <button className="history-button" onClick={() => setDialog('history')}>
                <HistoryIcon size={16} />
                本页记录
                <ArrowUpRight size={14} />
              </button>
            </div>
            <section className="hero">
              <div>
                <h1>
                  {page.title}
                  <br />
                  <span>{page.accent}</span>
                </h1>
                <p>{page.subtitle}</p>
                <div className="hero-tags">
                  <span>
                    <ShieldCheck size={13} />
                    独立工作区
                  </span>
                  <span>真实经历，清晰表达</span>
                </div>
              </div>
              <HeroArt />
            </section>
            {saveError && (
              <div className="error-banner" role="alert">
                <AlertCircle size={18} />
                <span>修改仍在窗口中，但尚未保存到磁盘。请先重试，不要直接退出。</span>
                <button className="secondary" onClick={retrySave}>
                  重试保存
                </button>
              </div>
            )}
            {(id === 'resume' || id === 'letter') && <GenerationStatus />}
            <fieldset className="workspace-fields" disabled={resultChanging}>
              <InputPanel
                key={`input-${id}`}
                id={id}
                score={score}
                match={match}
                interview={interview}
                draft={draft}
                onChange={(patch) => updateDraft(id, patch)}
                onSettings={() => setDialog('settings')}
              />
              <div
                id={`ai-result-${id}`}
                className="ai-result-anchor"
                tabIndex={-1}
                aria-label="AI 结果定位"
              >
                <ClearResultControl
                  key={`clear-${id}`}
                  page={id}
                  resultKey={
                    id === 'interview'
                      ? `${interview.current?.id ?? ''}:${interview.revision}`
                      : id === 'score'
                        ? `${score.current?.id ?? ''}:${score.historyRevision}`
                        : id === 'match'
                          ? `${match.current?.id ?? ''}:${match.historyRevision}`
                          : `${!!draft.document}:${draft.currentVersionNumber}`
                  }
                  hasResult={
                    id === 'interview'
                      ? !!interview.current
                      : id === 'score'
                        ? !!score.current
                        : id === 'match'
                          ? !!match.current
                          : !!draft.document || draft.currentVersionNumber !== null
                  }
                  disabled={ai.busy || !!ai.testing}
                  flush={flush}
                  onBusy={(busy) => {
                    setResultChanging(busy);
                    ai.setExtraBusy(busy);
                  }}
                  onHistory={() => setDialog('history')}
                  onChanged={async () => {
                    if (id === 'interview') interview.resetResultFeedback();
                    else if (id === 'score') score.resetResultFeedback();
                    else if (id === 'match') match.resetResultFeedback();
                    else ai.resetResultFeedback();
                    await refreshResume(id);
                    if (id === 'interview') await interview.refresh();
                    else if (id === 'score') await score.refresh();
                    else if (id === 'match') await match.refresh();
                    else await ai.refresh();
                  }}
                />
                {id === 'resume' || id === 'letter' ? (
                  <WritingPanel
                    key={`writing-${id}`}
                    editRequest={editRequests[id]}
                    id={id}
                    draft={draft}
                    onChange={(patch) => updateDraft(id, patch)}
                    onHistory={() => setDialog('history')}
                  />
                ) : id === 'score' || id === 'match' || id === 'interview' ? null : (
                  <EvaluationPanel key={id} id={id} />
                )}

                {id === 'score' && <ScorePanel score={score} />}
                {id === 'match' && <MatchPanel match={match} />}
                {id === 'interview' && <InterviewPanel interview={interview} />}
              </div>
            </fieldset>
            {(score.busy || match.busy) && id !== (score.busy ? 'score' : 'match') && (
              <div role="status">
                {score.busy ? '评分页正在运行' : '匹配页正在运行'}{' '}
                <button onClick={() => void (score.busy ? score.cancel() : match.cancel())}>
                  {score.busy ? '取消评分' : '取消匹配'}
                </button>
              </div>
            )}
            <footer className="page-footer">
              <span>为下一次机会，认真准备。</span>
              <span>
                Career Assistant <span className="footer-separator">/</span> 求职工具版 {appVersion}
              </span>
            </footer>
          </main>
        </div>
        {dialog === 'settings' && (
          <Settings
            theme={theme}
            onTheme={(next) => updatePreferences({ theme: next })}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'history' && (
          <History
            key={id}
            id={id}
            draft={draft}
            score={score}
            match={match}
            interview={interview}
            onClose={() => setDialog(null)}
            onEdit={() => {
              if (id === 'resume' || id === 'letter')
                setEditRequests((value) => ({ ...value, [id]: value[id] + 1 }));
              setDialog(null);
            }}
          />
        )}
        <GenerationConfirmation />
        <ScoreConfirmationDialog score={score} />
        <MatchConfirmation match={match} />
        <InterviewConfirmationDialog interview={interview} />
      </div>
    </AiContext.Provider>
  );
}
