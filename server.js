'use strict';
/*
 * «Дом» — семейный планировщик: задачи, встречи, личные бюджеты, общие платежи и накопления.
 * Без внешних зависимостей: нужен только Node.js 18+.
 * Запуск: node server.js        (порт 3101, или PORT=…)
 * Сброс пароля первого пользователя: node server.js --reset-admin
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3101;
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY || '';          // '1' — за Caddy (берём X-Real-IP)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const FIRST_FILE = path.join(DATA_DIR, 'ПЕРВЫЙ_ВХОД.txt');
const PUB = path.join(__dirname, 'public');
const TZ_MIN = Number.isFinite(Number(process.env.TZ_OFFSET_MIN)) && process.env.TZ_OFFSET_MIN !== '' ? Number(process.env.TZ_OFFSET_MIN) : 300; // Казахстан: UTC+5
const SESSION_MS = 60 * 24 * 3600 * 1000;
const MAX_BODY = 100 * 1024;
const COOKIE = 'dom_sess';
const AI_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const AI_MONTH_LIMIT = 1500;   // разборов текста в месяц на семью — защита от случайного перерасхода
const THEMES = ['man', 'woman', 'neutral'];   // оформление у каждого своё

/* ---------------- utils ---------------- */
const nowIso = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const localNow = () => new Date(Date.now() + TZ_MIN * 60000);
const todayL = () => localNow().toISOString().slice(0, 10);
const monthL = () => todayL().slice(0, 7);
const newId = () => crypto.randomBytes(9).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n) : '');
const date = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const [y, m, d] = v.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? v : '';
};
const hhmm = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');
const month = v => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : '');
// Сумма в тенге: целое число от 0 до 10 млрд; пробелы между разрядами допускаются
const money = v => {
  const s = typeof v === 'number' ? String(Math.round(v)) : typeof v === 'string' ? v.replace(/[\s\u00a0₸тг.]/gi, '').replace(',', '.') : 'x';
  const n = Math.round(Number(s));
  return s !== '' && Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : null;
};
const intIn = (v, a, b) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= a && n <= b ? n : null; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addMonths = (ymv, k) => { let [y, m] = ymv.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + pad(m); };
function httpErr(code, msg) { return Object.assign(new Error(msg), { code }); }

function genPassword(len = 12) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += abc[b[i] % abc.length];
  return s;
}
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64, SCRYPT).toString('hex') };
}
function checkPw(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 64, SCRYPT);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === h.length && crypto.timingSafeEqual(ref, h);
}
const DUMMY = hashPw(genPassword());

/* ---------------- storage ---------------- */
const LISTS = ['users', 'sessions', 'tasks', 'events', 'tx', 'bills', 'pays', 'goals', 'deposits', 'notes', 'audit'];
let db;
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
  backup();
}
function backup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const f = path.join(BACKUP_DIR, 'db-' + todayL() + '.json');
    if (!fs.existsSync(f)) {
      fs.copyFileSync(DB_FILE, f);
      const old = fs.readdirSync(BACKUP_DIR).filter(x => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
      old.slice(0, Math.max(0, old.length - 30)).forEach(x => fs.unlinkSync(path.join(BACKUP_DIR, x)));
    }
  } catch (e) { console.error('Резервная копия не создана:', e.message); }
}
function writeFirstLogin(pw) {
  fs.writeFileSync(FIRST_FILE,
    'Первый вход в «Дом»\r\n\r\nЛогин:  admin\r\nПароль: ' + pw +
    '\r\n\r\nПосле входа приложение попросит указать имя и новый пароль, и этот файл удалится автоматически.\r\n', { mode: 0o600 });
}
function newUser(login, name, role) {
  const pw = genPassword(), h = hashPw(pw);
  const u = { id: newId(), login, name, salt: h.salt, hash: h.hash, role, active: true, mustChange: true, calToken: crypto.randomBytes(24).toString('base64url'), createdAt: nowIso() };
  db.users.push(u);
  return { u, pw };
}
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    for (const k of LISTS) if (!Array.isArray(db[k])) db[k] = [];
    if (!db.settings || typeof db.settings !== 'object' || Array.isArray(db.settings)) db.settings = {};
    if (!db.aiUsage || typeof db.aiUsage !== 'object') db.aiUsage = {};
    db.sessions = db.sessions.filter(s => s.exp > Date.now());
  } else {
    db = { settings: {}, aiUsage: {} };
    for (const k of LISTS) db[k] = [];
    const { pw } = newUser('admin', '', 'admin');
    save();
    writeFirstLogin(pw);
    console.log('\n  Создан первый пользователь.\n  Логин: admin   Пароль: ' + pw + '\n  (пароль также записан в ' + FIRST_FILE + ')\n');
  }
}
function resetAdmin() {
  load();
  const u = db.users.find(x => x.role === 'admin') || newUser('admin', '', 'admin').u;
  const pw = genPassword(), h = hashPw(pw);
  Object.assign(u, { salt: h.salt, hash: h.hash, active: true, mustChange: true });
  db.sessions = db.sessions.filter(s => s.uid !== u.id);
  save();
  console.log('\n  Пароль сброшен. Логин: ' + u.login + '   Новый пароль: ' + pw + '\n');
}

