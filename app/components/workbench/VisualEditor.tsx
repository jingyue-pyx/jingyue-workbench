import { useEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { streamingState } from '~/lib/stores/streaming';
import type { VisualChange } from '~/lib/visual/source';
import { projectPersistence } from '~/lib/stores/project-persistence';

type Selection = {
  oid: string;
  file: string;
  source: string;
  text: string;
  classes: string;
  textEditable: boolean;
  classesEditable: boolean;
};

export function VisualEditor({ iframeRef, url }: { iframeRef: RefObject<HTMLIFrameElement>; url?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Selection>();
  const [text, setText] = useState('');
  const [classes, setClasses] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [status, setStatus] = useState('开启后，点击预览中的 React 元素进行编辑。');
  const streaming = useStore(streamingState);
  const persistence = useStore(projectPersistence);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const selectionVersion = useRef(0);

  useEffect(() => {
    setSelection(undefined);
    selectionVersion.current++;
    const origin = url ? new URL(url).origin : undefined;
    if (!origin) return;

    async function receive(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== origin) return;
      if (event.data?.type === 'jingyue:preview-ready') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'jingyue:visual-mode', enabled: enabledRef.current },
          origin!,
        );
        return;
      }
      if (!enabledRef.current || event.data?.type !== 'jingyue:element') return;
      if (streamingState.get()) return;
      const { file, oid } = event.data;
      if (typeof file !== 'string' || typeof oid !== 'string' || file.length > 1024 || oid.length > 100) return;
      const version = ++selectionVersion.current;
      try {
        const entry = workbenchStore.files.get()[file];
        if (entry?.type !== 'file' || entry.isBinary || entry.isLocked) throw new Error('该文件不可编辑。');
        if (workbenchStore.unsavedFiles.get().has(file)) throw new Error('请先保存代码编辑器中的修改。');
        const { inspectSource } = await import('~/lib/visual/source');
        const details = inspectSource(entry.content, oid);
        if (version !== selectionVersion.current || streamingState.get() || !enabledRef.current) return;
        setSelection({ file, oid, source: entry.content, ...details });
        setText(details.text);
        setClasses(details.classes);
        setStatus('已选中元素，保存将修改项目源文件。');
      } catch (error) {
        setSelection(undefined);
        setStatus(error instanceof Error ? error.message : '选择失败');
      }
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [url, iframeRef]);

  useEffect(() => {
    if (streaming) {
      setSelection(undefined);
      selectionVersion.current++;
    }
  }, [streaming]);

  async function toggle() {
    if (!url || streaming || busy) return;
    setBusy(true);
    try {
      if (!enabled) {
        const { instrumentSource } = await import('~/lib/visual/source');
        if (streamingState.get()) throw new Error('正在生成代码，请稍后开启直接编辑。');
        const sources = Object.entries(workbenchStore.files.get()).filter(
          ([file, value]) =>
            /\.[jt]sx?$/.test(file) && !file.includes('/node_modules/') && value?.type === 'file' && !value.isBinary,
        );
        const previousFile = workbenchStore.selectedFile.get();
        let count = 0;
        try {
          for (const [file, entry] of sources) {
            if (streamingState.get()) throw new Error('生成已开始，请在完成后重新开启直接编辑。');
            if (entry?.type !== 'file' || entry.isLocked || workbenchStore.unsavedFiles.get().has(file)) continue;
            const current = workbenchStore.files.get()[file];
            if (current?.type !== 'file' || current.content !== entry.content) continue;
            let source: string;
            try {
              source = instrumentSource(entry.content, file);
            } catch {
              continue;
            }
            if (source === entry.content) continue;
            workbenchStore.setSelectedFile(file);
            if (!workbenchStore.currentDocument.get()) continue;
            workbenchStore.setCurrentDocumentContent(source);
            await workbenchStore.saveFile(file);
            count++;
          }
        } finally {
          workbenchStore.setSelectedFile(previousFile);
        }
        setStatus(`编辑模式已开启，已处理 ${count} 个源文件。点击右侧元素，修改文本或样式。`);
      } else {
        setStatus('已退出直接编辑，可以正常操作页面。');
        setSelection(undefined);
      }
      setEnabled(!enabled);
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'jingyue:visual-mode', enabled: !enabled },
        new URL(url).origin,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '开启失败');
    } finally {
      setBusy(false);
    }
  }

  async function apply(change: VisualChange) {
    if (!selection || busy || streaming) return;
    setBusy(true);
    try {
      const { editSource, inspectSource } = await import('~/lib/visual/source');
      if (streamingState.get()) throw new Error('正在生成代码，请完成后重新选择元素。');
      const entry = workbenchStore.files.get()[selection.file];
      if (
        entry?.type !== 'file' ||
        entry.isLocked ||
        entry.content !== selection.source ||
        workbenchStore.unsavedFiles.get().has(selection.file)
      ) {
        throw new Error('源码已被修改，请在预览中重新选择元素后再保存。');
      }
      const updated = editSource(entry.content, selection.oid, change);
      workbenchStore.setSelectedFile(selection.file);
      if (!workbenchStore.currentDocument.get()) throw new Error('代码编辑器尚未就绪，请稍后重试。');
      workbenchStore.setCurrentDocumentContent(updated);
      await workbenchStore.saveFile(selection.file);
      setSelection({ ...selection, source: updated, ...inspectSource(updated, selection.oid) });
      setStatus('已保存到源文件和本机项目快照，刷新可恢复；下一轮对话会带上这次修改。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  const buttonClass = 'px-3 py-1 rounded border border-bolt-elements-borderColor text-sm disabled:opacity-50';
  const inputClass =
    'min-w-0 flex-1 rounded p-1 bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor';
  return (
    <div className="p-3 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary space-y-2">
      <div className="flex items-center gap-3">
        <button className={buttonClass} onClick={toggle} disabled={!url || busy || streaming}>
          {busy ? '处理中…' : enabled ? '退出直接编辑' : '直接编辑'}
        </button>
        <span className="text-xs opacity-70">Onlook 源码编辑 · 与对话共用项目文件</span>
      </div>
      <p role="status" className="text-xs">
        {streaming ? '正在生成代码，完成后可继续直接编辑。' : status}
      </p>
      <p role="status" className="text-xs opacity-70">
        {persistence === 'saved'
          ? '云端已保存（不含未保存的代码）'
          : persistence === 'saving'
            ? '正在保存项目，请勿关闭页面…'
            : persistence === 'error'
              ? '项目快照保存失败，请重试保存或导出源码。'
              : persistence === 'local'
                ? '仅本机保存；请查看页面顶部的云同步状态。'
                : persistence === 'conflict' || persistence === 'deleted'
                  ? '云端版本冲突或项目已删除；请在页面顶部处理。'
                  : '生成完成后保存项目快照。'}
      </p>
      {enabled && selection && !streaming && (
        <div className="space-y-2 text-sm">
          <p className="text-xs truncate">{selection.file}</p>
          <label className="flex gap-2 items-center">
            文字
            <input
              aria-label="元素文字"
              className={inputClass}
              value={text}
              disabled={!selection.textEditable}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className={buttonClass}
              disabled={busy || !selection.textEditable}
              onClick={() => apply({ kind: 'text', value: text })}
            >
              保存文字
            </button>
          </label>
          {!selection.textEditable && <p className="text-xs opacity-70">动态或嵌套内容请通过对话或代码编辑。</p>}
          <label className="flex gap-2 items-center">
            样式类
            <input
              aria-label="元素样式类"
              className={inputClass}
              value={classes}
              disabled={!selection.classesEditable}
              onChange={(e) => setClasses(e.target.value)}
            />
            <button
              className={buttonClass}
              disabled={busy || !selection.classesEditable}
              onClick={() => apply({ kind: 'classes', value: classes })}
            >
              保存样式
            </button>
          </label>
          <div className="flex items-center gap-2">
            <input aria-label="文字颜色" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => apply({ kind: 'style', property: 'color', value: color })}
            >
              应用文字颜色
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                workbenchStore.setSelectedFile(selection.file);
                workbenchStore.currentView.set('code');
              }}
            >
              打开源码
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
