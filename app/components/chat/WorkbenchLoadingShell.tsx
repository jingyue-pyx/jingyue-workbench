/** No stores, account data, editor or sandbox imports: render in the initial HTML. */
export function WorkbenchLoadingShell() {
  return (
    <div
      aria-label="工作台加载"
      style={{
        minHeight: '100vh',
        background: 'var(--bolt-elements-background-depth-1, #fafafa)',
        color: 'var(--bolt-elements-textPrimary, #262626)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header style={{ padding: '18px 24px', borderBottom: '1px solid var(--bolt-elements-borderColor, #e5e5e5)' }}>
        鲸月工作台
      </header>
      <main style={{ padding: '28px 24px' }} role="status" aria-live="polite">
        <p style={{ margin: '0 0 8px', fontSize: 15 }}>正在打开工作台…</p>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>先显示会话，代码与预览随后恢复。</p>
      </main>
    </div>
  );
}