/* ---------------- sessions, ip, rate limit ---------------- */
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} } });
  return out;
}
function isHttps(req) { return !!req.socket.encrypted || (!!TRUST_PROXY && (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'); }
// Cookie без Domain=… — браузер отдаёт её только этому адресу, другим сайтам на том же домене она не видна
function setSession(req, res, uid) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions.push({ h: sha(token), uid, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + SESSION_MS / 1000 + (isHttps(req) ? '; Secure' : ''));
}
function clearSession(req, res) {
  const t = cookies(req)[COOKIE];
  if (t) { const h = sha(t); db.sessions = db.sessions.filter(s => s.h !== h); }
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (isHttps(req) ? '; Secure' : ''));
}
function auth(req) {
  const t = cookies(req)[COOKIE];
  if (!t || t.length > 100) return null;
  const h = sha(t);
  const s = db.sessions.find(x => x.h === h && x.exp > Date.now());
  if (!s) return null;
  return db.users.find(x => x.id === s.uid && x.active) || null;
}
function clientIp(req) {
  const h = TRUST_PROXY ? req.headers['x-real-ip'] : '';
  if (typeof h === 'string' && h) return h.trim().slice(0, 64);
  return (req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
}
function audit(req, u, action, detail) {
  db.audit.push({ at: nowIso(), uid: u ? u.id : '', ip: req ? clientIp(req) : 'сервер', action, detail: String(detail || '').slice(0, 200) });
  if (db.audit.length > 2000) db.audit = db.audit.slice(-2000);
}
const fails = new Map();
function blocked(key, max) { const f = fails.get(key); return !!f && f.until > Date.now() && f.n >= max; }
function fail(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  if (f.until < Date.now()) f.n = 0;
  f.n++; f.until = Date.now() + 15 * 60 * 1000;
  fails.set(key, f);
}

/* ---------------- http helpers ---------------- */
function secHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false; const chunks = [];
    req.on('data', c => { if (over) return; size += c.length; if (size > MAX_BODY) { over = true; chunks.length = 0; reject(httpErr(413, 'Слишком большой запрос')); } else chunks.push(c); });
    req.on('end', () => {
      if (over) return;
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); }
      catch (e) { reject(httpErr(400, 'Неверный формат запроса')); }
    });
    req.on('error', reject);
  });
}

/* ---------------- domain helpers ---------------- */
const others = u => db.users.filter(x => x.active && x.id !== u.id);
const nameOf = id => { const x = db.users.find(y => y.id === id); return x ? (x.name || x.login) : '—'; };
const confirmerId = () => { const c = db.settings.confirmer; return db.users.some(x => x.id === c && x.active) ? c : (db.users.find(x => x.role === 'admin' && x.active) || {}).id; };
const pubUser = x => ({ id: x.id, name: x.name || x.login, login: x.login, role: x.role, active: x.active });
const find = (list, id) => { const x = db[list].find(y => y.id === id); if (!x) throw httpErr(404, 'Запись не найдена (возможно, её уже удалили)'); return x; };
// Кому адресовано: 'me' | 'spouse' | id пользователя
function resolveUser(u, v) {
  if (!v || v === 'me') return u.id;
  if (v === 'spouse') { const o = others(u)[0]; if (!o) throw httpErr(400, 'Второй участник ещё не добавлен — это делается в настройках'); return o.id; }
  if (db.users.some(x => x.id === v && x.active)) return v;
  throw httpErr(400, 'Неизвестный участник');
}

// Срок платежа в месяце: день платежа, но не позже последнего дня месяца
const dueOf = (b, period) => b.kind === 'once' ? b.dueDate : period + '-' + pad(Math.min(b.day || 1, daysIn(+period.slice(0, 4), +period.slice(5, 7))));
// Экземпляры платежей за диапазон месяцев
function billInstances(from, to) {
  const out = [];
  for (const b of db.bills) {
    if (b.archived) continue;
    if (b.kind === 'once') {
      const pay = db.pays.find(p => p.billId === b.id && p.period === 'once');
      out.push({ billId: b.id, period: 'once', due: b.dueDate, amount: b.amount, pay: pay || null });
      continue;
    }
    for (let m = from; m <= to; m = addMonths(m, 1)) {
      if (m < (b.from || '0000-00') || (b.until && m > b.until)) continue;
      const pay = db.pays.find(p => p.billId === b.id && p.period === m);
      out.push({ billId: b.id, period: m, due: dueOf(b, m), amount: pay ? pay.amount : b.amount, pay: pay || null });
    }
  }
  return out.sort((a, b) => (a.due || '').localeCompare(b.due || ''));
}

function state(u) {
  const ids = new Set([u.id]);
  const cur = monthL();
  return {
    me: Object.assign(pubUser(u), { mustChange: !!u.mustChange, calPath: '/cal/' + u.calToken + '.ics', theme: THEMES.includes(u.theme) ? u.theme : (u.role === 'admin' ? 'man' : 'woman') }),
    users: db.users.filter(x => x.active).map(pubUser),
    confirmer: confirmerId(),
    today: todayL(),
    ai: { configured: !!db.settings.aiKey },
    tasks: db.tasks.filter(t => ids.has(t.owner) || ids.has(t.from)),
    events: db.events.filter(e => e.owner === u.id || e.shared || e.createdBy === u.id),
    tx: db.tx.filter(t => t.owner === u.id),
    notes: db.notes.filter(n => n.owner === u.id).slice(-100),
    bills: db.bills.filter(b => !b.archived),
    instances: billInstances(addMonths(cur, -6), addMonths(cur, 2)),
    goals: db.goals.filter(g => !g.archived),
    deposits: db.deposits,
  };
}

