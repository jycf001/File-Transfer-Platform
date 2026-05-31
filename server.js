import compression from 'compression';
import crypto from 'node:crypto';
import { ZipArchive } from 'archiver';
import dns from 'node:dns';
import express from 'express';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import helmet from 'helmet';
import multer from 'multer';
import net from 'node:net';
import nodemailer from 'nodemailer';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const createZipArchive = (options) => new ZipArchive(options);

// 优先使用 IPv4，避免服务器无 IPv6 网络时 SMTP 等连接失败
dns.setDefaultResultOrder('ipv4first');

function loadDotEnv() {
  const envFile = path.join(__dirname, '.env');
  try {
    const raw = fs.readFileSync(envFile, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
      const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      if (quoted) value = value.slice(1, -1);
      process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[config] .env load failed:', error.message);
  }
}

loadDotEnv();

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')),
  retentionHours: Number(process.env.RETENTION_HOURS || 48),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 512),
  maxFilesPerUpload: Number(process.env.MAX_FILES_PER_UPLOAD || 10),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 30),
  trustProxy: process.env.TRUST_PROXY === 'true',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || ''
};

if (config.sessionSecret && config.sessionSecret.length < 32) {
  console.warn('[security] SESSION_SECRET should be at least 32 characters.');
}

if (process.argv.includes('--init')) {
  const stateFileForInit = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'), 'state.json');
  let existing = { users: [], files: [], sessions: [], logs: [], emailChallenges: [], settings: {} };
  try {
    existing = JSON.parse(await fsp.readFile(stateFileForInit, 'utf8'));
  } catch {}
  if (Array.isArray(existing.users) && existing.users.length > 0) {
    console.log('[init] 系统已初始化，已有管理员账号:', existing.users.map((u) => u.username).join(', '));
    console.log('[init] 如需重新初始化，请先删除 data/state.json');
    process.exit(0);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log('=== JiahaoDrop 初始化 ===\n');
  const username = (await ask('管理员用户名 (3-32位小写字母/数字/点/横线/下划线): ')).trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    console.error('[init] 用户名格式不正确');
    rl.close();
    process.exit(1);
  }
  const password = (await ask('管理员密码 (至少8位): ')).trim();
  if (password.length < 8 || password.length > 128) {
    console.error('[init] 密码长度需为 8-128 位');
    rl.close();
    process.exit(1);
  }
  const email = (await ask('管理员邮箱 (可选，直接回车跳过): ')).trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('[init] 邮箱格式不正确');
    rl.close();
    process.exit(1);
  }
  rl.close();
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err); else resolve(key.toString('hex'));
    });
  });
  const user = {
    id: crypto.randomBytes(16).toString('hex'),
    username,
    email: email || '',
    passwordHash: `scrypt$${salt}$${derived}`,
    role: 'super_admin',
    disabled: false,
    createdAt: new Date().toISOString()
  };
  const newState = { users: [user], files: [], sessions: [], logs: [{ id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), level: 'info', action: 'system.initialized', actorId: user.id, actor: username, ip: '', userAgent: 'CLI', meta: {} }], emailChallenges: [], settings: {} };
  await fsp.mkdir(path.dirname(stateFileForInit), { recursive: true, mode: 0o700 });
  const tmpFile = `${stateFileForInit}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpFile, JSON.stringify(newState, null, 2), { mode: 0o600 });
  await fsp.rename(tmpFile, stateFileForInit);
  console.log(`\n[init] 管理员 "${username}" 创建成功，状态已保存到 ${stateFileForInit}`);
  console.log('[init] 现在可以运行 npm start 启动服务');
  process.exit(0);
}

const tempDir = path.join(config.dataDir, 'tmp');
const stateFile = path.join(config.dataDir, 'state.json');
const defaultStorageDir = path.resolve(process.env.STORAGE_DIR || path.join(config.dataDir, 'storage'));
const sessionCookie = 'jiahaodrop_session';
const safeNameFallback = 'download.bin';
const maxLogEntries = 1200;
const maxDownloadLogEntries = 100;
const emailCodeTtlMs = 30 * 60 * 1000;
const captchaStore = new Map();
const emailCodeStore = new Map();
let cachedMailer = null;
let cachedMailerKey = '';
const bruteForceStore = new Map(); // ip -> { count, firstAt, blockedUntil }
const publicCodeFailureStore = new Map(); // ip -> { count, firstAt, blockedUntil }
let uploadSerial = Promise.resolve();
const downloadLocks = new Map(); // fileId -> Promise chain

function withUploadLock(task) {
  const run = uploadSerial.then(task, task);
  uploadSerial = run.catch(() => {});
  return run;
}

function withDownloadLock(fileId, task) {
  const prev = downloadLocks.get(fileId) || Promise.resolve();
  const run = prev.then(task, task);
  const chain = run.catch(() => {});
  downloadLocks.set(fileId, chain);
  chain.then(() => {
    if (downloadLocks.get(fileId) === chain) downloadLocks.delete(fileId);
  });
  return run;
}

function checkBruteForce(ip) {
  const now = Date.now();
  const record = bruteForceStore.get(ip);
  if (!record) return false;
  if (record.blockedUntil && now > record.blockedUntil) {
    bruteForceStore.delete(ip);
    return false;
  }
  if (record.blockedUntil && now <= record.blockedUntil) return true;
  // 5 分钟窗口内累计失败
  if (now - record.firstAt > 5 * 60 * 1000) {
    bruteForceStore.delete(ip);
    return false;
  }
  return false;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const record = bruteForceStore.get(ip);
  if (!record || now - record.firstAt > 5 * 60 * 1000) {
    bruteForceStore.set(ip, { count: 1, firstAt: now, blockedUntil: null, lockCount: 0 });
    return;
  }
  record.count += 1;
  if (record.count >= 5) {
    record.lockCount = (record.lockCount || 0) + 1;
    const lockMinutes = record.lockCount >= 3 ? 15 : record.lockCount >= 2 ? 5 : 1;
    record.blockedUntil = now + lockMinutes * 60 * 1000;
    // 不重置 count/firstAt，锁定解除后仍在同一窗口内累计
  }
}

function clearLoginAttempts(ip) {
  bruteForceStore.delete(ip);
}

function checkPublicCodeFailures(ip) {
  const now = Date.now();
  const record = publicCodeFailureStore.get(ip);
  if (!record) return false;
  if (record.blockedUntil && now > record.blockedUntil) {
    publicCodeFailureStore.delete(ip);
    return false;
  }
  return Boolean(record.blockedUntil && now <= record.blockedUntil);
}

function recordPublicCodeFailure(ip) {
  const now = Date.now();
  const record = publicCodeFailureStore.get(ip);
  if (!record || now - record.firstAt > 10 * 60 * 1000) {
    publicCodeFailureStore.set(ip, { count: 1, firstAt: now, blockedUntil: null });
    return;
  }
  record.count += 1;
  if (record.count >= 10) record.blockedUntil = now + 15 * 60 * 1000;
}

function clearPublicCodeFailures(ip) {
  publicCodeFailureStore.delete(ip);
}

const defaultSettings = {
  storageDir: defaultStorageDir,
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').trim(),
  maxFileSizeMb: config.maxFileSizeMb,
  storageQuotaMb: Number(process.env.STORAGE_QUOTA_MB || 0),
  registrationEnabled: true,
  siteName: 'JiahaoDrop',
  icpNumber: '豫ICP备2023027149号-2',
  legalNotice: '上传违法违规内容将承担法律责任',
  logRetentionHours: 168,
  logMaxSystem: 400,
  logMaxSecurity: 400,
  logMaxUser: 400,
  smtp: {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    username: '',
    passwordEnc: '',
    from: '',
    logRecipients: ''
  }
};

const state = {
  users: [],
  files: [],
  sessions: [],
  logs: [],
  emailChallenges: [],
  settings: structuredClone(defaultSettings)
};

function cleanupTransientChallenges() {
  const now = Date.now();
  for (const [id, challenge] of captchaStore.entries()) {
    if (challenge.expiresAt <= now) captchaStore.delete(id);
  }
  for (const [id, challenge] of emailCodeStore.entries()) {
    if (challenge.expiresAt <= now) emailCodeStore.delete(id);
  }
  state.emailChallenges = state.emailChallenges.filter((challenge) => Number(challenge.expiresAt || 0) > now);
}

async function ensureDirectories() {
  await fsp.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await fsp.mkdir(tempDir, { recursive: true, mode: 0o700 });
  await fsp.mkdir(getStorageDir(), { recursive: true, mode: 0o700 });
}

async function loadState() {
  try {
    const raw = await fsp.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    state.users = Array.isArray(parsed.users) ? parsed.users : [];
    state.files = Array.isArray(parsed.files)
      ? parsed.files.map((file) => ({
        ...file,
        originalName: sanitizeOriginalName(file.originalName)
      }))
      : [];
    state.sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map((session) => ({
        ...session,
        lastSeenAt: session.lastSeenAt || session.createdAt || nowIso()
      }))
      : [];
    state.logs = Array.isArray(parsed.logs) ? parsed.logs.slice(-maxLogEntries) : [];
    state.emailChallenges = Array.isArray(parsed.emailChallenges) ? parsed.emailChallenges : [];
    state.settings = mergeSettings(parsed.settings);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveState();
  }
  await ensureDirectories();
}

let _saveDirty = false;
let _saveInFlight = false;

async function _doSave() {
  await fsp.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, stateFile);
}

async function saveState() {
  _saveDirty = true;
  if (_saveInFlight) return;
  _saveInFlight = true;
  try {
    while (_saveDirty) {
      _saveDirty = false;
      try {
        await _doSave();
      } catch (e) {
        _saveDirty = true;
        throw e;
      }
    }
  } finally {
    _saveInFlight = false;
  }
}

function mergeSettings(settings = {}) {
  return {
    storageDir: normalizeStorageDir(settings.storageDir || defaultSettings.storageDir),
    publicBaseUrl: normalizePublicBaseUrl(settings.publicBaseUrl || defaultSettings.publicBaseUrl),
    maxFileSizeMb: normalizeMaxFileSizeMb(settings.maxFileSizeMb),
    storageQuotaMb: normalizeStorageQuotaMb(settings.storageQuotaMb),
    registrationEnabled: settings.registrationEnabled === undefined ? true : Boolean(settings.registrationEnabled),
    siteName: normalizeStringSetting(settings.siteName, defaultSettings.siteName, 30),
    icpNumber: normalizeStringSetting(settings.icpNumber, defaultSettings.icpNumber, 60),
    legalNotice: normalizeStringSetting(settings.legalNotice, defaultSettings.legalNotice, 100),
    logRetentionHours: normalizeIntegerSetting(settings.logRetentionHours, defaultSettings.logRetentionHours, 24, 8760),
    logMaxSystem: normalizeIntegerSetting(settings.logMaxSystem, defaultSettings.logMaxSystem, 50, 5000),
    logMaxSecurity: normalizeIntegerSetting(settings.logMaxSecurity, defaultSettings.logMaxSecurity, 50, 5000),
    logMaxUser: normalizeIntegerSetting(settings.logMaxUser, defaultSettings.logMaxUser, 50, 5000),
    maxFilesPerUpload: normalizeIntegerSetting(settings.maxFilesPerUpload, config.maxFilesPerUpload, 1, 100),
    retentionHours: normalizeIntegerSetting(settings.retentionHours, config.retentionHours, 1, 720),
    sessionHours: normalizeIntegerSetting(settings.sessionHours, config.sessionHours, 1, 720),
    sessionIdleMinutes: normalizeIntegerSetting(settings.sessionIdleMinutes, config.sessionIdleMinutes, 1, 10080),
    smtp: {
      ...defaultSettings.smtp,
      ...(settings.smtp || {}),
      port: Number(settings.smtp?.port || defaultSettings.smtp.port),
      secure: settings.smtp?.secure === undefined ? defaultSettings.smtp.secure : Boolean(settings.smtp.secure),
      enabled: settings.smtp?.enabled === undefined ? defaultSettings.smtp.enabled : Boolean(settings.smtp.enabled)
    }
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeIntegerSetting(value, fallback, min, max) {
  const rawFallback = Number(fallback);
  const safeFallback = Number.isFinite(rawFallback) && rawFallback >= min && rawFallback <= max ? Math.round(rawFallback) : min;
  const number = Number(value === undefined || value === null || value === '' ? safeFallback : value);
  const rounded = Math.round(number);
  if (!Number.isFinite(number) || rounded < min || rounded > max) return safeFallback;
  return rounded;
}

function normalizeStringSetting(value, fallback, maxLen) {
  const str = String(value == null ? '' : value).trim();
  if (!str) return fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function ensureMinResponseTime(startMs, minMs) {
  const elapsed = Date.now() - startMs;
  if (elapsed < minMs) await sleep(minMs - elapsed);
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getSecret() {
  if (config.sessionSecret) return config.sessionSecret;
  const secretFile = path.join(config.dataDir, '.session-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {}
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn('[security] SESSION_SECRET not set. Auto-generated and saved to', secretFile);
  } catch (error) {
    console.warn('[security] SESSION_SECRET not set and could not persist to file:', error.message);
  }
  return generated;
}

function hashToken(token) {
  return crypto.createHmac('sha256', getSecret()).update(token).digest('hex');
}

function encryptionKey() {
  return crypto.createHash('sha256').update(getSecret()).digest();
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  const [prefix, version, ivText, tagText, dataText] = String(value).split(':');
  if (prefix !== 'enc' || version !== 'v1' || !ivText || !tagText || !dataText) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function parseCookies(header = '') {
  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return Object.fromEntries(
    header.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [safeDecode(part.slice(0, index)), safeDecode(part.slice(index + 1))];
      })
  );
}

function sessionAbsoluteHours() {
  const hours = Number(getSessionHours());
  if (!Number.isFinite(hours) || hours <= 0) return 12;
  return Math.min(hours, 24 * 30);
}

function sessionIdleMs() {
  const minutes = Number(getSessionIdleMinutes());
  if (!Number.isFinite(minutes) || minutes <= 0) return 30 * 60 * 1000;
  return Math.min(minutes, 24 * 60) * 60 * 1000;
}

function isSessionExpired(session, nowMs = Date.now()) {
  const expiresMs = new Date(session.expiresAt || 0).getTime();
  if (!Number.isFinite(expiresMs) || nowMs > expiresMs) return true;
  const lastSeenMs = new Date(session.lastSeenAt || session.createdAt || 0).getTime();
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return true;
  return nowMs - lastSeenMs > sessionIdleMs();
}

function setSessionCookie(res, token) {
  const attrs = [
    `${encodeURIComponent(sessionCookie)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  const attrs = [
    `${encodeURIComponent(sessionCookie)}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-z0-9_.-]{3,32}$/.test(username);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [name, domain] = normalized.split('@');
  if (!name || !domain) return '';
  const left = name.length <= 2 ? `${name[0] || '*'}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${left}@${domain}`;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString('hex'));
    });
  });
  return `scrypt$${salt}$${derived}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString('hex'));
    });
  });
  return timingSafeEqualText(derived, hash);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || '',
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt
  };
}

