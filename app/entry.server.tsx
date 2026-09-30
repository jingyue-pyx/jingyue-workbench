import type { AppLoadContext } from '@remix-run/cloudflare';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';
import { frameHtmlStream } from '~/lib/.server/html-stream';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: any,
  _loadContext: AppLoadContext,
) {
  // await initializeModelList({});

  const readable = await renderToReadableStream(<RemixServer context={remixContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      console.error(error);
      responseStatusCode = 500;
    },
  });

  /*
   * Browsers use streaming rather than allReady, but a later abort can still
   * reject React's allReady promise. Observe it on both paths.
   */
  void readable.allReady.catch(() => {});

  if (isbot(request.headers.get('user-agent') || '')) {
    await readable.allReady;
  }

  const head = renderHeadToString({ request, remixContext, Head });
  const account = _loadContext.accountUser;
  const bootstrap = account
    ? `<meta name="jingyue-account" content="${JSON.stringify(account).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">`
    : '';
  const body = frameHtmlStream(
    readable,
    `<!DOCTYPE html><html lang="zh-CN" data-theme="${themeStore.value}"><head>${bootstrap}${head}</head><body><div id="root" class="w-full h-full">`,
    '</div></body></html>',
  );

  responseHeaders.set('Content-Type', 'text/html');

  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