/* ---------------- create / update ---------------- */
function mkTask(u, b) {
  const title = str(b.title, 300); if (!title) throw httpErr(400, 'Напишите, что нужно сделать');
  const t = { id: newId(), title, note: str(b.note, 2000), due: date(b.due), owner: resolveUser(u, b.owner), from: u.id, done: false, doneAt: '', createdAt: nowIso() };
  db.tasks.push(t); return t;
}
function mkEvent(u, b) {
  const title = str(b.title, 300); if (!title) throw httpErr(400, 'Укажите название встречи');
  const d = date(b.date); if (!d) throw httpErr(400, 'Укажите дату встречи');
  const forWho = b.for === 'both' ? 'both' : b.for || 'me';
  const e = { id: newId(), title, date: d, time: hhmm(b.time), dur: intIn(b.dur, 5, 1440) || 60, place: str(b.place, 300), note: str(b.note, 2000),
    owner: forWho === 'both' ? u.id : resolveUser(u, forWho), shared: forWho === 'both', createdBy: u.id, createdAt: nowIso() };
  db.events.push(e); return e;
}
function mkTx(u, b) {
  const amount = money(b.amount); if (!amount) throw httpErr(400, 'Укажите сумму');
  const t = { id: newId(), owner: u.id, kind: b.kind === 'income' ? 'income' : 'expense', amount, category: str(b.category, 60) || 'Прочее', note: str(b.note, 300), date: date(b.date) || todayL(), createdAt: nowIso() };
  db.tx.push(t); return t;
}
function mkBill(u, b) {
  const title = str(b.title, 200); if (!title) throw httpErr(400, 'Укажите, что это за платёж');
  const amount = money(b.amount); if (amount === null) throw httpErr(400, 'Укажите сумму платежа');
  const once = b.kind === 'once';
  const x = { id: newId(), title, amount, category: str(b.category, 60), kind: once ? 'once' : 'monthly', createdBy: u.id, createdAt: nowIso() };
  if (once) { x.dueDate = date(b.dueDate) || todayL(); }
  else {
    x.day = intIn(b.day, 1, 31) || 1; x.until = month(b.until) || '';
    // Если число платежа в этом месяце уже прошло — начинаем со следующего месяца, чтобы не появлялся «долг» за прошлое
    x.from = month(b.from) || (x.day < +todayL().slice(8) ? addMonths(monthL(), 1) : monthL());
  }
  db.bills.push(x); return x;
}
function mkGoal(u, b) {
  const title = str(b.title, 200); if (!title) throw httpErr(400, 'Укажите цель накопления');
  const g = { id: newId(), title, target: money(b.target) || 0, deadline: date(b.deadline), createdBy: u.id, createdAt: nowIso() };
  db.goals.push(g); return g;
}
function mkDeposit(u, b) {
  const g = find('goals', b.goalId); const amount = money(b.amount); if (!amount) throw httpErr(400, 'Укажите сумму');
  const d = { id: newId(), goalId: g.id, amount: b.withdraw ? -amount : amount, by: u.id, date: date(b.date) || todayL(), note: str(b.note, 200) };
  db.deposits.push(d); return d;
}
function payBill(u, b) {
  const bill = find('bills', b.billId);
  const period = bill.kind === 'once' ? 'once' : month(b.period);
  if (!period) throw httpErr(400, 'Не указан месяц платежа');
  if (db.pays.some(p => p.billId === bill.id && p.period === period)) throw httpErr(409, 'Этот платёж уже отмечен');
  const amount = money(b.amount); const auto = confirmerId() === u.id;
  const p = { id: newId(), billId: bill.id, period, amount: amount === null ? bill.amount : amount, paidBy: u.id, paidAt: nowIso(), confirmedBy: auto ? u.id : '', confirmedAt: auto ? nowIso() : '' };
  db.pays.push(p); return p;
}