function publicSettings() {
  return {
    storageDir: getStorageDir(),
    storageDirConfigured: Boolean(state.settings.storageDir),
    publicBaseUrl: state.settings.publicBaseUrl,
    maxFileSizeMb: getMaxFileSizeMb(),
    storageQuotaMb: getStorageQuotaMb(),
    storageUsedBytes: getCurrentStorageBytes(),
    registrationEnabled: Boolean(state.settings.registrationEnabled),
    siteName: state.settings.siteName || defaultSettings.siteName,
    icpNumber: state.settings.icpNumber || '',
    legalNotice: state.settings.legalNotice || '',
    logRetentionHours: getLogRetentionHours(),
    logMaxSystem: getLogMaxSystem(),
    logMaxSecurity: getLogMaxSecurity(),
    logMaxUser: getLogMaxUser(),
    maxFilesPerUpload: getMaxFilesPerUpload(),
    retentionHours: getRetentionHours(),
    sessionHours: getSessionHours(),
    sessionIdleMinutes: getSessionIdleMinutes(),
    smtp: {
      enabled: Boolean(state.settings.smtp.enabled),
      host: state.settings.smtp.host,
      port: Number(state.settings.smtp.port || 465),
      secure: Boolean(state.settings.smtp.secure),
      username: state.settings.smtp.username,
      passwordSet: Boolean(state.settings.smtp.passwordEnc),
      from: state.settings.smtp.from,
      logRecipients: state.settings.smtp.logRecipients
    }
  };
}

function normalizePublicBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function normalizeMaxFileSizeMb(value) {
  const number = Number(value === undefined || value === null || value === '' ? config.maxFileSizeMb : value);
  if (!Number.isFinite(number)) return config.maxFileSizeMb;
  const size = Math.round(number);
  if (size < 1 || size > 10240) return config.maxFileSizeMb;
  return size;
}

function validateMaxFileSizeMb(value) {
  const number = Number(value);
  const size = Math.round(number);
  if (!Number.isFinite(number)) throw new Error('单文件大小限制需在 1-10240 MB 之间');
  if (size < 1 || size > 10240) throw new Error('单文件大小限制需在 1-10240 MB 之间');
  return size;
}

function getMaxFileSizeMb() {
  return validateMaxFileSizeMb(state.settings.maxFileSizeMb === undefined ? config.maxFileSizeMb : state.settings.maxFileSizeMb);
}

function normalizeStorageQuotaMb(value) {
  const number = Number(value === undefined || value === null || value === '' ? 0 : value);
  if (!Number.isFinite(number)) return 0;
  const size = Math.round(number);
  if (size < 0 || size > 1048576) return 0;
  return size;
}

function validateStorageQuotaMb(value) {
  const number = Number(value);
  const size = Math.round(number);
  if (!Number.isFinite(number)) throw new Error('存储空间限制需在 0-1048576 MB 之间（0 表示不限制）');
  if (size < 0 || size > 1048576) throw new Error('存储空间限制需在 0-1048576 MB 之间（0 表示不限制）');
  return size;
}

function isPrivateOrLoopbackIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const h = ip.toLowerCase();
    if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
    if (h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd00:')) return true;
    // IPv4-mapped IPv6: ::ffff:x.x.x.x or ::ffff:hex
    const v4Mapped = h.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4Mapped) return isPrivateOrLoopbackIp(`${v4Mapped[1]}.${v4Mapped[2]}.${v4Mapped[3]}.${v4Mapped[4]}`);
    const v4MappedHex = h.match(/^::ffff:([0-9a-f]{2})([0-9a-f]{2}):([0-9a-f]{2})([0-9a-f]{2})$/);
    if (v4MappedHex) {
      const hexToNum = (hex) => parseInt(hex, 16);
      return isPrivateOrLoopbackIp(`${hexToNum(v4MappedHex[1])}.${hexToNum(v4MappedHex[2])}.${hexToNum(v4MappedHex[3])}.${hexToNum(v4MappedHex[4])}`);
    }
    return false;
  }
  return false;
}

async function validateSmtpHost(host) {
  if (!host) return host;
  const h = host.toLowerCase().trim().replace(/^\[|]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) {
    throw new Error('SMTP 主机不允许使用内部地址');
  }
  if (net.isIP(h)) {
    if (isPrivateOrLoopbackIp(h)) throw new Error('SMTP 主机不允许使用私有 IP 地址');
    return host;
  }
  // Hostname: resolve via DNS and check all results
  const addresses = await dns.promises.lookup(h, { all: true, family: 0 });
  for (const { address } of addresses) {
    if (isPrivateOrLoopbackIp(address)) throw new Error('SMTP 主机解析到私有 IP 地址，不允许使用');
  }
  return host;
}

function getStorageQuotaMb() {
  return normalizeStorageQuotaMb(state.settings.storageQuotaMb);
}

function getCurrentStorageBytes() {
  return state.files.reduce((sum, file) => sum + Number(file.size || 0), 0);
}

function getMaxFilesPerUpload() {
  return state.settings.maxFilesPerUpload ?? config.maxFilesPerUpload;
}

function getRetentionHours() {
  return state.settings.retentionHours ?? config.retentionHours;
}

function getSessionHours() {
  return state.settings.sessionHours ?? config.sessionHours;
}

function getSessionIdleMinutes() {
  return state.settings.sessionIdleMinutes ?? config.sessionIdleMinutes;
}

function getLogRetentionHours() {
  return normalizeIntegerSetting(state.settings.logRetentionHours, defaultSettings.logRetentionHours, 24, 8760);
}
function getLogMaxSystem() {
  return normalizeIntegerSetting(state.settings.logMaxSystem, defaultSettings.logMaxSystem, 50, 5000);
}
function getLogMaxSecurity() {
  return normalizeIntegerSetting(state.settings.logMaxSecurity, defaultSettings.logMaxSecurity, 50, 5000);
}
function getLogMaxUser() {
  return normalizeIntegerSetting(state.settings.logMaxUser, defaultSettings.logMaxUser, 50, 5000);
}

const SECURITY_LOG_ACTIONS = new Set([
  'auth.login_failed', 'auth.email_login_unknown', 'auth.email_login_code_failed',
  'auth.register_code_failed_to_send', 'auth.email_login_code_failed_to_send'
]);

function categorizeLogEntry(log) {
  const prefix = (log.action || '').split('.')[0];
  if (SECURITY_LOG_ACTIONS.has(log.action) || log.level === 'warn') return 'security';
  if (prefix === 'system' || prefix === 'admin') return 'system';
  if (log.action === 'files.cleanup_expired') return 'system';
  return 'user';
}

function getLogMaxForCategory(category) {
  if (category === 'system') return getLogMaxSystem();
  if (category === 'security') return getLogMaxSecurity();
  return getLogMaxUser();
}

function parseRetentionHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return getRetentionHours();
  const hours = Math.round(number);
  if (hours === 0) return 0; // 0 表示永久保留
  if (hours < 1 || hours > 720) return getRetentionHours();
  return hours;
}

function requestBaseUrl(req) {
  if (state.settings.publicBaseUrl) return state.settings.publicBaseUrl;
  const forwardedProto = config.trustProxy ? req.get('x-forwarded-proto')?.split(',')[0]?.trim() : '';
  const protocol = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || 'localhost';
  return `${protocol}://${host}`;
}

function shareUrlFor(code, req) {
  const base = state.settings.publicBaseUrl || requestBaseUrl(req);
  return `${base}/r/${encodeURIComponent(code)}`;
}

