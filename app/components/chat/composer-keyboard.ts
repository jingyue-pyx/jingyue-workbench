import type { KeyboardEvent } from 'react';

/** Enter submits only an idle composer. Cancellation has its own explicit button. */
export function handleComposerKeyDown(
  event: KeyboardEvent<HTMLTextAreaElement>,
  busy: boolean,
  send?: (event: KeyboardEvent<HTMLTextAreaElement>) => void,
) {
  // Check IME before preventDefault or any action (Safari can report keyCode 229).
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.key !== 'Enter' || event.shiftKey) {
    return;
  }

  event.preventDefault();

  if (!busy && !event.repeat) {
    send?.(event);
  }
}
