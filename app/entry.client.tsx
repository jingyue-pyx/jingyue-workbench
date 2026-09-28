import { installAccountGuard } from './lib/auth/account-guard.client';
import { RemixBrowser } from '@remix-run/react';
import { startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

installAccountGuard();
startTransition(() => {
  hydrateRoot(document.getElementById('root')!, <RemixBrowser />);
});
