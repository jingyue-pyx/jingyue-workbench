// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleComposerKeyDown } from './composer-keyboard';

afterEach(cleanup);
describe('composer keyboard does not cancel active work', () => {
  it.each([false, true])('ignores Chinese composition before any action (busy: %s)', (busy) => {
    const send = vi.fn();
    render(<textarea aria-label="需求" onKeyDown={(e) => handleComposerKeyDown(e, busy, send)} />);

    const input = screen.getByRole('textbox');
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it('ignores Enter during work and submits only idle non-repeated Enter', () => {
    const send = vi.fn();
    const { rerender } = render(<textarea aria-label="需求" onKeyDown={(e) => handleComposerKeyDown(e, true, send)} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(send).not.toHaveBeenCalled();
    rerender(<textarea aria-label="需求" onKeyDown={(e) => handleComposerKeyDown(e, false, send)} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', repeat: true });
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true })).toBe(true);
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
