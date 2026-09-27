import { json } from '@remix-run/cloudflare';

// Match the minimal deployment-gateway response in local development too.
export const loader = () => json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
