import { createHash, timingSafeEqual } from 'node:crypto';
import { projectRoute } from './project-protocol.mjs';

export const MODEL_LIST = [
  { name: 'qwen3-coder-next', label: '百炼 · Qwen3 Coder Next', provider: 'Bailian', maxTokenAllowed: 16000 },
  { name: 'qwen-plus', label: '百炼 · Qwen Plus', provider: 'Bailian', maxTokenAllowed: 8000 },
];
export const API_PATHS = new Set([
  '/api/chat',
  '/api/enhancer',
  '/api/models',
  '/api/models/Bailian',
  '/api/check-env-key',
]);

export function configuration(env) {
  const origin = new URL(env.JINGYUE_PUBLIC_ORIGIN || 'https://invalid.invalid');
  const localTest = env.JINGYUE_LOCAL_TEST === '1';
  const host = env.HOST || (localTest ? '127.0.0.1' : '0.0.0.0');
  if (
    !env.JINGYUE_PUBLIC_ORIGIN ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('Set JINGYUE_PUBLIC_ORIGIN to the canonical origin.');
  }
  if (localTest ? host !== '127.0.0.1' || origin.hostname !== '127.0.0.1' : origin.protocol !== 'https:') {
    throw new Error('Public deployment requires HTTPS; local tests must bind to loopback.');
  }
  const username = env.WORKBENCH_ACCESS_USER;
  const password = env.WORKBENCH_ACCESS_PASSWORD;
  if (!username || username.includes(':') || !password || password.length < 20) {
    throw new Error('Private access credentials are required; password must contain at least 20 characters.');
  }
  const endpoint = new URL(env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  if (
    endpoint.protocol !== 'https:' ||
    !endpoint.hostname.endsWith('.aliyuncs.com') ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('The model endpoint must be an official Alibaba Cloud HTTPS endpoint.');
  }
  if (!env.DASHSCOPE_API_KEY && !localTest) throw new Error('A server-side model key is required.');
  const authMode = env.JINGYUE_AUTH_MODE || 'basic';
  if (!['basic', 'accounts'].includes(authMode)) throw new Error('Unknown authentication mode.');
  const legacyUsername = (env.JINGYUE_LEGACY_ACCOUNT || username).normalize('NFKC').trim().toLowerCase();
  if (authMode === 'accounts' && !/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u.test(legacyUsername))
    throw new Error('Set a valid reserved legacy account name.');
  const positiveLimit = (key, fallback, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Invalid account limit.');
    return value;
  };
  return {
    origin: origin.origin,
    localTest,
    host,
    port: Number(env.PORT || 9000),
    authDigest: digest(`${username}:${password}`),
    authMode,
    legacyUsername,
    legacyAccessUser: username,
    registrationOpen: env.JINGYUE_REGISTRATION_OPEN === '1',
    maxAccounts: positiveLimit('JINGYUE_MAX_ACCOUNTS', 20, 100),
    userDailyRequests: positiveLimit('JINGYUE_USER_DAILY_REQUESTS', 20, 100),
    globalDailyRequests: positiveLimit('JINGYUE_GLOBAL_DAILY_REQUESTS', 100, 500),
    modelEnv: { DASHSCOPE_API_KEY: env.DASHSCOPE_API_KEY || '', DASHSCOPE_BASE_URL: endpoint.href.replace(/\/$/, '') },
  };
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export function authenticated(header, config) {
  if (!header?.startsWith('Basic ') || header.length > 2048) return false;
  try {
    const candidate = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return timingSafeEqual(digest(candidate), config.authDigest);
  } catch {
    return false;
  }
}

export function safePath(pathname) {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes('%')) return null;
    if (decoded.split('/').some((part) => part.startsWith('.'))) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function apiAllowed(pathname) {
  // Remix matches routes case-insensitively by default. Unknown uppercase API
  // variants must not fall through as ordinary pages and bypass the allowlist.
  const lower = pathname.toLowerCase();
  return !(lower === '/api' || lower.startsWith('/api/')) || API_PATHS.has(pathname) || !!projectRoute(pathname);
}

export function safeModelRequest(body, path) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const modelNames = MODEL_LIST.map((model) => model.name);
  if (path !== '/api/chat') {
    if (body.provider?.name !== 'Bailian' || !modelNames.includes(body.model)) return false;
  }
  if (path === '/api/chat' && (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200))
    return false;
  if (body.messages !== undefined && !Array.isArray(body.messages)) return false;
  for (const message of body.messages || []) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    let content = message.content;
    // The workbench sends text-only content parts on append/reload. Normalize
    // only this exact shape before the same model/provider checks; multimodal
    // and tool parts remain unavailable in the private deployment.
    if (Array.isArray(content)) {
      if (
        !content.length ||
        !content.every(
          (part) =>
            part &&
            typeof part === 'object' &&
            !Array.isArray(part) &&
            part.type === 'text' &&
            typeof part.text === 'string' &&
            Object.keys(part).every((key) => key === 'type' || key === 'text'),
        )
      )
        return false;
      content = content.map((part) => part.text).join('');
      if (!content.trim()) return false;
    }
    if (typeof content !== 'string') return false;
    const model = content.match(/^\[Model: (.*?)\]\n\n/)?.[1];
    const provider = content.match(/\[Provider: (.*?)\]\n\n/)?.[1];
    if ((model && !modelNames.includes(model)) || (provider && provider !== 'Bailian')) return false;
    message.content = content;
  }
  delete body.apiKeys;
  delete body.providerSettings;
  delete body.providers;
  // Cloud connectors are deliberately unavailable in the private POC.
  delete body.supabase;
  return true;
}

export function modelCatalog() {
  const provider = {
    name: 'Bailian',
    staticModels: MODEL_LIST,
    getApiKeyLink: 'https://bailian.console.aliyun.com/',
    labelForGetApiKey: '阿里云百炼控制台',
  };
  return { modelList: MODEL_LIST, providers: [provider], defaultProvider: provider };
}