function publicFilePayload(file, req) {
  const downloadCount = file.downloadCount ?? (file.downloadLog || []).length;
  const maxDownloads = normalizeMaxDownloads(file.maxDownloads);
  const remainingDownloads = maxDownloads > 0 ? Math.max(maxDownloads - downloadCount, 0) : null;
  return {
    id: file.id,
    code: file.code,
    name: file.originalName,
    size: file.size,
    createdAt: file.createdAt,
    expiresAt: file.expiresAt,
    retentionHours: file.retentionHours || getRetentionHours(),
    downloadCount,
    maxDownloads,
    remainingDownloads,
    owner: state.users.find((user) => user.id === file.ownerId)?.username || 'unknown',
    shareUrl: shareUrlFor(file.code, req)
  };
}

function sanitizeOriginalName(name) {
  const raw = decodePossibleMulterFilename(name);
  const base = path.basename(String(raw || safeNameFallback)).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim();
  const normalized = base.normalize('NFC');
  return normalized.slice(0, 180) || safeNameFallback;
}

function decodePossibleMulterFilename(name) {
  const input = String(name || '');
  if (!input) return '';
  let decoded = input;
  try {
    decoded = Buffer.from(input, 'latin1').toString('utf8');
  } catch {
    return input;
  }
  if (!decoded || decoded.includes('\uFFFD') || /[\u0000-\u001f]/.test(decoded)) return input;

  const score = (text) => {
    let cjk = 0;
    let mojibake = 0;
    for (const char of text) {
      const code = char.codePointAt(0) || 0;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)
      ) cjk += 1;
      if ((code >= 0x00C0 && code <= 0x00FF) || char === 'Ã' || char === 'Â' || char === 'Ð' || char === 'Ñ') {
        mojibake += 1;
      }
    }
    return { cjk, mojibake };
  };

  const before = score(input);
  const after = score(decoded);
  const looksMojibake = before.mojibake >= 2 && before.cjk === 0;
  const decodedLooksBetter = after.cjk > before.cjk || after.mojibake < before.mojibake;
  return looksMojibake && decodedLooksBetter ? decoded : input;
}

function asciiFallbackFilename(name) {
  const text = String(name || safeNameFallback)
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["%;\\]/g, '_')
    .trim();
  return text || safeNameFallback;
}

function contentDispositionForDownload(name) {
  const safe = sanitizeOriginalName(name);
  const fallback = asciiFallbackFilename(safe);
  const encoded = encodeURIComponent(safe)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function handleFileDownload(file, req, res, { byCode = false, isPublic = false } = {}) {
  if (!file) return res.status(404).json({ error: '文件不存在或已过期' });
  if (isExpiredFile(file)) return res.status(404).json({ error: '文件不存在或已过期' });
  if (!isPublic && file.ownerId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: '无权下载该文件' });
  }
  const maxDownloads = normalizeMaxDownloads(file.maxDownloads);
  const needsCount = maxDownloads > 0;
  // Per-file lock: make check-and-increment atomic to prevent TOCTOU race
  if (needsCount) {
    const allowed = await withDownloadLock(file.id, async () => {
      if (!hasDownloadsRemaining(file)) return false;
      if (!file.downloadLog) file.downloadLog = [];
      file.downloadCount = downloadCountFor(file) + 1;
      file.downloadLog.push({ ip: clientIp(req), at: nowIso(), pending: true });
      file.downloadLog = file.downloadLog.slice(-maxDownloadLogEntries);
      await saveState();
      return true;
    });
    if (!allowed) return res.status(410).json({ error: '文件下载次数已用完' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', contentDispositionForDownload(file.originalName));
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  let transferred = false;
  await new Promise((resolve) => {
    res.sendFile(filePathFor(file), (error) => {
      if (error) {
        if (!res.headersSent) res.status(404).json({ error: '文件读取失败' });
        resolve();
        return;
      }
      transferred = true;
      resolve();
    });
  });
  if (!transferred) {
    // 传输失败，回滚预占的下载次数
    if (needsCount && file.downloadLog) {
      const pendingIdx = file.downloadLog.findIndex((e) => e.pending && e.ip === clientIp(req));
      if (pendingIdx !== -1) file.downloadLog.splice(pendingIdx, 1);
      file.downloadCount = downloadCountFor(file);
      await saveState();
    }
    return;
  }
  // 传输成功，清除 pending 标记
  if (needsCount && file.downloadLog) {
    const entry = file.downloadLog.find((e) => e.pending && e.ip === clientIp(req));
    if (entry) delete entry.pending;
  }
  addLog(isPublic ? 'files.public_downloaded' : 'files.downloaded', req, { fileId: file.id, byCode, code: file.code });
  if (req.session) req.session.lastSeenAt = new Date().toISOString();
  await saveState();
}

function zipDisplayName(uploaded, code) {
  if (uploaded.length === 1) {
    const original = sanitizeOriginalName(uploaded[0].originalname);
    return original.toLowerCase().endsWith('.zip') ? original : `${original}.zip`;
  }
  const first = sanitizeOriginalName(uploaded[0].originalname).replace(/\.[^.]+$/, '');
  const safeFirst = first || 'batch';
  return `${safeFirst}-等${uploaded.length}个文件-${code}.zip`;
}

function uniqueArchiveEntryName(name, used) {
  const sanitized = sanitizeOriginalName(name);
  const ext = path.extname(sanitized);
  const base = sanitized.slice(0, sanitized.length - ext.length) || 'file';
  let attempt = 0;
  while (attempt < 5000) {
    const suffix = attempt === 0 ? '' : `(${attempt})`;
    const candidate = `${base}${suffix}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    attempt += 1;
  }
  const fallback = `${randomId(6)}${ext || '.bin'}`;
  used.add(fallback);
  return fallback;
}

async function createZipFromUploadedFiles(uploaded, targetPath) {
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(targetPath, { mode: 0o600 });
      const archive = createZipArchive({ zlib: { level: 3 } });
      const usedNames = new Set();

      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.on('warning', (error) => {
        if (error.code !== 'ENOENT') reject(error);
      });

      archive.pipe(output);
      for (const file of uploaded) {
        archive.file(file.path, { name: uniqueArchiveEntryName(file.originalname, usedNames) });
      }
      Promise.resolve(archive.finalize()).catch(reject);
    });
  } catch (err) {
    const details = err.message || String(err);
    throw new Error(`文件打包失败: ${details}`);
  }
  const stat = await fsp.stat(targetPath);
  return stat.size;
}

function makeCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!state.files.some((file) => file.code === code && !file.deletedAt)) return code;
  }
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

function normalizeReceiveCode(code) {
  return String(code || '').trim().toUpperCase();
}

function validateReceiveCode(code) {
  return /^[A-Z0-9]{6}$/.test(code);
}

function normalizeMaxDownloads(value) {
  const number = Number(value === undefined || value === null || value === '' ? 0 : value);
  if (!Number.isFinite(number)) return 0;
  const count = Math.floor(number);
  if (count < 0) return 0;
  if (count > 100000) return 100000;
  return count;
}

function validateMaxDownloads(value) {
  const number = Number(value === undefined || value === null || value === '' ? 0 : value);
  const count = Math.floor(number);
  if (!Number.isFinite(number) || count < 0 || count > 100000) throw new Error('下载次数限制需为 0-100000，0 表示不限');
  return count;
}

function downloadCountFor(file) {
  return file.downloadCount ?? (file.downloadLog || []).length;
}

function downloadsRemaining(file) {
  const maxDownloads = normalizeMaxDownloads(file.maxDownloads);
  if (maxDownloads <= 0) return null;
  return Math.max(maxDownloads - downloadCountFor(file), 0);
}

function hasDownloadsRemaining(file) {
  const remaining = downloadsRemaining(file);
  return remaining === null || remaining > 0;
}

function normalizeStorageDir(value) {
  const raw = String(value || defaultStorageDir).trim();
  return path.resolve(raw);
}

function validateStorageDir(value) {
  const target = normalizeStorageDir(value);
  const parsed = path.parse(target);
  if (target === parsed.root) throw new Error('不能把磁盘根目录作为文件存放目录');
  // 限制 storageDir 必须在专用数据目录内，防止误设到项目目录、用户目录等宽泛路径
  const dataRoot = path.resolve(config.dataDir) + path.sep;
  const normalized = path.resolve(target) + path.sep;
  if (!normalized.startsWith(dataRoot)) throw new Error('文件存放目录必须在数据目录内: ' + dataRoot);
  return target;
}

function getStorageDir() {
  return normalizeStorageDir(state.settings.storageDir);
}

function filePathFor(fileOrStoredName) {
  const file = typeof fileOrStoredName === 'object' ? fileOrStoredName : { storedName: fileOrStoredName };
  const safeStoredName = path.basename(String(file.storedName || ''));
  const baseDir = normalizeStorageDir(file.storageDir || defaultStorageDir);
  return path.join(baseDir, safeStoredName);
}

function isExpiredFile(file) {
  if (file.deletedAt) return true;
  if (file.retentionHours === 0) return false; // 永久保留
  if (!file.expiresAt) return false;
  return Date.now() > new Date(file.expiresAt).getTime();
}

function recordDownload(file, req) {
  if (!file.downloadLog) file.downloadLog = [];
  file.downloadCount = downloadCountFor(file) + 1;
  file.downloadLog.push({ ip: clientIp(req), at: nowIso() });
  file.downloadLog = file.downloadLog.slice(-maxDownloadLogEntries);
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function addLog(action, req, meta = {}, level = 'info') {
  const entry = {
    id: randomId(8),
    at: nowIso(),
    level,
    action,
    actorId: req?.user?.id || null,
    actor: req?.user?.username || null,
    ip: req ? clientIp(req) : '',
    userAgent: req?.get?.('user-agent') || '',
    meta
  };
  state.logs.push(entry);
  trimLogCategory(categorizeLogEntry(entry));
}

function trimLogCategory(category) {
  const max = getLogMaxForCategory(category);
  const totalMax = getLogMaxSystem() + getLogMaxSecurity() + getLogMaxUser();
  const categoryLogs = [];
  const otherLogs = [];
  for (const log of state.logs) {
    if (categorizeLogEntry(log) === category) categoryLogs.push(log);
    else otherLogs.push(log);
  }
  if (categoryLogs.length > max) {
    const trimmed = categoryLogs.slice(-max);
    state.logs = [...otherLogs, ...trimmed].sort((a, b) => a.at.localeCompare(b.at));
  }
  if (state.logs.length > totalMax) {
    state.logs = state.logs.slice(-totalMax);
  }
}

function logsAsText(logs) {
  return logs.map((log) => {
    const actor = log.actor || 'anonymous';
    const meta = Object.keys(log.meta || {}).length ? ` ${JSON.stringify(log.meta)}` : '';
    return `[${log.at}] ${log.level.toUpperCase()} ${log.action} actor=${actor} ip=${log.ip}${meta}`;
  }).join('\n');
}

function createCaptcha() {
  cleanupTransientChallenges();
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[crypto.randomInt(chars.length)];
  const id = randomId(12);
  captchaStore.set(id, {
    answerHash: hashToken(code.toLowerCase()),
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0
  });
  return { id, svg: generateCaptchaSvg(code) };
}

function generateCaptchaSvg(code) {
  const w = 140, h = 48;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // background
  svg += `<rect width="${w}" height="${h}" fill="#f0f4fa" rx="6"/>`;
  // noise lines
  for (let i = 0; i < 5; i++) {
    const x1 = crypto.randomInt(w), y1 = crypto.randomInt(h);
    const x2 = crypto.randomInt(w), y2 = crypto.randomInt(h);
    const c = `hsl(${crypto.randomInt(360)} 40% ${60 + crypto.randomInt(20)}%)`;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${1 + crypto.randomInt(2)}" opacity="0.5"/>`;
  }
  // noise dots
  for (let i = 0; i < 30; i++) {
    const cx = crypto.randomInt(w), cy = crypto.randomInt(h), r = 1 + crypto.randomInt(2);
    const c = `hsl(${crypto.randomInt(360)} 50% ${50 + crypto.randomInt(30)}%)`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity="0.4"/>`;
  }
  // characters
  const gap = w / (code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const x = gap * (i + 1) + crypto.randomInt(6) - 3;
    const y = 28 + crypto.randomInt(10) - 5;
    const rotate = crypto.randomInt(40) - 20;
    const size = 22 + crypto.randomInt(6);
    const hue = crypto.randomInt(360);
    const c = `hsl(${hue} 65% ${30 + crypto.randomInt(20)}%)`;
    const ch = code[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    svg += `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" font-family="monospace" fill="${c}" transform="rotate(${rotate} ${x} ${y})" text-anchor="middle">${ch}</text>`;
  }
  svg += '</svg>';
  return svg;
}

function verifyCaptcha(id, answer) {
  cleanupTransientChallenges();
  const challenge = captchaStore.get(String(id || ''));
  if (!challenge) return false;
  challenge.attempts += 1;
  const ok = String(answer || '').trim() && timingSafeEqualText(hashToken(String(answer || '').trim().toLowerCase()), challenge.answerHash);
  if (ok || challenge.attempts >= 5) captchaStore.delete(String(id || ''));
  return Boolean(ok);
}

function createEmailChallenge(user) {
  cleanupTransientChallenges();
  const code = String(crypto.randomInt(100000, 1000000));
  const challengeId = randomId(12);
  const challenge = {
    id: challengeId,
    userId: user.id,
    codeHash: hashToken(code),
    expiresAt: Date.now() + emailCodeTtlMs,
    attempts: 0
  };
  emailCodeStore.set(challengeId, challenge);
  state.emailChallenges.push(challenge);
  return { challengeId, code };
}

function getEmailChallenge(challengeId) {
  cleanupTransientChallenges();
  const id = String(challengeId || '');
  const challenge = emailCodeStore.get(id) || state.emailChallenges.find((item) => item.id === id);
  if (challenge && !emailCodeStore.has(id)) emailCodeStore.set(id, challenge);
  return challenge || null;
}

function deleteEmailChallenge(challengeId) {
  const id = String(challengeId || '');
  emailCodeStore.delete(id);
  state.emailChallenges = state.emailChallenges.filter((challenge) => challenge.id !== id);
}

function verifyEmailChallenge(challengeId, userId, code) {
  const challenge = getEmailChallenge(challengeId);
  if (!challenge || challenge.userId !== userId) return false;
  challenge.attempts += 1;
  const ok = String(code || '').trim() && timingSafeEqualText(hashToken(String(code || '').trim()), challenge.codeHash);
  if (ok || challenge.attempts >= 5) deleteEmailChallenge(challengeId);
  return Boolean(ok);
}

async function issueSession(req, res, user, meta = {}) {
  const token = randomId(32);
  const issuedAt = nowIso();
  const expiresAt = addHours(issuedAt, sessionAbsoluteHours());
  const session = {
    id: randomId(),
    userId: user.id,
    tokenHash: hashToken(token),
    csrfToken: randomId(24),
    expiresAt,
    createdAt: issuedAt,
    lastSeenAt: issuedAt
  };
  state.sessions.push(session);
  req.user = user;
  clearLoginAttempts(clientIp(req));
  addLog('auth.login', req, { username: user.username, ...meta });
  await saveState();
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), csrfToken: session.csrfToken });
}

