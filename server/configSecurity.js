const PLACEHOLDER_SECRET = 'change-this-secret-key-in-production';
const MIN_SECRET_LENGTH = 32;

function booleanValue(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value === 'string') value = value.toLowerCase();
  if ([true, 1, 'true', '1', 'yes', 'on'].includes(value)) return true;
  if ([false, 0, 'false', '0', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} must be a boolean`);
}

function resolveUsers(rawAuth, env, production) {
  if (env.WC_AUTH_USERS !== undefined) {
    try { return JSON.parse(env.WC_AUTH_USERS); }
    catch { throw new Error('WC_AUTH_USERS must contain valid JSON'); }
  }
  if (rawAuth.users !== undefined) return rawAuth.users;
  if (env.WC_AUTH_USERNAME !== undefined || env.WC_AUTH_PASSWORD !== undefined) {
    return [{ username: env.WC_AUTH_USERNAME ?? (production ? '' : 'admin'),
      password: env.WC_AUTH_PASSWORD ?? (production ? '' : 'admin123') }];
  }
  return production ? [] : [{ username: 'admin', password: 'admin123' }];
}

function resolveAuthConfig(rawConfig = {}, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const auth = rawConfig.auth || {};
  const proxy = env.WC_TRUST_PROXY ?? auth.trustProxy ?? false;
  let trustProxy;
  if (proxy === true || proxy === 'true') trustProxy = true;
  else if (proxy === false || proxy === 'false') trustProxy = false;
  else if (/^\d+$/.test(String(proxy)) && Number.isSafeInteger(Number(proxy))) trustProxy = Number(proxy);
  else throw new Error('WC_TRUST_PROXY must be false, true or a non-negative hop count');
  const origins = env.WC_CORS_ORIGINS ?? auth.corsOrigins ?? [];
  const corsOrigins = typeof origins === 'string' ? origins.split(',').map(origin => origin.trim()).filter(Boolean) : origins;
  if (!Array.isArray(corsOrigins) || corsOrigins.some(origin => {
    try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; }
    catch { return true; }
  })) throw new Error('WC_CORS_ORIGINS must list exact HTTP/HTTPS origins without wildcards or paths');
  const sessionMaxAge = Number(env.WC_SESSION_MAX_AGE ?? auth.sessionMaxAge ?? 86400000);
  if (!Number.isSafeInteger(sessionMaxAge) || sessionMaxAge <= 0) throw new Error('WC_SESSION_MAX_AGE must be a positive integer in milliseconds');
  const cookieName = env.WC_SESSION_COOKIE_NAME ?? auth.cookieName ?? 'webcommander.sid';
  if (typeof cookieName !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(cookieName)) throw new Error('Invalid session cookie name');
  return {
    enabled: booleanValue(env.WC_AUTH_ENABLED ?? auth.enabled, true, 'WC_AUTH_ENABLED'),
    users: resolveUsers(auth, env, production),
    sessionSecret: env.WC_SESSION_SECRET ?? auth.sessionSecret ?? (production ? undefined : PLACEHOLDER_SECRET),
    sessionMaxAge, cookieName, trustProxy, corsOrigins: [...new Set(corsOrigins)],
    cookieSecure: booleanValue(env.WC_COOKIE_SECURE ?? auth.cookieSecure, production, 'WC_COOKIE_SECURE'),
    allowMemorySessionStore: booleanValue(env.WC_ALLOW_MEMORY_SESSION_STORE ?? auth.allowMemorySessionStore, !production, 'WC_ALLOW_MEMORY_SESSION_STORE'),
  };
}

function validateSecurityConfig(config, env = process.env) {
  const auth = config.auth;
  const errors = [], warnings = [];
  const production = env.NODE_ENV === 'production';
  const report = message => (production ? errors : warnings).push(message);
  if (typeof auth.sessionSecret !== 'string' || !auth.sessionSecret.trim()) report('Session secret is required');
  else if (auth.sessionSecret === PLACEHOLDER_SECRET) report('Placeholder session secret is not allowed in production');
  else if (auth.sessionSecret.length < MIN_SECRET_LENGTH) report(`Session secret must contain at least ${MIN_SECRET_LENGTH} characters`);
  if (!Array.isArray(auth.users)) errors.push('Auth users must be an array');
  else if (auth.enabled) {
    if (auth.users.length === 0) report('At least one auth user is required');
    if (auth.users.some(user => !user || typeof user.username !== 'string' || !user.username.trim() || typeof user.password !== 'string' || !user.password.trim())) {
      report('Auth users must have non-empty usernames and passwords');
    }
    if (auth.users.some(user => user?.username === 'admin' && user.password === 'admin123')) report('Default development credentials are not allowed in production');
  }
  if (production && !auth.allowMemorySessionStore) errors.push('MemoryStore requires explicit WC_ALLOW_MEMORY_SESSION_STORE=true in production');
  if (production && auth.allowMemorySessionStore) warnings.push('MemoryStore is memory-only, loses sessions on restart and supports only one process/instance');
  if (errors.length) throw new Error(`Invalid security configuration: ${errors.join('; ')}`);
  return warnings;
}

function sessionSettings(auth) {
  const cookieOptions = { path: '/', secure: auth.cookieSecure, httpOnly: true, sameSite: 'lax' };
  return { cookieOptions, options: {
    name: auth.cookieName, secret: auth.sessionSecret, resave: false, saveUninitialized: false,
    cookie: { ...cookieOptions, maxAge: auth.sessionMaxAge },
  } };
}

module.exports = { resolveAuthConfig, resolveUsers, validateSecurityConfig, sessionSettings, MIN_SECRET_LENGTH, PLACEHOLDER_SECRET };
