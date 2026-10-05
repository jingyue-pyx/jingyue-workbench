import { describe, expect, it } from 'vitest';
import { netlifyAuthorizationURL } from './client';

describe('official Netlify authorization destination', () => {
  it('accepts only the official ticket authorization endpoint', () => {
    const url = 'https://app.netlify.com/authorize?response_type=ticket&ticket=example_123-abc';
    expect(netlifyAuthorizationURL(url)).toBe(url);
  });
  it.each([
    null,
    '',
    'javascript:alert(1)',
    'http://app.netlify.com/authorize?response_type=ticket&ticket=a',
    'https://app.netlify.com.evil.test/authorize?response_type=ticket&ticket=a',
    'https://user:pass@app.netlify.com/authorize?response_type=ticket&ticket=a',
    'https://app.netlify.com/other?response_type=ticket&ticket=a',
    'https://app.netlify.com/authorize?response_type=token&ticket=a',
    'https://app.netlify.com/authorize?response_type=ticket&ticket=a&redirect_uri=https://evil.test',
    'https://app.netlify.com/authorize?response_type=ticket&ticket=a&ticket=b',
    'https://app.netlify.com/authorize?response_type=ticket&ticket=a#fragment',
  ])('rejects invalid destinations: %s', (url) => expect(netlifyAuthorizationURL(url)).toBeNull());
});