async function cleanupExpired() {
  const before = state.files.length;
  const sessionBefore = state.sessions.length;
  const keep = [];
  const toRemove = [];
  for (const file of state.files) {
    if (isExpiredFile(file)) {
      toRemove.push(file);
    } else {
      keep.push(file);
    }
  }
  if (toRemove.length) {
    await Promise.all(toRemove.map((file) => fsp.rm(filePathFor(file), { force: true }).catch(() => {})));
  }
  state.files = keep;
  state.sessions = state.sessions.filter((session) => !isSessionExpired(session));

  // Clean up logs by retention time
  const logRetentionMs = getLogRetentionHours() * 3600 * 1000;
  const logCutoff = new Date(Date.now() - logRetentionMs).toISOString();
  const logsBefore = state.logs.length;
  state.logs = state.logs.filter((log) => log.at >= logCutoff);

  // Enforce per-category max limits
  for (const category of ['system', 'security', 'user']) {
    trimLogCategory(category);
  }

  if (toRemove.length) addLog('files.cleanup_expired', null, { removed: toRemove.length });
  if (state.files.length !== before || state.sessions.length !== sessionBefore || state.logs.length !== logsBefore) await saveState();
}

function requireSetup(req, res, next) {
  if (state.users.length === 0) return next();
  return res.status(409).json({ error: '系统已经初始化' });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.disabled) return res.status(403).json({ error: '账号已被禁用' });
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) return res.status(403).json({ error: '需要管理员权限' });
  return next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') return res.status(403).json({ error: '需要超级管理员权限' });
  return next();
}

function csrfGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  // 登录/初始化时还没有 session，无法校验 CSRF，靠验证码 + originGuard 保护
  const noSessionPaths = ['/api/login', '/api/login/email', '/api/login/email/verify', '/api/setup', '/api/register', '/api/register/verify'];
  if (noSessionPaths.includes(req.path)) return next();
  const token = req.get('x-csrf-token') || '';
  if (!req.session || !token || !timingSafeEqualText(token, req.session.csrfToken)) {
    return res.status(403).json({ error: 'CSRF 校验失败，请刷新页面后重试' });
  }
  return next();
}

function originGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const host = req.get('host');
  const origin = req.get('origin');
  const referer = req.get('referer');
  if (!origin && !referer) return res.status(403).json({ error: '缺少来源信息' });
  if (origin) {
    try {
      if (new URL(origin).host !== host) return res.status(403).json({ error: '非法来源请求' });
    } catch {
      return res.status(403).json({ error: '非法来源请求' });
    }
  } else if (referer) {
    try {
      if (new URL(referer).host !== host) return res.status(403).json({ error: '非法来源请求' });
    } catch {
      return res.status(403).json({ error: '非法来源请求' });
    }
  }
  return next();
}

function attachSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[sessionCookie];
  if (!rawToken) return next();
  const tokenHash = hashToken(rawToken);
  const index = state.sessions.findIndex((item) => item.tokenHash === tokenHash);
  if (index === -1) {
    clearSessionCookie(res);
    return next();
  }
  const session = state.sessions[index];
  const nowMs = Date.now();
  if (isSessionExpired(session, nowMs)) {
    state.sessions.splice(index, 1);
    clearSessionCookie(res);
    saveState().catch((err) => console.error('[saveState]', err));
    return next();
  }
  const user = state.users.find((item) => item.id === session.userId);
  if (!user) {
    state.sessions.splice(index, 1);
    clearSessionCookie(res);
    saveState().catch((err) => console.error('[saveState]', err));
    return next();
  }
  const lastSeenMs = new Date(session.lastSeenAt || session.createdAt || 0).getTime();
  if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs > 60 * 1000) session.lastSeenAt = new Date(nowMs).toISOString();
  req.session = session;
  req.user = user;
  return next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendPublicHtml(res, fileName) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', fileName));
}