/* ---------------- AI: разбор надиктованного текста ---------------- */
function claudeCall(body, key) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const T = process.env.AI_TEST_URL ? new URL(process.env.AI_TEST_URL) : null;   // только для автотестов
    const rq = (T ? http : https).request({ hostname: T ? T.hostname : 'api.anthropic.com', port: T ? T.port : 443, path: '/v1/messages', method: 'POST', timeout: 90000,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': data.length } }, rs => {
      const ch = []; rs.on('data', d => ch.push(d)); rs.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch (e) {}
        if (rs.statusCode >= 200 && rs.statusCode < 300) resolve(j);
        else reject(httpErr(502, rs.statusCode === 401 ? 'Ключ ИИ не подходит — проверьте его в настройках' : rs.statusCode === 429 ? 'ИИ перегружен или исчерпан лимит — попробуйте позже' : (j.error && j.error.message) || ('Ошибка ИИ ' + rs.statusCode))); }); });
    rq.on('timeout', () => rq.destroy(httpErr(504, 'ИИ не ответил вовремя')));
    rq.on('error', e => reject(e.code === 504 ? e : httpErr(502, 'Нет связи с сервисом ИИ')));
    rq.end(data);
  });
}
const ITEM_TOOL = {
  name: 'save_items',
  description: 'Сохранить разобранные из речи пользователя записи',
  input_schema: {
    type: 'object', required: ['items'],
    properties: { items: { type: 'array', items: { type: 'object', required: ['type', 'title'], properties: {
      type: { type: 'string', enum: ['task', 'event', 'expense', 'income', 'bill', 'bill_paid', 'goal', 'deposit', 'note'],
        description: 'task — дело; event — встреча/событие с датой (попадёт в календарь); expense/income — личный расход/доход говорящего; bill — общий обязательный платёж семьи (ипотека, кредит, садик, коммуналка), регулярный или разовый; bill_paid — сообщение, что общий платёж оплачен; goal — новая цель накопления; deposit — отложили деньги в цель; note — мысль/заметка, не подходящая под остальное' },
      title: { type: 'string', description: 'Коротко и по-русски, с заглавной буквы' },
      date: { type: 'string', description: 'YYYY-MM-DD: срок задачи, дата встречи, дата расхода, срок разового платежа, дедлайн цели' },
      time: { type: 'string', description: 'HH:MM для встречи, если названо время' },
      duration_min: { type: 'integer' },
      place: { type: 'string' },
      amount: { type: 'integer', description: 'Сумма в тенге целым числом' },
      category: { type: 'string', description: 'Категория расхода/дохода/платежа: Продукты, Транспорт, Дети, Кафе, Здоровье, Одежда, Дом, Зарплата, Ипотека, Кредит, Садик, Коммуналка и т.п.' },
      who: { type: 'string', enum: ['me', 'spouse', 'both'], description: 'Для кого задача/встреча: me — говорящий, spouse — второй супруг, both — общая встреча' },
      recurring: { type: 'boolean', description: 'Для bill: true — ежемесячный, false — разовый' },
      day_of_month: { type: 'integer', description: 'Для ежемесячного bill: число месяца' },
      until_month: { type: 'string', description: 'Для ежемесячного bill: до какого месяца YYYY-MM, если сказано' },
      ref: { type: 'string', description: 'Для bill_paid — название существующего платежа; для deposit — название существующей цели (точно как в списке)' },
      note: { type: 'string', description: 'Подробности, если есть' },
    } } } },
  },
};
async function parseText(u, text) {
  const s = db.settings;
  if (!s.aiKey) throw httpErr(400, 'ИИ не подключён — ключ Anthropic указывается в настройках (раздел «ИИ»)');
  const m = monthL(), us = db.aiUsage[m] = db.aiUsage[m] || { runs: 0, inTok: 0, outTok: 0 };
  if (us.runs >= AI_MONTH_LIMIT) throw httpErr(429, 'Достигнут месячный лимит разборов (' + AI_MONTH_LIMIT + ')');
  const t = todayL(), wd = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][new Date(t + 'T00:00:00Z').getUTCDay()];
  const sp = others(u)[0];
  const sys = 'Ты помощник семейного планировщика. Говорящий — ' + (u.name || 'пользователь') + (sp ? ', второй супруг — ' + (sp.name || sp.login) : '') + '. ' +
    'Сегодня ' + t + ' (' + wd + '), часовой пояс UTC+5 (Казахстан). Валюта — тенге. ' +
    'Разбери надиктованный текст (он может быть с ошибками распознавания речи) на отдельные записи и ОБЯЗАТЕЛЬНО вызови инструмент save_items (без пояснений текстом). ' +
    'Относительные даты («завтра», «в пятницу», «10-го») переводи в YYYY-MM-DD, выбирая ближайшую будущую дату. ' +
    'Встреча — только если есть дата или день; дело без даты — task. Ничего не выдумывай: суммы, даты и время — только названные. ' +
    'Если говорящий просит что-то сделать супруга — who=spouse.\n' +
    'Существующие общие платежи: ' + (db.bills.filter(b => !b.archived).map(b => '«' + b.title + '»').join(', ') || 'нет') + '.\n' +
    'Существующие цели накоплений: ' + (db.goals.filter(g => !g.archived).map(g => '«' + g.title + '»').join(', ') || 'нет') + '.';
  us.runs++;
  const resp = await claudeCall({ model: AI_MODELS.includes(s.aiModel) ? s.aiModel : AI_MODELS[0], max_tokens: 4000, system: sys,
    tools: [ITEM_TOOL], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: text }] }, s.aiKey);
  if (resp.usage) { us.inTok += resp.usage.input_tokens || 0; us.outTok += resp.usage.output_tokens || 0; }
  save();
  // Обычно модель вызывает save_items; если вместо этого ответила текстом с JSON — берём его оттуда
  const call = (resp.content || []).find(c => c.type === 'tool_use' && c.name === 'save_items');
  let items = call && call.input && Array.isArray(call.input.items) ? call.input.items : null;
  if (!items) {
    const txt = (resp.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    const m = txt.match(/\{[\s\S]*"items"[\s\S]*\}|\[[\s\S]*\]/);
    try { const j = m ? JSON.parse(m[0]) : null; items = Array.isArray(j) ? j : j && Array.isArray(j.items) ? j.items : []; } catch (e) { items = []; }
  }
  return items.slice(0, 40).map(normItem).filter(Boolean);
}
// Приводим ответ ИИ к проверенному виду — ему не доверяем так же, как пользователю
function normItem(x) {
  if (!x || typeof x !== 'object') return null;
  const type = ['task', 'event', 'expense', 'income', 'bill', 'bill_paid', 'goal', 'deposit', 'note'].includes(x.type) ? x.type : 'note';
  const it = { type, title: str(x.title, 300), date: date(x.date), time: hhmm(x.time), duration_min: intIn(x.duration_min, 5, 1440) || 0, place: str(x.place, 300),
    amount: money(x.amount), category: str(x.category, 60), who: ['me', 'spouse', 'both'].includes(x.who) ? x.who : 'me', recurring: x.recurring !== false,
    day_of_month: intIn(x.day_of_month, 1, 31) || 0, until_month: month(x.until_month), ref: str(x.ref, 200), note: str(x.note, 2000) };
  if (!it.title && type !== 'note') return null;
  return it;
}
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
function findByTitle(list, title) {
  const n = norm(title); if (!n) return null;
  return list.find(x => norm(x.title) === n) || list.find(x => norm(x.title).includes(n) || n.includes(norm(x.title))) || null;
}
// Сохранение подтверждённых пользователем записей
function applyItems(u, items) {
  const done = [], errors = [];
  for (const raw of items.slice(0, 40)) {
    const it = normItem(raw); if (!it) continue;
    try {
      if (it.type === 'task') mkTask(u, { title: it.title, note: it.note, due: it.date, owner: it.who === 'spouse' ? 'spouse' : 'me' });
      else if (it.type === 'event') mkEvent(u, { title: it.title, date: it.date, time: it.time, dur: it.duration_min, place: it.place, note: it.note, for: it.who });
      else if (it.type === 'expense' || it.type === 'income') mkTx(u, { kind: it.type, amount: it.amount, category: it.category, note: it.note || it.title, date: it.date });
      else if (it.type === 'bill') mkBill(u, { title: it.title, amount: it.amount, category: it.category, kind: it.recurring ? 'monthly' : 'once', dueDate: it.date, day: it.day_of_month || (it.date ? +it.date.slice(8) : 1), until: it.until_month });
      else if (it.type === 'bill_paid') {
        const b = findByTitle(db.bills.filter(x => !x.archived), it.ref || it.title);
        if (!b) throw httpErr(404, 'не найден платёж «' + (it.ref || it.title) + '»');
        const period = b.kind === 'once' ? 'once' : (it.date ? it.date.slice(0, 7) : monthL());
        payBill(u, { billId: b.id, period, amount: it.amount === null ? undefined : it.amount });
      } else if (it.type === 'goal') mkGoal(u, { title: it.title, target: it.amount, deadline: it.date });
      else if (it.type === 'deposit') {
        const g = findByTitle(db.goals.filter(x => !x.archived), it.ref || it.title);
        if (!g) throw httpErr(404, 'не найдена цель «' + (it.ref || it.title) + '»');
        mkDeposit(u, { goalId: g.id, amount: it.amount, date: it.date, note: it.note });
      } else {
        const text = str([it.title, it.note].filter(Boolean).join('\n'), 4000); if (!text) continue;
        db.notes.push({ id: newId(), owner: u.id, text, createdAt: nowIso() });
        if (db.notes.length > 3000) db.notes = db.notes.slice(-3000);
      }
      done.push(it.type);
    } catch (e) { errors.push((it.title || it.type) + ': ' + e.message); }
  }
  return { saved: done.length, errors };
}

