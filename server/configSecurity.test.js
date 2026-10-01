const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAuthConfig, validateSecurityConfig, PLACEHOLDER_SECRET } = require('./configSecurity');
const strong = { enabled: true, users: [{ username: 'operator', password: 'test-only-password' }],
  sessionSecret: 'test-only-session-secret-with-more-than-32-characters', allowMemorySessionStore: true };
const production = { NODE_ENV: 'production' };
const config = (auth, env = production) => ({ auth: resolveAuthConfig({ auth }, env) });

for (const [name, change, message] of [
  ['default credentials', { users: [{ username: 'admin', password: 'admin123' }] }, /Default development credentials/],
  ['placeholder secret', { sessionSecret: PLACEHOLDER_SECRET }, /Placeholder session secret/],
  ['short secret', { sessionSecret: 'short' }, /at least 32/],
  ['missing secret', { sessionSecret: undefined }, /Session secret is required/],
  ['empty secret', { sessionSecret: '' }, /Session secret is required/],
  ['empty users', { users: [] }, /At least one auth user/],
  ['empty username', { users: [{ username: '', password: 'test' }] }, /non-empty/],
  ['empty password', { users: [{ username: 'test', password: '' }] }, /non-empty/],
  ['MemoryStore without opt-in', { allowMemorySessionStore: undefined }, /WC_ALLOW_MEMORY_SESSION_STORE/],
]) test(`production rejects ${name}`, () => assert.throws(() => validateSecurityConfig(config({ ...strong, ...change }), production), message));

test('production accepts explicit credentials, secret, cookie defaults and MemoryStore acknowledgement', () => {
  const resolved = config(strong);
  assert.equal(validateSecurityConfig(resolved, production).length, 1);
  assert.equal(resolved.auth.cookieSecure, true);
  assert.equal(resolved.auth.trustProxy, false);
  assert.equal(resolved.auth.cookieName, 'webcommander.sid');
  assert.deepEqual(resolved.auth.corsOrigins, []);
});

test('development/test defaults remain usable with non-secret warnings', () => {
  for (const NODE_ENV of ['development', 'test', undefined]) {
    const env = { NODE_ENV };
    const resolved = { auth: resolveAuthConfig({}, env) };
    assert.deepEqual(resolved.auth.users, [{ username: 'admin', password: 'admin123' }]);
    assert.equal(resolved.auth.cookieSecure, false);
    assert.equal(resolved.auth.allowMemorySessionStore, true);
    const warnings = validateSecurityConfig(resolved, env).join(' ');
    assert.match(warnings, /Placeholder/); assert.match(warnings, /Default development/);
    assert.equal(warnings.includes('admin123'), false); assert.equal(warnings.includes(PLACEHOLDER_SECRET), false);
  }
});

test('security environment overrides resolved config and auth-users JSON never silently falls back', () => {
  const env = { ...production, WC_AUTH_USERS: JSON.stringify([{ username: 'env-user', password: 'env-password' }]),
    WC_SESSION_SECRET: strong.sessionSecret, WC_ALLOW_MEMORY_SESSION_STORE: 'true', WC_COOKIE_SECURE: 'false',
    WC_TRUST_PROXY: '1', WC_SESSION_MAX_AGE: '123000', WC_SESSION_COOKIE_NAME: 'custom.sid',
    WC_CORS_ORIGINS: 'https://one.example, https://two.example', WC_AUTH_ENABLED: 'false' };
  const resolved = config({ ...strong, sessionSecret: 'short' }, env);
  assert.equal(resolved.auth.users[0].username, 'env-user');
  assert.equal(resolved.auth.enabled, false);
  assert.equal(resolved.auth.sessionSecret, strong.sessionSecret);
  assert.equal(resolved.auth.cookieSecure, false);
  assert.equal(resolved.auth.trustProxy, 1);
  assert.equal(resolved.auth.sessionMaxAge, 123000);
  assert.equal(resolved.auth.cookieName, 'custom.sid');
  assert.deepEqual(resolved.auth.corsOrigins, ['https://one.example', 'https://two.example']);
  for (const value of ['', '{', 'not-json']) assert.throws(() => resolveAuthConfig({ auth: strong }, { WC_AUTH_USERS: value }), /valid JSON/);
  assert.throws(() => validateSecurityConfig(config(strong, { ...production, WC_AUTH_USERS: '{}' }), production), /must be an array/);
});

test('config users precede explicit single-user fallback; production never creates an implicit admin user', () => {
  const env = { ...production, WC_AUTH_USERNAME: 'explicit', WC_AUTH_PASSWORD: 'test-only' };
  assert.deepEqual(resolveAuthConfig({ auth: strong }, env).users, strong.users);
  assert.deepEqual(resolveAuthConfig({}, env).users, [{ username: 'explicit', password: 'test-only' }]);
  assert.deepEqual(resolveAuthConfig({}, production).users, []);
  assert.equal(resolveAuthConfig({}, production).sessionSecret, undefined);
  assert.equal(resolveAuthConfig({ auth: { cookieSecure: false, trustProxy: 1 } }, production).cookieSecure, false);
});

test('malformed security options fail instead of enabling broad access', () => {
  for (const env of [{ WC_CORS_ORIGINS: '*' }, { WC_CORS_ORIGINS: 'https://host/path' },
    { WC_COOKIE_SECURE: 'sometimes' }, { WC_AUTH_ENABLED: '' }, { WC_TRUST_PROXY: '-1' },
    { WC_SESSION_MAX_AGE: '-2' }, { WC_SESSION_COOKIE_NAME: 'bad;name' }]) {
    assert.throws(() => resolveAuthConfig({}, env));
  }
});