function createMailer() {
  const smtp = state.settings.smtp;
  if (!smtp.enabled) throw new Error('邮件发送未启用');
  if (!smtp.host || !smtp.from) throw new Error('请先配置 SMTP 主机和发件人');
  const key = JSON.stringify({
    host: smtp.host,
    port: Number(smtp.port || 465),
    secure: Boolean(smtp.secure),
    username: smtp.username,
    passwordEnc: smtp.passwordEnc,
    from: smtp.from
  });
  if (cachedMailer && cachedMailerKey === key) return cachedMailer;
  cachedMailerKey = key;
  cachedMailer = nodemailer.createTransport({
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    host: smtp.host,
    port: Number(smtp.port || 465),
    secure: Boolean(smtp.secure),
    auth: smtp.username ? {
      user: smtp.username,
      pass: decryptSecret(smtp.passwordEnc)
    } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  return cachedMailer;
}

async function sendMail({ to, subject, text }) {
  const recipients = String(to || state.settings.smtp.logRecipients || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('请先填写收件人');
  const transporter = createMailer();
  const startedAt = Date.now();
  try {
    const info = await transporter.sendMail({
      from: state.settings.smtp.from,
      to: recipients.join(','),
      subject,
      text
    });
    return { info, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    error.elapsedMs = Date.now() - startedAt;
    throw error;
  }
}

function resetMailerCache() {
  if (cachedMailer && typeof cachedMailer.close === 'function') cachedMailer.close();
  cachedMailer = null;
  cachedMailerKey = '';
}

async function warmMailer(reason = 'startup') {
  if (!state.settings.smtp.enabled || !state.settings.smtp.host || !state.settings.smtp.from) return;
  const startedAt = Date.now();
  try {
    await createMailer().verify();
    const elapsedMs = Date.now() - startedAt;
    addLog('system.smtp_ready', null, { reason, elapsedMs });
    await saveState();
    console.log(`[smtp] ready in ${elapsedMs}ms (${reason})`);
  } catch (error) {
    addLog('system.smtp_warm_failed', null, { reason, elapsedMs: Date.now() - startedAt, message: error.message }, 'warn');
    await saveState().catch(() => {});
    console.warn(`[smtp] warm failed (${reason}): ${error.message}`);
  }
}

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'none'"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '192kb' }));
app.use(originGuard);
app.use(attachSession);
app.use(csrfGuard);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const captchaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false
});

const publicCodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const publicDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function uploadFiles(req, res, next) {
  const dynamicUpload = multer({
    dest: tempDir,
    limits: {
      fileSize: getMaxFileSizeMb() * 1024 * 1024,
      files: getMaxFilesPerUpload()
    }
  });
  return dynamicUpload.array('files', getMaxFilesPerUpload())(req, res, next);
}

app.use('/api/', apiLimiter);

app.get('/api/branding', (req, res) => {
  res.json({
    siteName: state.settings.siteName || defaultSettings.siteName,
    icpNumber: state.settings.icpNumber || '',
    legalNotice: state.settings.legalNotice || ''
  });
});

app.get('/api/status', (req, res) => {
  const quota = getStorageQuotaMb();
  res.json({
    initialized: state.users.length > 0,
    authenticated: Boolean(req.user),
    maxFileSizeMb: getMaxFileSizeMb(),
    maxFilesPerUpload: getMaxFilesPerUpload(),
    retentionHours: getRetentionHours(),
    publicBaseUrl: state.settings.publicBaseUrl || requestBaseUrl(req),
    storageQuotaMb: quota,
    storageUsedBytes: quota > 0 ? getCurrentStorageBytes() : 0,
    registrationEnabled: Boolean(state.settings.registrationEnabled) && Boolean(state.settings.smtp.enabled),
    webInitAvailable: state.users.length === 0 && Boolean(String(process.env.INIT_TOKEN || '').trim())
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'JiahaoDrop',
    time: nowIso(),
    initialized: state.users.length > 0,
    retentionHours: getRetentionHours()
  });
});

app.get('/api/captcha', captchaLimiter, (req, res) => {
  res.json({ captcha: createCaptcha() });
});

app.post('/api/setup', authLimiter, requireSetup, asyncRoute(async (req, res) => {
  const initToken = String(process.env.INIT_TOKEN || '').trim();
  if (!initToken) return res.status(403).json({ error: 'Web 初始化未启用，请通过命令行 (node server.js --init) 或环境变量 (ADMIN_USERNAME / ADMIN_PASSWORD) 初始化' });
  if (!req.body.initToken || !timingSafeEqualText(String(req.body.initToken), initToken)) {
    return res.status(403).json({ error: '初始化令牌不正确' });
  }
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const email = normalizeEmail(req.body.email);
  if (!verifyCaptcha(req.body.captchaId, req.body.captchaAnswer)) return res.status(400).json({ error: '验证码错误或已过期' });
  if (!validateUsername(username)) return res.status(400).json({ error: '用户名需为 3-32 位小写字母、数字、点、横线或下划线' });
  if (!validatePassword(password)) return res.status(400).json({ error: '密码长度需为 8-128 位' });
  if (!validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  const user = {
    id: randomId(),
    username,
    email,
    passwordHash: await hashPassword(password),
    role: 'super_admin',
    disabled: false,
    createdAt: nowIso()
  };
  state.users.push(user);
  addLog('system.initialized', req, { username });
  await saveState();
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/login', authLimiter, asyncRoute(async (req, res) => {
  const ip = clientIp(req);
  if (checkBruteForce(ip)) {
    return res.status(429).json({ error: '登录尝试过于频繁，请 1 分钟后再试' });
  }
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  if (!verifyCaptcha(req.body.captchaId, req.body.captchaAnswer)) return res.status(400).json({ error: '验证码错误或已过期' });
  const user = state.users.find((item) => item.username === username);
  if (!user || user.disabled || !(await verifyPassword(password, user.passwordHash))) {
    recordLoginFailure(ip);
    addLog('auth.login_failed', req, { username }, 'warn');
    await saveState();
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  await issueSession(req, res, user, { method: 'password' });
}));

app.post('/api/login/email', authLimiter, asyncRoute(async (req, res) => {
  const startedAt = Date.now();
  const ip = clientIp(req);
  if (checkBruteForce(ip)) return res.status(429).json({ error: '登录尝试过于频繁，请 1 分钟后再试' });
  if (!state.settings.smtp.enabled) return res.status(403).json({ error: '邮箱登录未启用，请使用账号密码登录' });
  if (!verifyCaptcha(req.body.captchaId, req.body.captchaAnswer)) return res.status(400).json({ error: '验证码错误或已过期' });
  const email = normalizeEmail(req.body.email);
  if (!validateEmail(email) || !email) return res.status(400).json({ error: '邮箱格式不正确' });
  const user = state.users.find((item) => item.email === email && !item.disabled);
  if (!user) {
    recordLoginFailure(ip);
    addLog('auth.email_login_unknown', req, { email: maskEmail(email) }, 'warn');
    await saveState();
    await ensureMinResponseTime(startedAt, 600);
    return res.status(202).json({
      requiresEmailCode: true,
      emailChallengeId: randomId(12),
      maskedEmail: maskEmail(email),
      message: '如果邮箱已绑定可用账号，验证码会发送到该邮箱'
    });
  }
  const challenge = createEmailChallenge(user);
  const storedChallenge = getEmailChallenge(challenge.challengeId);
  if (storedChallenge) storedChallenge.purpose = 'email_login';
  try {
    const mailResult = await sendMail({
      to: user.email,
      subject: 'JiahaoDrop 登录验证码',
      text: `你的 JiahaoDrop 登录验证码是：${challenge.code}\n验证码 30 分钟内有效。如非本人操作，请忽略。`
    });
    addLog('auth.email_login_code_sent', req, { username: user.username, email: maskEmail(user.email), elapsedMs: mailResult.elapsedMs });
  } catch (error) {
    deleteEmailChallenge(challenge.challengeId);
    addLog('auth.email_login_code_failed_to_send', req, { username: user.username, email: maskEmail(user.email), elapsedMs: error.elapsedMs || 0 }, 'warn');
    await saveState();
    return res.status(502).json({ error: '邮件发送失败，请稍后重试' });
  }
  await saveState();
  await ensureMinResponseTime(startedAt, 600);
  res.status(202).json({
    requiresEmailCode: true,
    emailChallengeId: challenge.challengeId,
    maskedEmail: maskEmail(user.email),
    message: '如果邮箱已绑定可用账号，验证码会发送到该邮箱'
  });
}));

app.post('/api/login/email/verify', authLimiter, asyncRoute(async (req, res) => {
  const ip = clientIp(req);
  if (checkBruteForce(ip)) return res.status(429).json({ error: '登录尝试过于频繁，请 1 分钟后再试' });
  const challengeId = String(req.body.emailChallengeId || '');
  const code = String(req.body.emailCode || '');
  const challenge = getEmailChallenge(challengeId);
  if (!challenge || challenge.purpose !== 'email_login') {
    recordLoginFailure(ip);
    return res.status(400).json({ error: '邮箱验证码错误或已过期' });
  }
  const user = state.users.find((item) => item.id === challenge.userId && !item.disabled);
  if (!user) {
    deleteEmailChallenge(challengeId);
    recordLoginFailure(ip);
    return res.status(400).json({ error: '邮箱验证码错误或已过期' });
  }
  if (!verifyEmailChallenge(challengeId, user.id, code)) {
    recordLoginFailure(ip);
    addLog('auth.email_login_code_failed', req, { username: user.username }, 'warn');
    await saveState();
    return res.status(400).json({ error: '邮箱验证码错误或已过期' });
  }
  await issueSession(req, res, user, { method: 'email' });
}));

app.post('/api/logout', asyncRoute(async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[sessionCookie];
  const tokenHash = rawToken ? hashToken(rawToken) : '';
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((item) => item.id !== req.session?.id && item.tokenHash !== tokenHash);
  if (req.user) addLog('auth.logout', req);
  if (state.sessions.length !== before || req.user) await saveState();
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.post('/api/register', authLimiter, asyncRoute(async (req, res) => {
  if (!state.settings.registrationEnabled || !state.settings.smtp.enabled) return res.status(403).json({ error: '注册功能未启用' });
  const ip = clientIp(req);
  if (checkBruteForce(ip)) return res.status(429).json({ error: '操作过于频繁，请 1 分钟后再试' });
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const email = normalizeEmail(req.body.email);
  if (!validateUsername(username)) return res.status(400).json({ error: '用户名需为 3-32 位小写字母、数字、点、横线或下划线' });
  if (!validatePassword(password)) return res.status(400).json({ error: '密码长度需为 8-128 位' });
  if (!validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!email) return res.status(400).json({ error: '注册需要填写邮箱' });
  if (state.users.some((item) => item.username === username)) return res.status(409).json({ error: '用户名已存在' });
  if (state.users.some((item) => item.email === email)) return res.status(409).json({ error: '该邮箱已被注册' });
  if (!verifyCaptcha(req.body.captchaId, req.body.captchaAnswer)) return res.status(400).json({ error: '验证码错误或已过期' });
  const challenge = createEmailChallenge({ id: '_register_' });
  // scrypt 哈希和 SMTP 发送并行，节省 ~2-5 秒
  const [passwordHash, mailResult] = await Promise.all([
    hashPassword(password),
    sendMail({
      to: email,
      subject: 'JiahaoDrop 注册验证码',
      text: `你的 JiahaoDrop 注册验证码是：${challenge.code}\n验证码 30 分钟内有效。如非本人操作，请忽略。`
    }).catch((error) => {
      deleteEmailChallenge(challenge.challengeId);
      addLog('auth.register_code_failed_to_send', req, { username, email: maskEmail(email), elapsedMs: error.elapsedMs || 0 }, 'warn');
      throw error;
    })
  ]);
  const storedChallenge = getEmailChallenge(challenge.challengeId);
  if (storedChallenge) storedChallenge.registration = { username, email, passwordHash };
  addLog('auth.register_code_sent', req, { username, email: maskEmail(email), elapsedMs: mailResult.elapsedMs });
  await saveState();
  res.status(202).json({ requiresEmailCode: true, emailChallengeId: challenge.challengeId, maskedEmail: maskEmail(email), message: '已发送注册验证码' });
}));

app.post('/api/register/verify', authLimiter, asyncRoute(async (req, res) => {
  if (!state.settings.registrationEnabled || !state.settings.smtp.enabled) return res.status(403).json({ error: '注册功能未启用' });
  const ip = clientIp(req);
  if (checkBruteForce(ip)) return res.status(429).json({ error: '操作过于频繁，请 1 分钟后再试' });
  const challengeId = String(req.body.emailChallengeId || '');
  const code = String(req.body.emailCode || '');
  const challenge = getEmailChallenge(challengeId);
  if (!challenge || !challenge.registration) return res.status(400).json({ error: '验证码已过期或无效' });
  challenge.attempts += 1;
  const ok = code && timingSafeEqualText(hashToken(code), challenge.codeHash);
  if (!ok) {
    if (challenge.attempts >= 5) deleteEmailChallenge(challengeId);
    return res.status(400).json({ error: '验证码错误' });
  }
  const { username, email, passwordHash } = challenge.registration;
  if (state.users.some((u) => u.username === username || u.email === email)) {
    deleteEmailChallenge(challengeId);
    return res.status(409).json({ error: '用户名或邮箱已被占用' });
  }
  const user = { id: randomId(), username, email, passwordHash, role: 'user', disabled: false, createdAt: nowIso() };
  state.users.push(user);
  deleteEmailChallenge(challengeId);
  addLog('auth.registered', req, { username, email: maskEmail(email) });
  const token = randomId(32);
  const issuedAt = nowIso();
  const expiresAt = addHours(issuedAt, sessionAbsoluteHours());
  const session = { id: randomId(), userId: user.id, tokenHash: hashToken(token), csrfToken: randomId(24), expiresAt, createdAt: issuedAt, lastSeenAt: issuedAt };
  state.sessions.push(session);
  await saveState();
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user), csrfToken: session.csrfToken });
}));

app.post('/api/account/email', requireAuth, asyncRoute(async (req, res) => {
  if (!state.settings.smtp.enabled) return res.status(403).json({ error: '邮件功能未启用' });
  const newEmail = normalizeEmail(req.body.email);
  if (!validateEmail(newEmail)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!newEmail) return res.status(400).json({ error: '请输入新邮箱' });
  if (state.users.some((u) => u.email === newEmail && u.id !== req.user.id)) return res.status(409).json({ error: '该邮箱已被其他账号使用' });
  if (!verifyCaptcha(req.body.captchaId, req.body.captchaAnswer)) return res.status(400).json({ error: '验证码错误或已过期' });
  const challenge = createEmailChallenge(req.user);
  const storedChallenge = getEmailChallenge(challenge.challengeId);
  if (storedChallenge) storedChallenge.emailChange = { newEmail };
  await sendMail({
    to: newEmail,
    subject: 'JiahaoDrop 邮箱变更验证码',
    text: `你的 JiahaoDrop 邮箱变更验证码是：${challenge.code}\n验证码 30 分钟内有效。如非本人操作，请忽略。`
  });
  addLog('account.email_change_sent', req, { newEmail: maskEmail(newEmail) });
  await saveState();
  res.json({ requiresEmailCode: true, emailChallengeId: challenge.challengeId, maskedEmail: maskEmail(newEmail) });
}));

app.put('/api/account/email', requireAuth, asyncRoute(async (req, res) => {
  const challengeId = String(req.body.emailChallengeId || '');
  const code = String(req.body.emailCode || '');
  const challenge = getEmailChallenge(challengeId);
  if (!challenge || !challenge.emailChange || challenge.userId !== req.user.id) return res.status(400).json({ error: '验证码已过期或无效' });
  challenge.attempts += 1;
  const ok = code && timingSafeEqualText(hashToken(code), challenge.codeHash);
  if (!ok) {
    if (challenge.attempts >= 5) deleteEmailChallenge(challengeId);
    return res.status(400).json({ error: '验证码错误' });
  }
  const { newEmail } = challenge.emailChange;
  if (state.users.some((u) => u.email === newEmail && u.id !== req.user.id)) {
    deleteEmailChallenge(challengeId);
    return res.status(409).json({ error: '该邮箱已被其他账号使用' });
  }
  req.user.email = newEmail;
  deleteEmailChallenge(challengeId);
  addLog('account.email_changed', req, { newEmail: maskEmail(newEmail) });
  await saveState();
  res.json({ ok: true, user: publicUser(req.user) });
}));

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), csrfToken: req.session.csrfToken });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const totalBytes = getCurrentStorageBytes();
  const quota = getStorageQuotaMb();
  res.json({
    stats: {
      users: state.users.length,
      activeUsers: state.users.filter((user) => !user.disabled).length,
      files: state.files.length,
      totalBytes,
      sessions: state.sessions.length,
      storageQuotaMb: quota,
      storageUsedBytes: totalBytes,
      retentionHours: getRetentionHours(),
      maxFileSizeMb: getMaxFileSizeMb(),
      maxFilesPerUpload: getMaxFilesPerUpload(),
      sessionHours: getSessionHours(),
      sessionIdleMinutes: getSessionIdleMinutes(),
      registrationEnabled: Boolean(state.settings.registrationEnabled),
      smtpEnabled: Boolean(state.settings.smtp.enabled)
    }
  });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: state.users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username)) });
});