/* ---------------- календарь iPhone (подписка .ics) ---------------- */
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
  out.push(cur); return out.join('\r\n');
}
const icsUtc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = d => d.replace(/-/g, '');
const nextDay = d => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
const fmtMoney = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸';
function ics(u) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//dom//family//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Дом — ' + icsEsc(u.name || u.login), 'X-WR-TIMEZONE:Asia/Almaty', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const stamp = icsUtc(Date.now());
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const add = (uid, summary, d, time, dur, extra) => {
    L.push('BEGIN:VEVENT', 'UID:' + uid + '@dom', 'DTSTAMP:' + stamp);
    if (time) {
      const [y, mo, dd] = d.split('-').map(Number), [h, mi] = time.split(':').map(Number);
      const start = Date.UTC(y, mo - 1, dd, h, mi) - TZ_MIN * 60000;
      L.push('DTSTART:' + icsUtc(start), 'DTEND:' + icsUtc(start + (dur || 60) * 60000));
    } else L.push('DTSTART;VALUE=DATE:' + icsDate(d), 'DTEND;VALUE=DATE:' + icsDate(nextDay(d)));
    L.push('SUMMARY:' + icsEsc(summary));
    (extra || []).forEach(x => L.push(x));
    if (time) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(summary), 'TRIGGER:-PT30M', 'END:VALARM');
    L.push('END:VEVENT');
  };
  for (const e of db.events) {
    if (!(e.owner === u.id || e.shared) || e.date < since) continue;
    const ex = [];
    if (e.place) ex.push('LOCATION:' + icsEsc(e.place));
    const desc = [e.note, e.shared ? 'Общее событие' : '', e.createdBy !== u.id ? 'Добавил(а): ' + nameOf(e.createdBy) : ''].filter(Boolean).join('\n');
    if (desc) ex.push('DESCRIPTION:' + icsEsc(desc));
    add('e-' + e.id, (e.shared ? '👪 ' : '') + e.title, e.date, e.time, e.dur, ex);
  }
  for (const t of db.tasks) if (t.owner === u.id && t.due && !t.done && t.due >= since) add('t-' + t.id, '☐ ' + t.title, t.due, '', 0, t.from !== u.id ? ['DESCRIPTION:' + icsEsc('Поручил(а): ' + nameOf(t.from))] : []);
  const cur = monthL();
  for (const i of billInstances(addMonths(cur, -1), addMonths(cur, 2))) {
    if (i.pay && i.pay.confirmedBy) continue;
    const b = db.bills.find(x => x.id === i.billId);
    add('b-' + i.billId + '-' + i.period, '💳 ' + b.title + ' — ' + fmtMoney(i.amount) + (i.pay ? ' (ждёт подтверждения)' : ''), i.due, '', 0);
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

/* ---------------- static ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serveStatic(req, res, p) {
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    const ext = path.extname(f);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || p === '/sw.js' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
}

/* ---------------- API ---------------- */
async function api(req, res, p, u) {
  const M = req.method;
  const body = M === 'POST' ? await readBody(req) : {};
  const mt = (re) => { const m = p.match(re); return m && m.slice(1); };
  let m;

  if (p === '/api/login' && M === 'POST') {
    const ip = clientIp(req), login = str(body.login, 60).toLowerCase(), pw = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    if (blocked('ip:' + ip, 10) || blocked('u:' + login, 8)) throw httpErr(429, 'Слишком много попыток — подождите 15 минут');
    const x = db.users.find(y => y.login === login && y.active);
    const ok = x ? checkPw(pw, x.salt, x.hash) : (checkPw(pw, DUMMY.salt, DUMMY.hash), false);
    if (!ok) { fail('ip:' + ip); fail('u:' + login); audit(req, null, 'login_fail', login); throw httpErr(401, 'Неверный логин или пароль'); }
    fails.delete('u:' + login);
    setSession(req, res, x.id); audit(req, x, 'login', ''); save();
    return json(res, 200, { ok: true });
  }
  if (!u) throw httpErr(401, 'Нужно войти');
  if (p === '/api/logout' && M === 'POST') { clearSession(req, res); save(); return json(res, 200, { ok: true }); }
  if (p === '/api/password' && M === 'POST') {
    const pw = typeof body.password === 'string' ? body.password : '';
    if (!u.mustChange) { const old = typeof body.old === 'string' ? body.old.slice(0, 200) : ''; if (!checkPw(old, u.salt, u.hash)) throw httpErr(400, 'Текущий пароль указан неверно'); }
    if (pw.length < 8 || pw.length > 200) throw httpErr(400, 'Пароль — от 8 символов');
    const name = str(body.name, 60); if (name) u.name = name;
    if (!u.name) throw httpErr(400, 'Укажите своё имя — так вас будет видеть супруг(а)');
    const h = hashPw(pw); Object.assign(u, { salt: h.salt, hash: h.hash, mustChange: false });
    const cur = cookies(req)[COOKIE]; const keep = cur ? sha(cur) : '';
    db.sessions = db.sessions.filter(s => s.uid !== u.id || s.h === keep);
    if (u.role === 'admin') { try { fs.unlinkSync(FIRST_FILE); } catch (e) {} }
    audit(req, u, 'password', ''); save();
    return json(res, 200, { ok: true });
  }
  if (u.mustChange && p !== '/api/state') throw httpErr(403, 'Сначала задайте свой пароль');
  if (p === '/api/state' && M === 'GET') return json(res, 200, state(u));

  // Разбор надиктованного текста → черновик записей (ничего не сохраняет)
  if (p === '/api/parse' && M === 'POST') {
    const text = str(body.text, 6000); if (!text) throw httpErr(400, 'Текст пустой');
    if (blocked('ai:' + u.id, 30)) throw httpErr(429, 'Слишком часто — подождите немного');
    fail('ai:' + u.id);
    return json(res, 200, { items: await parseText(u, text) });
  }
  if (p === '/api/apply' && M === 'POST') {
    if (!Array.isArray(body.items)) throw httpErr(400, 'Нет записей');
    const r = applyItems(u, body.items); save(); return json(res, 200, r);
  }

  // Задачи
  if (p === '/api/tasks' && M === 'POST') { const t = mkTask(u, body); save(); return json(res, 200, t); }
  if ((m = mt(/^\/api\/tasks\/([\w-]+)$/)) && M === 'POST') {
    const t = find('tasks', m[0]);
    if (t.owner !== u.id && t.from !== u.id) throw httpErr(403, 'Нет доступа');
    if (body.delete) { db.tasks = db.tasks.filter(x => x !== t); save(); return json(res, 200, { ok: true }); }
    if ('done' in body) { t.done = !!body.done; t.doneAt = t.done ? nowIso() : ''; }
    if ('title' in body) { const v = str(body.title, 300); if (v) t.title = v; }
    if ('note' in body) t.note = str(body.note, 2000);
    if ('due' in body) t.due = date(body.due);
    if ('owner' in body) t.owner = resolveUser(u, body.owner);
    save(); return json(res, 200, t);
  }
  // Встречи
  if (p === '/api/events' && M === 'POST') { const e = mkEvent(u, body); save(); return json(res, 200, e); }
  if ((m = mt(/^\/api\/events\/([\w-]+)$/)) && M === 'POST') {
    const e = find('events', m[0]);
    if (!(e.owner === u.id || e.shared || e.createdBy === u.id)) throw httpErr(403, 'Нет доступа');
    if (body.delete) { db.events = db.events.filter(x => x !== e); save(); return json(res, 200, { ok: true }); }
    if ('title' in body) { const v = str(body.title, 300); if (v) e.title = v; }
    if ('date' in body) { const v = date(body.date); if (v) e.date = v; }
    if ('time' in body) e.time = hhmm(body.time);
    if ('dur' in body) e.dur = intIn(body.dur, 5, 1440) || 60;
    if ('place' in body) e.place = str(body.place, 300);
    if ('note' in body) e.note = str(body.note, 2000);
    save(); return json(res, 200, e);
  }
  // Личный бюджет — виден только владельцу
  if (p === '/api/tx' && M === 'POST') { const t = mkTx(u, body); save(); return json(res, 200, t); }
  if ((m = mt(/^\/api\/tx\/([\w-]+)$/)) && M === 'POST') {
    const t = find('tx', m[0]); if (t.owner !== u.id) throw httpErr(403, 'Нет доступа');
    if (body.delete) db.tx = db.tx.filter(x => x !== t);
    save(); return json(res, 200, { ok: true });
  }
  if ((m = mt(/^\/api\/notes\/([\w-]+)$/)) && M === 'POST') {
    const n = find('notes', m[0]); if (n.owner !== u.id) throw httpErr(403, 'Нет доступа');
    if (body.delete) db.notes = db.notes.filter(x => x !== n);
    save(); return json(res, 200, { ok: true });
  }
  // Общие платежи
  if (p === '/api/bills' && M === 'POST') { const b = mkBill(u, body); save(); return json(res, 200, b); }
  if ((m = mt(/^\/api\/bills\/([\w-]+)$/)) && M === 'POST') {
    const b = find('bills', m[0]);
    if (body.delete) { b.archived = true; save(); return json(res, 200, { ok: true }); }
    if ('title' in body) { const v = str(body.title, 200); if (v) b.title = v; }
    if ('amount' in body) { const v = money(body.amount); if (v !== null) b.amount = v; }
    if ('category' in body) b.category = str(body.category, 60);
    if (b.kind === 'monthly') { if ('day' in body) b.day = intIn(body.day, 1, 31) || b.day; if ('until' in body) b.until = month(body.until); if ('from' in body && month(body.from)) b.from = month(body.from); }
    else if ('dueDate' in body) b.dueDate = date(body.dueDate) || b.dueDate;
    save(); return json(res, 200, b);
  }
  if (p === '/api/pays' && M === 'POST') { const x = payBill(u, body); audit(req, u, 'pay', x.billId + ' ' + x.period); save(); return json(res, 200, x); }
  if ((m = mt(/^\/api\/pays\/([\w-]+)$/)) && M === 'POST') {
    const x = find('pays', m[0]); const isConf = confirmerId() === u.id;
    if (body.confirm) {
      if (!isConf) throw httpErr(403, 'Подтверждать оплату может только ' + nameOf(confirmerId()));
      x.confirmedBy = u.id; x.confirmedAt = nowIso(); audit(req, u, 'confirm', x.id);
    } else if (body.reject || body.delete) {
      if (x.confirmedBy && !isConf) throw httpErr(403, 'Оплата уже подтверждена — отменить может только ' + nameOf(confirmerId()));
      if (!isConf && x.paidBy !== u.id) throw httpErr(403, 'Отменить отметку может тот, кто её поставил, или ' + nameOf(confirmerId()));
      db.pays = db.pays.filter(y => y !== x); audit(req, u, 'unpay', x.id);
    }
    save(); return json(res, 200, { ok: true });
  }
  // Накопления
  if (p === '/api/goals' && M === 'POST') { const g = mkGoal(u, body); save(); return json(res, 200, g); }
  if ((m = mt(/^\/api\/goals\/([\w-]+)$/)) && M === 'POST') {
    const g = find('goals', m[0]);
    if (body.delete) { g.archived = true; save(); return json(res, 200, { ok: true }); }
    if ('title' in body) { const v = str(body.title, 200); if (v) g.title = v; }
    if ('target' in body) g.target = money(body.target) || 0;
    if ('deadline' in body) g.deadline = date(body.deadline);
    save(); return json(res, 200, g);
  }
  if (p === '/api/deposits' && M === 'POST') { const d = mkDeposit(u, body); save(); return json(res, 200, d); }
  if ((m = mt(/^\/api\/deposits\/([\w-]+)$/)) && M === 'POST') {
    const d = find('deposits', m[0]); if (d.by !== u.id) throw httpErr(403, 'Удалить взнос может тот, кто его внёс');
    if (body.delete) db.deposits = db.deposits.filter(x => x !== d);
    save(); return json(res, 200, { ok: true });
  }
  if (p === '/api/theme' && M === 'POST') {
    if (!THEMES.includes(body.theme)) throw httpErr(400, 'Неизвестное оформление');
    u.theme = body.theme; save(); return json(res, 200, { ok: true });
  }
  // Календарь: новая секретная ссылка (старая перестаёт работать)
  if (p === '/api/cal/rotate' && M === 'POST') { u.calToken = crypto.randomBytes(24).toString('base64url'); save(); return json(res, 200, { calPath: '/cal/' + u.calToken + '.ics' }); }

  // Настройки — только у первого пользователя (администратора)
  if (p.startsWith('/api/admin/')) {
    if (u.role !== 'admin') throw httpErr(403, 'Это может только администратор');
    if (p === '/api/admin/info' && M === 'GET') {
      const s = db.settings, us = db.aiUsage[monthL()] || {};
      return json(res, 200, { ai: { configured: !!s.aiKey, keyTail: s.aiKey ? s.aiKey.slice(-4) : '', model: AI_MODELS.includes(s.aiModel) ? s.aiModel : AI_MODELS[0], models: AI_MODELS, runs: us.runs || 0, inTok: us.inTok || 0, outTok: us.outTok || 0 },
        confirmer: confirmerId(), users: db.users.map(x => Object.assign(pubUser(x), { mustChange: !!x.mustChange })) });
    }
    if (p === '/api/admin/ai' && M === 'POST') {
      if (body.clear) { delete db.settings.aiKey; audit(req, u, 'ai_key', 'удалён'); }
      else if (body.key) { const k = str(body.key, 300); if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) throw httpErr(400, 'Это не похоже на ключ Anthropic (он начинается с sk-ant-)'); db.settings.aiKey = k; audit(req, u, 'ai_key', '…' + k.slice(-4)); }
      if ('model' in body) db.settings.aiModel = AI_MODELS.includes(body.model) ? body.model : AI_MODELS[0];
      save(); return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/confirmer' && M === 'POST') {
      if (!db.users.some(x => x.id === body.uid && x.active)) throw httpErr(400, 'Неизвестный участник');
      db.settings.confirmer = body.uid; save(); return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/users' && M === 'POST') {
      const login = str(body.login, 40).toLowerCase(), name = str(body.name, 60);
      if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw httpErr(400, 'Логин — латиницей, от 3 символов (например: aigerim)');
      if (db.users.some(x => x.login === login)) throw httpErr(409, 'Такой логин уже есть');
      if (db.users.filter(x => x.active).length >= 6) throw httpErr(400, 'Не больше 6 участников');
      const r = newUser(login, name, 'member'); audit(req, u, 'user_add', login); save();
      return json(res, 200, { login, password: r.pw });
    }
    if ((m = mt(/^\/api\/admin\/users\/([\w-]+)$/)) && M === 'POST') {
      const x = find('users', m[0]); if (x.id === u.id) throw httpErr(400, 'Себя изменить здесь нельзя');
      if (body.reset) { const pw = genPassword(), h = hashPw(pw); Object.assign(x, { salt: h.salt, hash: h.hash, mustChange: true, active: true }); db.sessions = db.sessions.filter(s => s.uid !== x.id); audit(req, u, 'user_reset', x.login); save(); return json(res, 200, { login: x.login, password: pw }); }
      if ('active' in body) { x.active = !!body.active; if (!x.active) db.sessions = db.sessions.filter(s => s.uid !== x.id); audit(req, u, x.active ? 'user_on' : 'user_off', x.login); }
      save(); return json(res, 200, { ok: true });
    }
  }
  throw httpErr(404, 'Не найдено');
}

