import { useState } from 'react';
import type { Message } from 'ai';
import { Button } from '~/components/ui/Button';
import { visualDemoMessages } from '~/lib/visual/demo';

export function VisualDemoButton({
  importChat,
}: {
  importChat?: (description: string, messages: Message[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <div>
      <Button
        variant="default"
        size="lg"
        disabled={!importChat || busy}
        onClick={async () => {
          setBusy(true);
          setError('');

          try {
            await importChat?.('可运行的 React 编辑示例', visualDemoMessages());
          } catch (error) {
            setError(error instanceof Error ? error.message : '示例导入失败，请重试。');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '正在导入示例…' : '体验直接编辑（预置示例）'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