app.post('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  const email = normalizeEmail(req.body.email);
  const requestedRole = req.body.role;
  let role = 'user';
  if (requestedRole === 'super_admin') {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: '只有超级管理员可以创建超级管理员' });
    role = 'super_admin';
  } else if (requestedRole === 'admin') {
    role = 'admin';
  }
  if (!validateUsername(username)) return res.status(400).json({ error: '用户名需为 3-32 位小写字母、数字、点、横线或下划线' });
  if (!validatePassword(password)) return res.status(400).json({ error: '密码长度需为 8-128 位' });
  if (!validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (state.users.some((item) => item.username === username)) return res.status(409).json({ error: '用户名已存在' });
  if (email && state.users.some((item) => item.email === email)) return res.status(409).json({ error: '邮箱已被其他用户使用' });
  const user = {
    id: randomId(),
    username,
    email,
    passwordHash: await hashPassword(password),
    role,
    disabled: false,
    createdAt: nowIso()
  };
  state.users.push(user);
  addLog('admin.user_created', req, { username, role });
  await saveState();
  res.status(201).json({ user: publicUser(user) });
}));

function isInitialAdmin(user) {
  const admins = state.users.filter((u) => u.role === 'super_admin').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return admins.length > 0 && admins[0].id === user.id;
}

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const user = state.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  // 普通管理员不能修改超级管理员账号
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: '无权修改超级管理员账号' });
  if (req.body.role && ['super_admin', 'admin', 'user'].includes(req.body.role)) {
    // 禁止任何人修改自己的角色
    if (user.id === req.user.id) return res.status(400).json({ error: '不能修改自己的角色' });
    // 只有超级管理员可以修改他人角色
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: '只有超级管理员可以修改用户角色' });
    // 禁止降级初始超级管理员
    if (isInitialAdmin(user) && req.body.role !== 'super_admin') return res.status(400).json({ error: '不能降级初始超级管理员账号' });
    // 禁止把最后一个启用的超级管理员降级
    if (user.role === 'super_admin' && req.body.role !== 'super_admin') {
      const otherSuperAdmins = state.users.filter((u) => u.role === 'super_admin' && !u.disabled && u.id !== user.id);
      if (otherSuperAdmins.length === 0) return res.status(400).json({ error: '不能将最后一个超级管理员降级' });
    }
    user.role = req.body.role;
    // 最终安全检查：确保至少有一个启用的超级管理员
    const hasSuperAdmin = state.users.some((u) => u.role === 'super_admin' && !u.disabled);
    if (!hasSuperAdmin) {
      user.role = 'super_admin';
      return res.status(400).json({ error: '系统必须保留至少一个超级管理员' });
    }
  }
  if (req.body.email !== undefined) {
    const email = normalizeEmail(req.body.email);
    if (!validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
    if (email && state.users.some((item) => item.id !== user.id && item.email === email)) return res.status(409).json({ error: '邮箱已被其他用户使用' });
    user.email = email;
  }
  if (typeof req.body.disabled === 'boolean') {
    if (user.id === req.user.id && req.body.disabled) return res.status(400).json({ error: '不能禁用当前登录管理员' });
    user.disabled = req.body.disabled;
  }
  if (req.body.password !== undefined) {
    const password = String(req.body.password || '');
    if (!validatePassword(password)) return res.status(400).json({ error: '密码长度需为 8-128 位' });
    user.passwordHash = await hashPassword(password);
    // 无条件删除目标用户所有会话
    const isSelf = user.id === req.user.id;
    state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    // 若修改的是自己的密码，签发全新会话（新 token + 新 csrfToken）
    if (isSelf) {
      const newToken = randomId(32);
      const newSession = {
        id: randomId(),
        userId: user.id,
        tokenHash: hashToken(newToken),
        csrfToken: randomId(24),
        expiresAt: addHours(nowIso(), sessionAbsoluteHours()),
        createdAt: nowIso(),
        lastSeenAt: nowIso()
      };
      state.sessions.push(newSession);
      req.session = newSession;
      setSessionCookie(res, newToken);
    }
  }
  addLog('admin.user_updated', req, { username: user.username, role: user.role, disabled: user.disabled, emailChanged: req.body.email !== undefined, passwordChanged: req.body.password !== undefined });
  await saveState();
  res.json({ user: publicUser(user) });
}));

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const user = state.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.id === req.user.id) return res.status(400).json({ error: '不能删除当前登录管理员' });
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: '无权删除超级管理员账号' });
  if (isInitialAdmin(user)) return res.status(400).json({ error: '不能删除初始管理员账号' });
  const ownedFiles = state.files.filter((file) => file.ownerId === user.id);
  state.users = state.users.filter((item) => item.id !== user.id);
  state.sessions = state.sessions.filter((session) => session.userId !== user.id);
  state.files = state.files.filter((file) => file.ownerId !== user.id);
  await Promise.all(ownedFiles.map((file) => fsp.rm(filePathFor(file), { force: true }).catch(() => {})));
  addLog('admin.user_deleted', req, { username: user.username, removedFiles: ownedFiles.length });
  await saveState();
  res.json({ ok: true });
}));

app.get('/api/admin/settings', requireAuth, requireSuperAdmin, (req, res) => {
  res.json({ settings: publicSettings() });
});

app.patch('/api/admin/settings', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  const smtpTouched = Boolean(req.body.smtp && typeof req.body.smtp === 'object');
  if (req.body.storageDir !== undefined) {
    const target = validateStorageDir(req.body.storageDir);
    await fsp.mkdir(target, { recursive: true, mode: 0o700 });
    state.settings.storageDir = target;
  }
  if (req.body.publicBaseUrl !== undefined) {
    const publicBaseUrl = normalizePublicBaseUrl(req.body.publicBaseUrl);
    if (String(req.body.publicBaseUrl || '').trim() && !publicBaseUrl) return res.status(400).json({ error: '访问域名必须是 http 或 https 开头的完整地址' });
    state.settings.publicBaseUrl = publicBaseUrl;
  }
  if (req.body.maxFileSizeMb !== undefined) {
    state.settings.maxFileSizeMb = validateMaxFileSizeMb(req.body.maxFileSizeMb);
  }
  if (req.body.storageQuotaMb !== undefined) {
    state.settings.storageQuotaMb = validateStorageQuotaMb(req.body.storageQuotaMb);
  }
  if (req.body.smtp && typeof req.body.smtp === 'object') {
    const smtp = req.body.smtp;
    const port = smtp.port !== undefined && smtp.port !== '' ? Number(smtp.port) : 465;
    if (!Number.isFinite(port) || port < 1 || port > 65535) return res.status(400).json({ error: 'SMTP 端口不正确' });
    state.settings.smtp.enabled = Boolean(smtp.enabled);
    const smtpHost = String(smtp.host || '').trim();
    if (smtpHost) await validateSmtpHost(smtpHost);
    state.settings.smtp.host = smtpHost;
    state.settings.smtp.port = port;
    state.settings.smtp.secure = Boolean(smtp.secure);
    state.settings.smtp.username = String(smtp.username || '').trim();
    state.settings.smtp.from = String(smtp.from || '').trim();
    state.settings.smtp.logRecipients = String(smtp.logRecipients || '').trim();
    if (smtp.clearPassword) state.settings.smtp.passwordEnc = '';
    if (smtp.password) state.settings.smtp.passwordEnc = encryptSecret(String(smtp.password));
    resetMailerCache();
  }
  if (req.body.registrationEnabled !== undefined) {
    state.settings.registrationEnabled = Boolean(req.body.registrationEnabled);
  }
  if (req.body.maxFilesPerUpload !== undefined) {
    const n = Math.round(Number(req.body.maxFilesPerUpload));
    if (!Number.isFinite(n) || n < 1 || n > 100) return res.status(400).json({ error: '单次最大上传文件数需在 1-100 之间' });
    state.settings.maxFilesPerUpload = n;
  }
  if (req.body.retentionHours !== undefined) {
    const n = Math.round(Number(req.body.retentionHours));
    if (!Number.isFinite(n) || n < 1 || n > 720) return res.status(400).json({ error: '默认保留时长需在 1-720 小时之间' });
    state.settings.retentionHours = n;
  }
  if (req.body.sessionHours !== undefined) {
    const n = Math.round(Number(req.body.sessionHours));
    if (!Number.isFinite(n) || n < 1 || n > 720) return res.status(400).json({ error: '会话时长需在 1-720 小时之间' });
    state.settings.sessionHours = n;
  }
  if (req.body.sessionIdleMinutes !== undefined) {
    const n = Math.round(Number(req.body.sessionIdleMinutes));
    if (!Number.isFinite(n) || n < 1 || n > 10080) return res.status(400).json({ error: '空闲超时需在 1-10080 分钟之间' });
    state.settings.sessionIdleMinutes = n;
  }
  if (req.body.siteName !== undefined) state.settings.siteName = String(req.body.siteName).trim().slice(0, 30) || defaultSettings.siteName;
  if (req.body.icpNumber !== undefined) state.settings.icpNumber = String(req.body.icpNumber).trim().slice(0, 60);
  if (req.body.legalNotice !== undefined) state.settings.legalNotice = String(req.body.legalNotice).trim().slice(0, 100);
  if (req.body.logRetentionHours !== undefined) {
    const n = Math.round(Number(req.body.logRetentionHours));
    if (!Number.isFinite(n) || n < 24 || n > 8760) return res.status(400).json({ error: '日志留存时间需在 24-8760 小时之间' });
    state.settings.logRetentionHours = n;
  }
  if (req.body.logMaxSystem !== undefined) {
    const n = Math.round(Number(req.body.logMaxSystem));
    if (!Number.isFinite(n) || n < 50 || n > 5000) return res.status(400).json({ error: '系统日志上限需在 50-5000 之间' });
    state.settings.logMaxSystem = n;
  }
  if (req.body.logMaxSecurity !== undefined) {
    const n = Math.round(Number(req.body.logMaxSecurity));
    if (!Number.isFinite(n) || n < 50 || n > 5000) return res.status(400).json({ error: '安全日志上限需在 50-5000 之间' });
    state.settings.logMaxSecurity = n;
  }
  if (req.body.logMaxUser !== undefined) {
    const n = Math.round(Number(req.body.logMaxUser));
    if (!Number.isFinite(n) || n < 50 || n > 5000) return res.status(400).json({ error: '用户日志上限需在 50-5000 之间' });
    state.settings.logMaxUser = n;
  }
  addLog('admin.settings_updated', req, { storageDir: state.settings.storageDir, publicBaseUrl: state.settings.publicBaseUrl, maxFileSizeMb: getMaxFileSizeMb(), storageQuotaMb: getStorageQuotaMb(), smtpEnabled: state.settings.smtp.enabled, registrationEnabled: state.settings.registrationEnabled });
  await saveState();
  if (smtpTouched) warmMailer('settings_updated').catch((err) => console.error('[warmMailer]', err));
  res.json({ settings: publicSettings() });
}));