const server = http.createServer(async (req, res) => {
  secHeaders(req, res);
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  try {
    if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    let m = p.match(/^\/cal\/([A-Za-z0-9_-]{20,64})\.ics$/);
    if (m && req.method === 'GET') {
      const u = db.users.find(x => x.active && x.calToken && x.calToken.length === m[1].length && crypto.timingSafeEqual(Buffer.from(x.calToken), Buffer.from(m[1])));
      if (!u) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Календарь не найден'); }
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
      return res.end(ics(u));
    }
    if (p.startsWith('/api/')) {
      // Защита от подделки запросов с чужих сайтов: изменения принимаем только как JSON
      if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] || '')) throw httpErr(415, 'Нужен JSON');
      return await api(req, res, p, auth(req));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, p);
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: code === 500 ? 'Внутренняя ошибка сервера' : e.message });
    else res.end();
  }
});

if (process.argv.includes('--reset-admin')) { resetAdmin(); process.exit(0); }
load();
setInterval(() => {
  const t = Date.now();
  for (const [k, f] of fails) if (f.until < t) fails.delete(k);
  const n = db.sessions.length; db.sessions = db.sessions.filter(s => s.exp > t);
  if (db.sessions.length !== n) save();
}, 10 * 60 * 1000).unref();
server.headersTimeout = 20000;
server.requestTimeout = 120000;
server.listen(PORT, HOST, () => console.log('«Дом» работает: http://' + HOST + ':' + PORT));