app.post('/api/admin/email/test', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  const to = String(req.body.to || '').trim();
  if (to) {
    for (const r of to.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      if (!validateEmail(r)) return res.status(400).json({ error: `收件人格式不正确: ${r}` });
    }
  }
  try {
    const mailResult = await sendMail({
      to: req.body.to,
      subject: 'JiahaoDrop 邮件测试',
      text: `这是一封来自 JiahaoDrop 的测试邮件。\n发送时间：${nowIso()}\n操作者：${req.user.username}`
    });
    addLog('admin.email_test_sent', req, { to: req.body.to || state.settings.smtp.logRecipients, elapsedMs: mailResult.elapsedMs });
    await saveState();
    res.json({ ok: true });
  } catch (error) {
    const msg = error.message || '邮件发送失败';
    if (msg.includes('未启用') || msg.includes('请先配置') || msg.includes('请先填写') || msg.includes('不允许使用')) return res.status(400).json({ error: msg });
    addLog('admin.email_test_failed', req, { error: msg });
    if (error.code === 'ESOCKET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return res.status(502).json({ error: 'SMTP 连接失败，请检查主机和端口配置' });
    if (error.code === 'EENVELOPE' || error.code === 'EAUTH') return res.status(502).json({ error: 'SMTP 认证失败，请检查用户名和密码' });
    return res.status(502).json({ error: '邮件发送失败，请检查 SMTP 配置' });
  }
}));

app.get('/api/admin/logs', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
  res.json({ logs: [...state.logs].reverse().slice(0, limit) });
});

app.delete('/api/admin/logs', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const kept = state.logs.slice(-10);
  state.logs = kept;
  addLog('admin.logs_cleared', req, { keptEntries: kept.length });
  await saveState();
  res.json({ ok: true });
}));

app.post('/api/admin/logs/email', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  const to = String(req.body.to || '').trim();
  if (to) {
    for (const r of to.split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
      if (!validateEmail(r)) return res.status(400).json({ error: `收件人格式不正确: ${r}` });
    }
  }
  const hours = Math.min(Math.max(Number(req.body.sinceHours || 24), 1), 168);
  const since = Date.now() - hours * 60 * 60 * 1000;
  const logs = state.logs.filter((log) => new Date(log.at).getTime() >= since);
  const text = logsAsText(logs) || `最近 ${hours} 小时没有日志。`;
  await sendMail({
    to: req.body.to,
    subject: `JiahaoDrop 最近 ${hours} 小时日志`,
    text
  });
  addLog('admin.logs_emailed', req, { sinceHours: hours, count: logs.length, to: req.body.to || state.settings.smtp.logRecipients });
  await saveState();
  res.json({ ok: true, count: logs.length });
}));

app.post('/api/admin/reset', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  // Delete all stored files — validate path is within safe boundary
  const storageDir = path.resolve(state.settings.storageDir || defaultSettings.storageDir);
  const defaultDir = path.resolve(defaultSettings.storageDir);
  const dataRoot = path.resolve(config.dataDir) + path.sep;
  // Storage dir must be within dataDir or equal to the default storage dir
  const isSafePath = (storageDir + path.sep).startsWith(dataRoot) || storageDir === defaultDir;
  if (!isSafePath) {
    addLog('admin.reset_blocked', req, { storageDir, reason: '目录不在安全范围内' });
    return res.status(400).json({ error: '存储目录不在安全范围内，无法执行重置' });
  }
  try {
    const entries = await fsp.readdir(storageDir).catch(() => []);
    await Promise.all(entries.map((name) => fsp.rm(path.join(storageDir, name), { force: true, recursive: true }).catch(() => {})));
  } catch {}
  // Delete temp files
  try {
    const tmpDir = path.join(config.dataDir, 'tmp');
    const tmpEntries = await fsp.readdir(tmpDir).catch(() => []);
    await Promise.all(tmpEntries.map((name) => fsp.rm(path.join(tmpDir, name), { force: true }).catch(() => {})));
  } catch {}
  // Reset state to defaults
  state.users = [];
  state.files = [];
  state.sessions = [];
  state.logs = [];
  state.emailChallenges = [];
  state.settings = structuredClone(defaultSettings);
  await saveState();
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.post('/api/files', requireAuth, uploadFiles, asyncRoute(async (req, res) => withUploadLock(async () => {
  const uploaded = Array.isArray(req.files) ? req.files : [];
  if (uploaded.length === 0) return res.status(400).json({ error: '请选择要上传的文件' });

  const blockedExts = new Set([
    'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'ps1', 'vbs', 'wsf', 'hta', 'cpl', 'pif', 'jse', 'wsh',
    'sh', 'bash', 'csh', 'ksh', 'zsh', 'run', 'elf', 'appimage',
    'command', 'pkg', 'dmg', 'dylib', 'so', 'deb', 'rpm'
  ]);
  const blocked = uploaded.filter((file) => {
    const ext = path.extname(sanitizeOriginalName(file.originalname)).toLowerCase().replace('.', '');
    return ext && blockedExts.has(ext);
  });
  if (blocked.length > 0) {
    await Promise.all(uploaded.map((file) => fsp.rm(file.path, { force: true }).catch(() => {})));
    const names = blocked.map((f) => sanitizeOriginalName(f.originalname)).join('、');
    return res.status(400).json({ error: `可执行文件不允许直接上传，请压缩为 zip 后再试: ${names}` });
  }

  let retentionHours = parseRetentionHours(req.body.retentionHours);
  // 普通用户不能设置永久保留
  if (retentionHours === 0 && req.user.role === 'user') retentionHours = getRetentionHours();
  const maxDownloads = validateMaxDownloads(req.body.maxDownloads);
  const now = nowIso();
  const code = makeCode();
  const shouldZipBatch = uploaded.length > 1;
  const quota = getStorageQuotaMb();
  if (quota > 0) {
    const currentBytes = getCurrentStorageBytes();
    const incomingBytes = uploaded.reduce((sum, file) => sum + file.size, 0);
    const quotaBytes = quota * 1024 * 1024;
    if (currentBytes + incomingBytes > quotaBytes) {
      await Promise.all(uploaded.map((file) => fsp.rm(file.path, { force: true }).catch(() => {})));
      const usedMb = Math.round(currentBytes / 1024 / 1024);
      return res.status(507).json({ error: `存储空间不足，已用 ${usedMb} MB / ${quota} MB，无法上传本次 ${Math.round(incomingBytes / 1024 / 1024)} MB` });
    }
  }
  const created = [];
  const moved = [];
  try {
    await fsp.mkdir(getStorageDir(), { recursive: true, mode: 0o700 });
    if (shouldZipBatch) {
      const storageDir = getStorageDir();
      const storedName = `${randomId(16)}.zip`;
      const target = filePathFor({ storedName, storageDir });
      const zipSize = await createZipFromUploadedFiles(uploaded, target);
      if (quota > 0) {
        const currentBytes = getCurrentStorageBytes();
        const quotaBytes = quota * 1024 * 1024;
        if (currentBytes + zipSize > quotaBytes) {
          await fsp.rm(target, { force: true }).catch(() => {});
          await Promise.all(uploaded.map((file) => fsp.rm(file.path, { force: true }).catch(() => {})));
          const usedMb = Math.round(currentBytes / 1024 / 1024);
          return res.status(507).json({ error: `存储空间不足，已用 ${usedMb} MB / ${quota} MB，自动打包后体积超限` });
        }
      }
      moved.push({ storedName, storageDir });
      const record = {
        id: randomId(),
        ownerId: req.user.id,
        code,
        originalName: zipDisplayName(uploaded, code),
        storedName,
        storageDir,
        size: zipSize,
        mimeType: 'application/zip',
        createdAt: now,
        expiresAt: addHours(now, retentionHours),
        retentionHours,
        maxDownloads,
        bundle: {
          sourceCount: uploaded.length
        },
        downloadCount: 0,
        downloadLog: []
      };
      state.files.push(record);
      created.push(record);
      await Promise.all(uploaded.map((file) => fsp.rm(file.path, { force: true }).catch(() => {})));
    } else {
      for (const file of uploaded) {
        const storedName = `${randomId(16)}.bin`;
        const storageDir = getStorageDir();
        const target = filePathFor({ storedName, storageDir });
        try {
          await fsp.rename(file.path, target);
        } catch (err) {
          if (err.code !== 'EXDEV') throw err;
          await fsp.copyFile(file.path, target);
          await fsp.rm(file.path, { force: true });
        }
        moved.push({ storedName, storageDir });
        const record = {
          id: randomId(),
          ownerId: req.user.id,
          code,
          originalName: sanitizeOriginalName(file.originalname),
          storedName,
          storageDir,
          size: file.size,
          mimeType: file.mimetype || 'application/octet-stream',
          createdAt: now,
          expiresAt: addHours(now, retentionHours),
          retentionHours,
          maxDownloads,
          downloadCount: 0,
          downloadLog: []
        };
        state.files.push(record);
        created.push(record);
      }
    }
    addLog('files.uploaded', req, {
      count: created.length,
      bytes: created.reduce((sum, file) => sum + file.size, 0),
      batchCode: code,
      sourceCount: uploaded.length,
      zipped: shouldZipBatch
    });
    await saveState();
  } catch (error) {
    await Promise.all(uploaded.map((file) => fsp.rm(file.path, { force: true }).catch(() => {})));
    await Promise.all(moved.map((file) => fsp.rm(filePathFor(file), { force: true }).catch(() => {})));
    throw error;
  }
  if (req.session) {
    req.session.lastSeenAt = new Date().toISOString();
    saveState().catch((err) => console.error('[saveState]', err));
  }
  res.status(201).json({
    files: created.map((file) => ({
      id: file.id,
      code: file.code,
      name: file.originalName,
      size: file.size,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      retentionHours: file.retentionHours,
      downloadCount: downloadCountFor(file),
      maxDownloads: normalizeMaxDownloads(file.maxDownloads),
      remainingDownloads: downloadsRemaining(file),
      shareUrl: shareUrlFor(file.code, req)
    }))
  });
})));

app.get('/api/files', requireAuth, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const files = state.files
    .filter((file) => file.ownerId === req.user.id && !isExpiredFile(file))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((file) => ({
      id: file.id,
      code: file.code,
      name: file.originalName,
      size: file.size,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      retentionHours: file.retentionHours || getRetentionHours(),
      downloadCount: downloadCountFor(file),
      maxDownloads: normalizeMaxDownloads(file.maxDownloads),
      remainingDownloads: downloadsRemaining(file),
      shareUrl: shareUrlFor(file.code, req)
    }));
  res.json({ files });
}));

// 超级管理员：查看所有用户文件概况
app.get('/api/admin/all-files', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const users = state.users
    .filter((u) => !u.disabled)
    .map((u) => {
      const userFiles = state.files.filter((f) => f.ownerId === u.id && !isExpiredFile(f));
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        fileCount: userFiles.length,
        totalSize: userFiles.reduce((sum, f) => sum + Number(f.size || 0), 0)
      };
    })
    .filter((u) => u.fileCount > 0)
    .sort((a, b) => b.fileCount - a.fileCount);
  res.json({ users });
}));

// 超级管理员：查看指定用户的文件列表
app.get('/api/admin/users/:userId/files', requireAuth, requireSuperAdmin, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const targetUser = state.users.find((u) => u.id === req.params.userId);
  if (!targetUser) return res.status(404).json({ error: '用户不存在' });
  const files = state.files
    .filter((f) => f.ownerId === targetUser.id && !isExpiredFile(f))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((file) => ({
      id: file.id,
      code: file.code,
      name: file.originalName,
      size: file.size,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      retentionHours: file.retentionHours || getRetentionHours(),
      downloadCount: downloadCountFor(file),
      maxDownloads: normalizeMaxDownloads(file.maxDownloads),
      remainingDownloads: downloadsRemaining(file),
      shareUrl: shareUrlFor(file.code, req),
      ownerId: file.ownerId
    }));
  res.json({ user: { id: targetUser.id, username: targetUser.username, role: targetUser.role }, files });
}));

app.get('/api/files/:id', requireAuth, asyncRoute(async (req, res) => {
  const file = state.files.find((item) => item.id === req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });
  if (file.ownerId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: '无权查看' });
  res.json({
    file: {
      id: file.id,
      code: file.code,
      name: file.originalName,
      size: file.size,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      retentionHours: file.retentionHours || getRetentionHours(),
      downloadCount: downloadCountFor(file),
      maxDownloads: normalizeMaxDownloads(file.maxDownloads),
      remainingDownloads: downloadsRemaining(file),
      downloadLog: (file.downloadLog || []).slice().reverse()
    }
  });
}));

app.patch('/api/files/:id', requireAuth, asyncRoute(async (req, res) => {
  const file = state.files.find((item) => item.id === req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });
  if (file.ownerId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: '无权修改该文件' });
  if (req.body.retentionHours !== undefined) {
    let retentionHours = parseRetentionHours(req.body.retentionHours);
    if (retentionHours === 0 && req.user.role === 'user') retentionHours = getRetentionHours();
    file.retentionHours = retentionHours;
    file.expiresAt = retentionHours === 0 ? null : addHours(nowIso(), retentionHours);
  }
  if (req.body.maxDownloads !== undefined) {
    file.maxDownloads = validateMaxDownloads(req.body.maxDownloads);
  }
  addLog('files.updated', req, {
    fileId: file.id,
    retentionHours: file.retentionHours || getRetentionHours(),
    maxDownloads: normalizeMaxDownloads(file.maxDownloads)
  });
  await saveState();
  res.json({ file: publicFilePayload(file, req) });
}));

app.get('/api/files/code/:code', requireAuth, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const code = normalizeReceiveCode(req.params.code);
  if (!validateReceiveCode(code)) return res.status(400).json({ error: '接收码格式不正确' });
  const file = state.files.find((item) => item.code === code && !isExpiredFile(item));
  if (!file) return res.status(404).json({ error: '取件码不存在或文件已过期' });
  if (!hasDownloadsRemaining(file)) return res.status(410).json({ error: '文件下载次数已用完' });
  res.json({ file: publicFilePayload(file, req) });
}));

app.get('/api/public/files/code/:code', publicCodeLimiter, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const ip = clientIp(req);
  if (checkPublicCodeFailures(ip)) return res.status(429).json({ error: '接收码尝试过于频繁，请稍后再试' });
  const code = normalizeReceiveCode(req.params.code);
  if (!validateReceiveCode(code)) {
    recordPublicCodeFailure(ip);
    return res.status(400).json({ error: '接收码格式不正确' });
  }
  const file = state.files.find((item) => item.code === code && !isExpiredFile(item));
  if (!file) {
    recordPublicCodeFailure(ip);
    return res.status(404).json({ error: '取件码不存在或文件已过期' });
  }
  if (!hasDownloadsRemaining(file)) return res.status(410).json({ error: '文件下载次数已用完' });
  clearPublicCodeFailures(ip);
  res.json({ file: publicFilePayload(file, req) });
}));

app.get('/api/files/:id/download', requireAuth, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const file = state.files.find((item) => item.id === req.params.id && !isExpiredFile(item));
  await handleFileDownload(file, req, res, { byCode: false, isPublic: false });
}));

app.get('/api/files/code/:code/download', requireAuth, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const code = normalizeReceiveCode(req.params.code);
  if (!validateReceiveCode(code)) return res.status(400).json({ error: '接收码格式不正确' });
  const file = state.files.find((item) => item.code === code && !isExpiredFile(item));
  await handleFileDownload(file, req, res, { byCode: true, isPublic: false });
}));

app.get('/api/public/files/code/:code/download', publicDownloadLimiter, asyncRoute(async (req, res) => {
  await cleanupExpired();
  const ip = clientIp(req);
  if (checkPublicCodeFailures(ip)) return res.status(429).json({ error: '接收码尝试过于频繁，请稍后再试' });
  const code = normalizeReceiveCode(req.params.code);
  if (!validateReceiveCode(code)) {
    recordPublicCodeFailure(ip);
    return res.status(400).json({ error: '接收码格式不正确' });
  }
  const file = state.files.find((item) => item.code === code && !isExpiredFile(item));
  if (!file) {
    recordPublicCodeFailure(ip);
    return res.status(404).json({ error: '取件码不存在或文件已过期' });
  }
  clearPublicCodeFailures(ip);
  await handleFileDownload(file, req, res, { byCode: true, isPublic: true });
}));

app.delete('/api/files/:id', requireAuth, asyncRoute(async (req, res) => {
  const file = state.files.find((item) => item.id === req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });
  if (file.ownerId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: '无权删除该文件' });
  state.files = state.files.filter((item) => item.id !== file.id);
  await fsp.rm(filePathFor(file), { force: true }).catch(() => {});
  addLog('files.deleted', req, { fileId: file.id, name: file.originalName });
  await saveState();
  res.json({ ok: true });
}));

app.get(['/app', '/app/', '/app/send', '/app/receive', '/app/files'], (req, res) => {
  sendPublicHtml(res, 'app.html');
});

app.get('/login', (req, res) => {
  sendPublicHtml(res, 'login.html');
});

app.get('/r/:code', (req, res) => {
  sendPublicHtml(res, 'receive.html');
});

app.get(['/admin', '/admin/'], (req, res) => {
  sendPublicHtml(res, 'admin.html');
});

app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  extensions: ['html'],
  etag: true,
  maxAge: '10m',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  sendPublicHtml(res, 'index.html');
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `单个文件不能超过 ${getMaxFileSizeMb()} MB` });
    if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `一次最多上传 ${getMaxFilesPerUpload()} 个文件` });
    return res.status(400).json({ error: error.message });
  }
  if (error.message === '不能把磁盘根目录作为文件存放目录') return res.status(400).json({ error: error.message });
  if (error.message === '单文件大小限制需在 1-10240 MB 之间') return res.status(400).json({ error: error.message });
  if (error.message === '下载次数限制需为 0-100000，0 表示不限') return res.status(400).json({ error: error.message });
  console.error('[unhandled]', error);
  const msg = error.message || '';
  if (msg.includes('文件打包失败')) return res.status(500).json({ error: msg });
  if (msg.includes('ENOSPC')) return res.status(500).json({ error: '服务器磁盘空间不足' });
  if (msg.includes('EACCES') || msg.includes('EPERM')) return res.status(500).json({ error: '服务器文件权限错误' });
  return res.status(500).json({ error: '服务器内部错误' });
});

await ensureDirectories();
await loadState();

if (state.users.length === 0) {
  const autoUsername = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const autoPassword = String(process.env.ADMIN_PASSWORD || '');
  if (autoUsername && autoPassword && /^[a-z0-9_.-]{3,32}$/.test(autoUsername) && autoPassword.length >= 8) {
    const autoEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const user = {
      id: randomId(),
      username: autoUsername,
      email: autoEmail && validateEmail(autoEmail) ? autoEmail : '',
      passwordHash: await hashPassword(autoPassword),
      role: 'super_admin',
      disabled: false,
      createdAt: nowIso()
    };
    state.users.push(user);
    addLog('system.initialized', null, { username: autoUsername, method: 'env' });
    await saveState();
    console.log(`[init] 管理员已通过环境变量自动创建: ${autoUsername}`);
  }
}

await cleanupExpired();
const cleanupTimer = setInterval(() => cleanupExpired().catch((error) => console.error('[cleanup]', error)), 15 * 60 * 1000).unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`JiahaoDrop is running at http://${config.host}:${config.port}`);
  console.log(`Retention: ${getRetentionHours()}h, max file: ${getMaxFileSizeMb()}MB`);
  console.log(`Session: absolute ${sessionAbsoluteHours()}h, idle ${Math.round(sessionIdleMs() / 60000)}m, browser-close re-login enabled`);
  console.log(`Storage: ${getStorageDir()}`);
  warmMailer('startup').catch((err) => console.error('[warmMailer]', err));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] 收到 ${signal}，正在关闭...`);
  clearInterval(cleanupTimer);
  await saveState().catch(() => {});
  resetMailerCache();
  server.close(() => {
    console.log('[shutdown] 已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
