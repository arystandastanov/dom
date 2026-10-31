'use strict';
/* «Дом» — интерфейс. Без сторонних библиотек; весь текст вставляется через textContent. */
(() => {
  const $app = document.getElementById('app');
  let S = null;                 // состояние с сервера
  const UI = { view: 'home', taskTab: 'mine', famTab: 'bills', mMonth: '', fMonth: '' };
  try { const v = localStorage.getItem('dom.view'); if (v) UI.view = v; } catch (e) {}
  const fromHash = () => { const hv = (location.hash || '').slice(1); if (['home', 'tasks', 'cal', 'money', 'family'].includes(hv)) { UI.view = hv; history.replaceState(null, '', '/'); return true; } return false; };
  fromHash();
  window.addEventListener('hashchange', () => { if (fromHash() && S) render(); });

  /* ---------- утилиты ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MON1 = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const pad = n => String(n).padStart(2, '0');
  const today = () => S ? S.today : new Date().toISOString().slice(0, 10);
  const addDays = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
  const addMonths = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + pad(m); };
  const monthName = ym => MON1[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);
  function fmtDate(d) {
    if (!d) return '';
    const t = today();
    if (d === t) return 'Сегодня';
    if (d === addDays(t, 1)) return 'Завтра';
    if (d === addDays(t, -1)) return 'Вчера';
    const wd = WD[new Date(d + 'T00:00:00Z').getUTCDay()];
    return wd + ', ' + (+d.slice(8)) + ' ' + MON[+d.slice(5, 7) - 1] + (d.slice(0, 4) !== t.slice(0, 4) ? ' ' + d.slice(0, 4) : '');
  }
  const money = n => (n < 0 ? '−' : '') + String(Math.abs(Math.round(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸';
  const nameOf = id => { const u = S.users.find(x => x.id === id); return u ? u.name : '—'; };
  const spouse = () => S.users.find(x => x.id !== S.me.id);
  let toastT;
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let r;
    try { r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opt)); }
    catch (e) { throw new Error('Нет связи с сервером'); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 401 && path !== '/api/login') { S = null; renderLogin(); throw new Error('Нужно войти'); }
    if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
    return j;
  }
  async function refresh() { S = await api('/api/state'); if (!UI.mMonth) UI.mMonth = S.today.slice(0, 7); if (!UI.fMonth) UI.fMonth = S.today.slice(0, 7); render(); }
  async function act(path, body, okMsg) {
    try { const r = await api(path, body); if (okMsg) toast(okMsg); await refresh(); return r; }
    catch (e) { toast(e.message); return null; }
  }

  /* ---------- вход ---------- */
  function renderLogin() {
    const err = h('div', { class: 'err' });
    const login = h('input', { autocomplete: 'username', autocapitalize: 'none', placeholder: 'Логин', 'aria-label': 'Логин' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль', 'aria-label': 'Пароль' });
    const go = async e => {
      e.preventDefault(); err.textContent = '';
      try { await api('/api/login', { login: login.value, password: pw.value }); await refresh(); }
      catch (x) { err.textContent = x.message; }
    };
    $app.replaceChildren(h('div', { class: 'auth' },
      h('img', { class: 'logo', src: '/icon-192.png', alt: '' }),
      h('h1', null, 'Дом'), h('p', { class: 'hint' }, 'Семейные дела, встречи и бюджет'),
      h('form', { class: 'card form', onsubmit: go }, login, pw, err, h('button', { class: 'btn' }, 'Войти'))));
  }
  function renderFirst() {
    const err = h('div', { class: 'err' });
    const name = h('input', { placeholder: 'Ваше имя (например, Арыстан)', value: S.me.name === S.me.login ? '' : S.me.name, 'aria-label': 'Имя' });
    const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Новый пароль, от 8 символов', 'aria-label': 'Новый пароль' });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Повторите пароль', 'aria-label': 'Повтор пароля' });
    const go = async e => {
      e.preventDefault(); err.textContent = '';
      if (pw.value !== pw2.value) { err.textContent = 'Пароли не совпадают'; return; }
      try { await api('/api/password', { name: name.value, password: pw.value }); await refresh(); toast('Готово'); }
      catch (x) { err.textContent = x.message; }
    };
    $app.replaceChildren(h('div', { class: 'auth' },
      h('h1', null, 'Добро пожаловать'), h('p', { class: 'hint' }, 'Укажите своё имя и придумайте пароль. Временный пароль после этого перестанет работать.'),
      h('form', { class: 'card form', onsubmit: go }, name, pw, pw2, err, h('button', { class: 'btn' }, 'Сохранить'))));
  }

  /* ---------- оболочка ---------- */
  const VIEWS = [['home', '⌂', 'Главная'], ['tasks', '✓', 'Дела'], ['cal', '◷', 'Календарь'], ['money', '₸', 'Мои деньги'], ['family', '❤', 'Семья']];
  const TITLES = { home: 'Главная', tasks: 'Дела', cal: 'Календарь', money: 'Мои деньги', family: 'Семья' };
  function render() {
    if (!S) return renderLogin();
    document.documentElement.dataset.theme = S.me.theme || 'neutral';
    if (S.me.mustChange) return renderFirst();
    const y = window.scrollY;
    const body = { home: vHome, tasks: vTasks, cal: vCal, money: vMoney, family: vFamily }[UI.view] || vHome;
    $app.replaceChildren(
      h('header', { class: 'top' }, h('h1', null, TITLES[UI.view] || 'Дом'), h('button', { class: 'iconbtn', 'aria-label': 'Настройки', onclick: openSettings }, '⚙︎')),
      h('main', { class: 'main' }, body()),
      h('button', { class: 'mic', 'aria-label': 'Ассистент', onclick: openAssistant }, '🎙'),
      h('nav', { class: 'nav' }, VIEWS.map(([k, i, t]) => h('button', { class: UI.view === k ? 'on' : '', onclick: () => go(k) }, h('span', { class: 'i' }, i), t))));
    window.scrollTo(0, y);
  }
  function go(v) { UI.view = v; try { localStorage.setItem('dom.view', v); } catch (e) {} window.scrollTo(0, 0); render(); }
  const section = (title, link, ...kids) => [h('h2', null, title, h('span', { class: 'sp' }), link || null), ...kids];
  const empty = t => h('div', { class: 'empty' }, t);

  /* ---------- общие строки ---------- */
  function taskRow(t) {
    const overdue = t.due && t.due < today() && !t.done;
    const sub = [t.due ? fmtDate(t.due) : '', t.from !== S.me.id ? 'от ' + nameOf(t.from) : t.owner !== S.me.id ? '→ ' + nameOf(t.owner) : '', t.note].filter(Boolean).join(' · ');
    return h('div', { class: 'row' + (t.done ? ' done' : '') },
      h('button', { class: 'chk' + (t.done ? ' on' : ''), 'aria-label': t.done ? 'Вернуть' : 'Выполнено', onclick: () => act('/api/tasks/' + t.id, { done: !t.done }) }, t.done ? '✓' : ''),
      h('div', { class: 'grow', onclick: () => editTask(t) }, h('div', { class: 't' }, t.title), sub ? h('div', { class: 's' }, sub) : null),
      overdue ? h('span', { class: 'badge warn' }, 'просрочено') : null);
  }
  function eventRow(e) {
    const sub = [e.time ? e.time + (e.dur ? '–' + endTime(e.time, e.dur) : '') : 'весь день', e.place, e.shared ? 'общее' : e.owner !== S.me.id ? 'для ' + nameOf(e.owner) : e.createdBy !== S.me.id ? 'от ' + nameOf(e.createdBy) : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'row', onclick: () => editEvent(e) },
      h('div', { class: 'grow' }, h('div', { class: 't' }, (e.shared ? '👪 ' : '') + e.title), h('div', { class: 's' }, sub)));
  }
  const endTime = (t, dur) => { const m = (+t.slice(0, 2)) * 60 + (+t.slice(3)) + dur; return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
  const billOf = id => S.bills.find(b => b.id === id) || { title: '—' };
  function payStatus(i) {
    if (!i.pay) return i.due < today() ? h('span', { class: 'badge warn' }, 'не оплачено') : h('span', { class: 'badge gray' }, 'к оплате');
    if (!i.pay.confirmedBy) return h('span', { class: 'badge wait' }, 'ждёт подтверждения');
    return h('span', { class: 'badge ok' }, 'оплачено ✓');
  }
  function instRow(i) {
    const b = billOf(i.billId), isConf = S.confirmer === S.me.id;
    const sub = [fmtDate(i.due), i.pay ? 'отметил(а) ' + nameOf(i.pay.paidBy) : '', b.category].filter(Boolean).join(' · ');
    const actions = [];
    if (!i.pay) actions.push(h('button', { class: 'btn sm', onclick: () => markPaid(i) }, 'Оплачено'));
    else if (!i.pay.confirmedBy && isConf) actions.push(h('button', { class: 'btn sm', onclick: () => act('/api/pays/' + i.pay.id, { confirm: true }, 'Подтверждено') }, 'Подтвердить'),
      h('button', { class: 'btn sm ghost', onclick: () => confirm('Отклонить отметку об оплате?') && act('/api/pays/' + i.pay.id, { reject: true }, 'Отметка снята') }, '✕'));
    else if (!i.pay.confirmedBy && i.pay.paidBy === S.me.id) actions.push(h('button', { class: 'btn sm ghost', onclick: () => act('/api/pays/' + i.pay.id, { delete: true }, 'Отметка снята') }, 'Отменить'));
    else if (i.pay.confirmedBy && isConf) actions.push(h('button', { class: 'x', 'aria-label': 'Снять оплату', onclick: () => confirm('Снять отметку об оплате?') && act('/api/pays/' + i.pay.id, { delete: true }, 'Отметка снята') }, '↺'));
    return h('div', { class: 'row' },
      h('div', { class: 'grow', onclick: () => editBill(b) }, h('div', { class: 't' }, b.title), h('div', { class: 's' }, sub), h('div', { style: 'margin-top:6px' }, payStatus(i))),
      h('div', { style: 'text-align:right;display:grid;gap:6px;justify-items:end' }, h('div', { class: 'amt' }, money(i.amount)), h('div', { class: 'btns' }, actions)));
  }
  function markPaid(i) {
    const b = billOf(i.billId);
    const amt = h('input', { inputmode: 'numeric', value: String(i.amount) });
    sheet('Оплачено: ' + b.title, close => h('div', { class: 'card form' },
      h('label', { class: 'f' }, 'Сумма, ₸', amt),
      S.confirmer !== S.me.id ? h('div', { class: 'hint' }, nameOf(S.confirmer) + ' увидит отметку и подтвердит оплату.') : null,
      h('button', { class: 'btn', onclick: async () => { if (await act('/api/pays', { billId: i.billId, period: i.period, amount: amt.value }, 'Отмечено')) close(); } }, 'Отметить оплату')));
  }

  /* ---------- Главная ---------- */
  function vHome() {
    const t = today(), wk = addDays(t, 7), out = [];
    const mine = S.tasks.filter(x => x.owner === S.me.id && !x.done);
    const urgent = mine.filter(x => x.due && x.due <= t);
    const fromSp = mine.filter(x => x.from !== S.me.id && !(x.due && x.due <= t));
    const ev = S.events.filter(e => (e.owner === S.me.id || e.shared) && e.date >= t && e.date <= wk).sort(cmpEv);
    const toConfirm = S.instances.filter(i => i.pay && !i.pay.confirmedBy);
    const due = S.instances.filter(i => !i.pay && i.due <= addDays(t, 10));
    if (!S.ai.configured && S.me.role === 'admin') out.push(h('div', { class: 'card pad hint', style: 'margin-top:8px' }, 'Чтобы кнопка 🎙 разбирала речь на задачи и встречи, подключите ИИ: ⚙︎ → ИИ.'));
    out.push(section('Сегодня и просрочено', null, h('div', { class: 'card' }, urgent.length ? urgent.map(taskRow) : empty('На сегодня дел нет'))));
    if (fromSp.length) out.push(section('Поручено мне', null, h('div', { class: 'card' }, fromSp.map(taskRow))));
    out.push(section('Ближайшие 7 дней', h('button', { class: 'lnk', onclick: () => go('cal') }, 'Все'), h('div', { class: 'card' }, ev.length ? groupByDate(ev, eventRow) : empty('Встреч нет'))));
    if (toConfirm.length) out.push(section(S.confirmer === S.me.id ? 'Подтвердите оплату' : 'Ждут подтверждения', null, h('div', { class: 'card' }, toConfirm.map(instRow))));
    out.push(section('Платежи в ближайшие 10 дней', h('button', { class: 'lnk', onclick: () => { UI.famTab = 'bills'; go('family'); } }, 'Все'), h('div', { class: 'card' }, due.length ? due.map(instRow) : empty('Всё оплачено'))));
    if (S.goals.length) out.push(section('Накопления', h('button', { class: 'lnk', onclick: () => { UI.famTab = 'goals'; go('family'); } }, 'Все'), S.goals.map(goalCard)));
    return out;
  }
  const cmpEv = (a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00'));
  function groupByDate(list, rowFn) {
    const out = []; let last = '';
    for (const e of list) {
      if (e.date !== last) { last = e.date; out.push(h('div', { class: 'row', style: 'min-height:0;padding:8px 16px;background:var(--bg);font-size:13px;color:var(--muted);font-weight:600' }, fmtDate(e.date))); }
      out.push(rowFn(e));
    }
    return out;
  }

  /* ---------- Дела ---------- */
  function vTasks() {
    const sp = spouse();
    const seg = h('div', { class: 'seg' }, [['mine', 'Мои'], ['given', sp ? 'Поручил(а) ' + sp.name : 'Поручено'], ['done', 'Выполненные']].map(([k, t]) =>
      h('button', { class: UI.taskTab === k ? 'on' : '', onclick: () => { UI.taskTab = k; render(); } }, t)));
    let list;
    const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt.localeCompare(b.createdAt);
    if (UI.taskTab === 'mine') list = S.tasks.filter(t => t.owner === S.me.id && !t.done).sort(byDue);
    else if (UI.taskTab === 'given') list = S.tasks.filter(t => t.from === S.me.id && t.owner !== S.me.id).sort((a, b) => a.done - b.done || byDue(a, b));
    else list = S.tasks.filter(t => t.owner === S.me.id && t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 50);
    return [seg, h('div', { style: 'height:10px' }), quickTask(), h('div', { class: 'card', style: 'margin-top:10px' }, list.length ? list.map(taskRow) : empty('Пусто'))];
  }
  function quickTask() {
    const title = h('input', { placeholder: 'Новое дело…', 'aria-label': 'Новое дело', enterkeyhint: 'done' });
    const due = h('input', { type: 'date', 'aria-label': 'Срок' });
    const sp = spouse();
    const who = h('select', { 'aria-label': 'Кому' }, h('option', { value: 'me' }, 'Мне'), sp ? h('option', { value: 'spouse', selected: UI.taskTab === 'given' }, sp.name) : null);
    const add = async e => { e.preventDefault(); if (!title.value.trim()) return; if (await act('/api/tasks', { title: title.value, due: due.value, owner: who.value }, 'Добавлено')) {} };
    return h('form', { class: 'card form', onsubmit: add }, title, h('div', { class: 'two' }, due, who), h('button', { class: 'btn' }, 'Добавить'));
  }
  function editTask(t) {
    const title = h('input', { value: t.title }), note = h('textarea', { style: 'min-height:80px' }, t.note || ''), due = h('input', { type: 'date', value: t.due || '' });
    const own = t.owner === S.me.id;
    sheet('Дело', close => h('div', { class: 'card form' },
      h('label', { class: 'f' }, 'Что сделать', title), h('label', { class: 'f' }, 'Срок', due), h('label', { class: 'f' }, 'Подробности', note),
      h('div', { class: 'hint' }, own ? (t.from !== S.me.id ? 'Поручил(а): ' + nameOf(t.from) : 'Ваше дело') : 'Исполнитель: ' + nameOf(t.owner)),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => { if (await act('/api/tasks/' + t.id, { title: title.value, note: note.value, due: due.value }, 'Сохранено')) close(); } }, 'Сохранить'),
        h('button', { class: 'btn danger', onclick: async () => { if (confirm('Удалить дело?') && await act('/api/tasks/' + t.id, { delete: true }, 'Удалено')) close(); } }, 'Удалить'))));
  }

  /* ---------- Календарь ---------- */
  function vCal() {
    const t = today();
    const up = S.events.filter(e => e.date >= t).sort(cmpEv).slice(0, 100);
    const past = S.events.filter(e => e.date < t && e.date >= addDays(t, -30)).sort(cmpEv).reverse().slice(0, 20);
    return [
      h('div', { class: 'btns', style: 'margin-top:4px' }, h('button', { class: 'btn', onclick: () => editEvent(null) }, '+ Встреча'), h('button', { class: 'btn sec', onclick: calHelp }, 'Подключить к iPhone')),
      section('Предстоящие', null, h('div', { class: 'card' }, up.length ? groupByDate(up, eventRow) : empty('Встреч нет'))),
      past.length ? section('Прошедшие 30 дней', null, h('div', { class: 'card' }, groupByDate(past, eventRow))) : null];
  }
  function editEvent(e) {
    const n = !e; e = e || { title: '', date: today(), time: '', dur: 60, place: '', note: '' };
    const title = h('input', { value: e.title, placeholder: 'Например: Врач, родительское собрание' });
    const d = h('input', { type: 'date', value: e.date }), tm = h('input', { type: 'time', value: e.time || '' });
    const dur = h('select', null, [[30, '30 мин'], [60, '1 час'], [90, '1,5 часа'], [120, '2 часа'], [180, '3 часа'], [240, '4 часа']].map(([v, l]) => h('option', { value: v, selected: (e.dur || 60) === v }, l)));
    const place = h('input', { value: e.place || '', placeholder: 'Место' }), note = h('textarea', { style: 'min-height:70px', placeholder: 'Заметка' }, e.note || '');
    const sp = spouse();
    const forWho = h('select', null, h('option', { value: 'me' }, 'Для меня'), sp ? h('option', { value: 'spouse' }, 'Для: ' + sp.name) : null, sp ? h('option', { value: 'both' }, 'Общее — для обоих') : null);
    sheet(n ? 'Новая встреча' : 'Встреча', close => h('div', { class: 'card form' },
      h('label', { class: 'f' }, 'Название', title), h('div', { class: 'two' }, h('label', { class: 'f' }, 'Дата', d), h('label', { class: 'f' }, 'Время (пусто — весь день)', tm)),
      h('div', { class: 'two' }, h('label', { class: 'f' }, 'Длительность', dur), n ? h('label', { class: 'f' }, 'Кому', forWho) : h('div')),
      place, note,
      !n ? h('div', { class: 'hint' }, e.shared ? 'Общее событие' : 'Добавил(а): ' + nameOf(e.createdBy)) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => {
          const b = { title: title.value, date: d.value, time: tm.value, dur: +dur.value, place: place.value, note: note.value };
          if (n) b.for = forWho.value;
          if (await act(n ? '/api/events' : '/api/events/' + e.id, b, 'Сохранено')) close();
        } }, 'Сохранить'),
        !n ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('Удалить встречу?') && await act('/api/events/' + e.id, { delete: true }, 'Удалено')) close(); } }, 'Удалить') : null)));
  }
  function calHelp() {
    const url = location.origin + S.me.calPath, web = url.replace(/^https?:/, 'webcal:');
    sheet('Календарь iPhone', close => h('div', { class: 'card form' },
      h('div', { class: 'hint' }, 'Ваши встречи, общие события, дела со сроком и неоплаченные платежи появятся в обычном «Календаре» iPhone. Ссылка личная — у супруга(и) своя.'),
      h('a', { class: 'btn', href: web, style: 'text-align:center;text-decoration:none;display:block' }, 'Подписаться на iPhone'),
      h('div', { class: 'hint' }, 'Если кнопка не сработала: Настройки → Календарь → Учётные записи → Добавить → Другое → Подписной календарь, и вставьте ссылку:'),
      h('div', { class: 'mono pwbox' }, url),
      h('button', { class: 'btn sec', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована'), () => toast('Скопируйте вручную')); } }, 'Скопировать ссылку'),
      h('div', { class: 'hint' }, 'Как часто iPhone обновляет календарь: Настройки → Календарь → Учётные записи → Загрузка данных. Чтобы приходили напоминания за 30 минут, в настройках подписки выключите «Удалить уведомления».'),
      h('button', { class: 'btn ghost', onclick: async () => { if (confirm('Старая ссылка перестанет работать, и календарь придётся подключить заново. Продолжить?') && await act('/api/cal/rotate', {}, 'Новая ссылка создана')) { close(); calHelp(); } } }, 'Сменить ссылку')));
  }

  /* ---------- Мои деньги (видны только мне) ---------- */
  const EXP_CAT = ['Продукты', 'Кафе', 'Транспорт', 'Дети', 'Здоровье', 'Одежда', 'Дом', 'Связь', 'Подарки', 'Развлечения', 'Прочее'];
  const INC_CAT = ['Зарплата', 'Подработка', 'Возврат', 'Подарок', 'Прочее'];
  function monthNav(key) {
    return h('div', { class: 'monthnav' },
      h('button', { 'aria-label': 'Предыдущий месяц', onclick: () => { UI[key] = addMonths(UI[key], -1); render(); } }, '‹'),
      h('b', null, monthName(UI[key])),
      h('button', { 'aria-label': 'Следующий месяц', onclick: () => { UI[key] = addMonths(UI[key], 1); render(); } }, '›'));
  }
  function vMoney() {
    const list = S.tx.filter(t => t.date.slice(0, 7) === UI.mMonth).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const inc = list.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0), exp = list.filter(t => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
    const cats = {}; list.filter(t => t.kind === 'expense').forEach(t => { cats[t.category] = (cats[t.category] || 0) + t.amount; });
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    return [
      h('div', { class: 'hint', style: 'margin:0 4px 6px' }, 'Личный бюджет — его видите только вы.'),
      monthNav('mMonth'),
      h('div', { class: 'stats' }, stat('Доходы', money(inc)), stat('Расходы', money(exp)), stat('Остаток', money(inc - exp))),
      quickTx(),
      top.length ? section('Расходы по категориям', null, h('div', { class: 'card' }, top.map(([c, v]) => h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, c), h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.max(3, Math.round(v / exp * 100)) + '%' }))), h('div', { class: 'amt' }, money(v)))))) : null,
      section('Операции', null, h('div', { class: 'card' }, list.length ? list.map(t => h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, t.category), h('div', { class: 's' }, [fmtDate(t.date), t.note].filter(Boolean).join(' · '))),
        h('div', { class: 'amt', style: t.kind === 'income' ? 'color:var(--ok)' : '' }, (t.kind === 'income' ? '+' : '−') + money(t.amount)),
        h('button', { class: 'x', 'aria-label': 'Удалить', onclick: () => confirm('Удалить операцию?') && act('/api/tx/' + t.id, { delete: true }, 'Удалено') }, '×'))) : empty('Операций нет')))];
  }
  const stat = (l, v) => h('div', { class: 'stat' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v));
  function quickTx() {
    let kind = 'expense';
    const amount = h('input', { inputmode: 'numeric', placeholder: 'Сумма, ₸', 'aria-label': 'Сумма' });
    const cat = h('select', { 'aria-label': 'Категория' });
    const fill = () => cat.replaceChildren(...(kind === 'expense' ? EXP_CAT : INC_CAT).map(c => h('option', null, c)));
    fill();
    const d = h('input', { type: 'date', value: today(), 'aria-label': 'Дата' });
    const note = h('input', { placeholder: 'Комментарий (необязательно)', 'aria-label': 'Комментарий' });
    const seg = h('div', { class: 'seg' });
    const segFill = () => seg.replaceChildren(...[['expense', 'Расход'], ['income', 'Доход']].map(([k, t]) => h('button', { type: 'button', class: kind === k ? 'on' : '', onclick: () => { kind = k; fill(); segFill(); } }, t)));
    segFill();
    return h('form', { class: 'card form', style: 'margin-top:10px', onsubmit: async e => { e.preventDefault(); await act('/api/tx', { kind, amount: amount.value, category: cat.value, date: d.value, note: note.value }, 'Записано'); } },
      seg, h('div', { class: 'two' }, amount, cat), h('div', { class: 'two' }, d, note), h('button', { class: 'btn' }, 'Записать'));
  }

  /* ---------- Семья: общие платежи и накопления ---------- */
  function vFamily() {
    const seg = h('div', { class: 'seg' }, [['bills', 'Обязательные платежи'], ['goals', 'Накопления']].map(([k, t]) =>
      h('button', { class: UI.famTab === k ? 'on' : '', onclick: () => { UI.famTab = k; render(); } }, t)));
    return [seg, UI.famTab === 'goals' ? vGoals() : vBills()];
  }
  function vBills() {
    const m = UI.fMonth;
    const list = S.instances.filter(i => i.period === m || (i.period === 'once' && i.due && i.due.slice(0, 7) === m));
    const total = list.reduce((s, i) => s + i.amount, 0), paid = list.filter(i => i.pay).reduce((s, i) => s + i.amount, 0);
    const overdue = S.instances.filter(i => !i.pay && i.due < today() && i.due.slice(0, 7) < m.slice(0, 7) && m === today().slice(0, 7));
    return [
      monthNav('fMonth'),
      h('div', { class: 'stats' }, stat('Всего', money(total)), stat('Оплачено', money(paid)), stat('Осталось', money(total - paid))),
      h('div', { class: 'hint', style: 'margin:8px 4px 0' }, 'Подтверждает оплату: ' + nameOf(S.confirmer) + '.'),
      overdue.length ? section('Не оплачено в прошлые месяцы', null, h('div', { class: 'card' }, overdue.map(instRow))) : null,
      section('Платежи месяца', h('button', { class: 'lnk', onclick: () => editBill(null) }, '+ Добавить'), h('div', { class: 'card' }, list.length ? list.map(instRow) : empty('Нет платежей. Добавьте ипотеку, кредит, садик…')))];
  }
  function editBill(b) {
    const n = !b; b = b || { title: '', amount: '', category: '', kind: 'monthly', day: 10, until: '', dueDate: today() };
    let kind = b.kind;
    const title = h('input', { value: b.title, placeholder: 'Ипотека, кредит, садик…' }), amount = h('input', { inputmode: 'numeric', value: b.amount === '' ? '' : String(b.amount), placeholder: 'Сумма, ₸' });
    const cat = h('input', { value: b.category || '', placeholder: 'Категория (необязательно)', list: 'billcats' });
    const from = h('input', { type: 'month', value: b.from || '' });
    const day = h('input', { inputmode: 'numeric', value: String(b.day || 10) }), until = h('input', { type: 'month', value: b.until || '' }), dd = h('input', { type: 'date', value: b.dueDate || today() });
    const box = h('div', { style: 'display:grid;gap:10px' });
    const seg = h('div', { class: 'seg' });
    const fill = () => {
      seg.replaceChildren(...[['monthly', 'Каждый месяц'], ['once', 'Разовый']].map(([k, t]) => h('button', { type: 'button', disabled: !n, class: kind === k ? 'on' : '', onclick: () => { kind = k; fill(); } }, t)));
      box.replaceChildren(...(kind === 'monthly' ? [h('div', { class: 'two' }, h('label', { class: 'f' }, 'Число месяца', day), h('label', { class: 'f' }, 'До (необязательно)', until)), h('label', { class: 'f' }, n ? 'Начиная с месяца (пусто — с ближайшего)' : 'Начиная с месяца', from)] : [h('label', { class: 'f' }, 'Оплатить до', dd)]));
    };
    fill();
    sheet(n ? 'Новый общий платёж' : 'Платёж', close => h('div', { class: 'card form' },
      seg, h('label', { class: 'f' }, 'Название', title), h('label', { class: 'f' }, 'Сумма, ₸', amount), box, cat,
      h('datalist', { id: 'billcats' }, ['Ипотека', 'Кредит', 'Садик', 'Коммуналка', 'Связь', 'Страховка', 'Кружки'].map(c => h('option', { value: c }))),
      !n && kind === 'monthly' ? h('div', { class: 'hint' }, 'Новая сумма применится к неоплаченным месяцам; уже отмеченные оплаты сохранят свою сумму.') : null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => {
          const body = { title: title.value, amount: amount.value, category: cat.value, kind, day: day.value, until: until.value, dueDate: dd.value };
          if (from.value) body.from = from.value;
          if (await act(n ? '/api/bills' : '/api/bills/' + b.id, body, 'Сохранено')) close();
        } }, 'Сохранить'),
        !n ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('Убрать платёж из списка? История оплат сохранится.') && await act('/api/bills/' + b.id, { delete: true }, 'Платёж убран')) close(); } }, 'Удалить') : null)));
  }
  function goalStats(g) {
    const deps = S.deposits.filter(d => d.goalId === g.id);
    const have = deps.reduce((s, d) => s + d.amount, 0);
    let perMonth = 0;
    if (g.target && g.deadline && have < g.target) {
      const t = today(); const months = Math.max(1, (+g.deadline.slice(0, 4) - +t.slice(0, 4)) * 12 + (+g.deadline.slice(5, 7) - +t.slice(5, 7)));
      perMonth = Math.ceil((g.target - have) / months);
    }
    return { deps, have, perMonth };
  }
  function goalCard(g) {
    const { have, perMonth } = goalStats(g);
    const pct = g.target ? Math.min(100, Math.round(have / g.target * 100)) : 0;
    return h('div', { class: 'card pad', onclick: () => openGoal(g) },
      h('div', { style: 'display:flex;gap:8px;align-items:baseline' }, h('b', { style: 'flex:1' }, g.title), h('span', { class: 'amt' }, money(have))),
      g.target ? h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })) : null,
      h('div', { class: 's hint', style: 'margin-top:6px' }, [g.target ? pct + '% из ' + money(g.target) : '', g.deadline ? 'к ' + fmtDate(g.deadline) : '', perMonth ? 'нужно ~' + money(perMonth) + '/мес' : ''].filter(Boolean).join(' · ')));
  }
  function vGoals() {
    return [h('div', { class: 'btns', style: 'margin:10px 0' }, h('button', { class: 'btn', onclick: () => editGoal(null) }, '+ Цель')),
      S.goals.length ? S.goals.map(goalCard) : h('div', { class: 'card' }, empty('Целей пока нет — например, «Отпуск летом»'))];
  }
  function openGoal(g) {
    const { deps, have } = goalStats(g);
    const amt = h('input', { inputmode: 'numeric', placeholder: 'Сумма, ₸' }), note = h('input', { placeholder: 'Комментарий' });
    sheet(g.title, close => [
      h('div', { class: 'stats' }, stat('Накоплено', money(have)), stat('Цель', g.target ? money(g.target) : '—'), stat('Срок', g.deadline ? fmtDate(g.deadline) : '—')),
      h('div', { class: 'card form', style: 'margin-top:10px' }, h('div', { class: 'two' }, amt, note),
        h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: async () => { if (await act('/api/deposits', { goalId: g.id, amount: amt.value, note: note.value }, 'Отложено')) { close(); } } }, 'Отложить'),
          h('button', { class: 'btn sec', onclick: async () => { if (await act('/api/deposits', { goalId: g.id, amount: amt.value, note: note.value, withdraw: true }, 'Списано')) { close(); } } }, 'Снять'))),
      h('h2', null, 'История'),
      h('div', { class: 'card' }, deps.length ? deps.slice().sort((a, b) => b.date.localeCompare(a.date)).map(d => h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, nameOf(d.by)), h('div', { class: 's' }, [fmtDate(d.date), d.note].filter(Boolean).join(' · '))),
        h('div', { class: 'amt', style: d.amount < 0 ? 'color:var(--warn)' : '' }, (d.amount > 0 ? '+' : '') + money(d.amount)),
        d.by === S.me.id ? h('button', { class: 'x', 'aria-label': 'Удалить', onclick: async () => { if (confirm('Удалить взнос?') && await act('/api/deposits/' + d.id, { delete: true }, 'Удалено')) close(); } }, '×') : null)) : empty('Взносов пока нет')),
      h('div', { class: 'btns', style: 'margin-top:12px' }, h('button', { class: 'btn sec', onclick: () => { close(); editGoal(g); } }, 'Изменить цель'))]);
  }
  function editGoal(g) {
    const n = !g; g = g || { title: '', target: '', deadline: '' };
    const title = h('input', { value: g.title, placeholder: 'Отпуск, машина, ремонт…' }), target = h('input', { inputmode: 'numeric', value: g.target ? String(g.target) : '', placeholder: 'Сколько нужно, ₸' }), dl = h('input', { type: 'date', value: g.deadline || '' });
    sheet(n ? 'Новая цель' : 'Цель', close => h('div', { class: 'card form' },
      h('label', { class: 'f' }, 'Название', title), h('div', { class: 'two' }, h('label', { class: 'f' }, 'Сумма цели', target), h('label', { class: 'f' }, 'К какой дате', dl)),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => { if (await act(n ? '/api/goals' : '/api/goals/' + g.id, { title: title.value, target: target.value, deadline: dl.value }, 'Сохранено')) close(); } }, 'Сохранить'),
        !n ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('Убрать цель?') && await act('/api/goals/' + g.id, { delete: true }, 'Цель убрана')) close(); } }, 'Удалить') : null)));
  }

  /* ---------- Ассистент: вопросы и поручения, ответ голосом ---------- */
  let CHAT = [], spoken = false;
  let voiceOn = true;
  try { voiceOn = localStorage.getItem('dom.voice') !== '0'; } catch (e) {}
  const ruVoice = () => { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; return vs.find(v => /^ru(-|_|$)/i.test(v.lang) && /Milena|Yuri|Katya|Google/i.test(v.name)) || vs.find(v => /^ru/i.test(v.lang)); };
  // iPhone разрешает озвучку только после нажатия — «будим» её беззвучной фразой прямо в момент нажатия кнопки
  function unlockSpeech() {
    if (spoken || !window.speechSynthesis) return;
    try { const x = new SpeechSynthesisUtterance(' '); x.volume = 0; x.lang = 'ru-RU'; speechSynthesis.speak(x); spoken = true; } catch (e) {}
  }
  function speak(t) {
    if (!voiceOn || !window.speechSynthesis || !t) return;
    try { speechSynthesis.cancel(); const x = new SpeechSynthesisUtterance(t); x.lang = 'ru-RU'; const v = ruVoice(); if (v) x.voice = v; x.rate = 1.05; speechSynthesis.speak(x); } catch (e) {}
  }
  function openAssistant() {
    if (!S.ai.configured) { openDictate(); return; }
    const sp = spouse();
    const log = h('div', { class: 'chat', 'aria-live': 'polite' });
    const draw = () => {
      log.replaceChildren(...(CHAT.length ? CHAT.map(m => h('div', { class: 'msg ' + m.role }, m.text)) :
        [h('div', { class: 'hint', style: 'padding:4px 2px' }, 'Спросите или поручите голосом — нажмите 🎤 на клавиатуре iPhone. Например: «Что у меня завтра?», «Сколько осталось заплатить в этом месяце?», «Сколько отложили на отпуск?»' + (sp ? ', «Поставь ' + sp.name + ' задачу купить хлеб»' : '') + '.')]));
      log.scrollTop = log.scrollHeight;
    };
    draw();
    const ta = h('textarea', { rows: 2, style: 'min-height:60px', placeholder: 'Спросите или поручите…', 'aria-label': 'Вопрос ассистенту', enterkeyhint: 'send' });
    const send = h('button', { class: 'btn', style: 'flex:1' }, 'Отправить');
    const vbtn = h('button', { class: 'btn sec', 'aria-label': 'Озвучка ответов' });
    const vfill = () => { vbtn.textContent = voiceOn ? '🔊' : '🔇'; };
    vfill();
    vbtn.onclick = () => { voiceOn = !voiceOn; try { localStorage.setItem('dom.voice', voiceOn ? '1' : '0'); } catch (e) {} if (!voiceOn && window.speechSynthesis) speechSynthesis.cancel(); else unlockSpeech(); vfill(); toast(voiceOn ? 'Ответы озвучиваются' : 'Озвучка выключена'); };
    const go = async () => {
      const text = ta.value.trim(); if (!text || send.disabled) { ta.focus(); return; }
      unlockSpeech();
      const hist = CHAT.slice(-8).map(m => ({ role: m.role, content: m.text }));
      CHAT.push({ role: 'user', text }); ta.value = ''; draw();
      send.disabled = true; send.textContent = 'Думаю…';
      try {
        const r = await api('/api/assistant', { text, history: hist });
        CHAT.push({ role: 'assistant', text: r.reply }); draw(); speak(r.reply);
        if (r.changed) await refresh();
      } catch (e) { CHAT.push({ role: 'assistant', text: e.message }); draw(); }
      send.disabled = false; send.textContent = 'Отправить';
    };
    send.onclick = go;
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    sheet('Ассистент', close => [
      log,
      h('div', { class: 'card form' }, ta, h('div', { class: 'btns' }, send, vbtn)),
      h('div', { class: 'btns', style: 'margin-top:8px;justify-content:space-between' },
        h('button', { class: 'btn ghost sm', onclick: () => { CHAT = []; if (window.speechSynthesis) speechSynthesis.cancel(); draw(); } }, 'Новый разговор'),
        h('button', { class: 'btn ghost sm', onclick: () => { if (window.speechSynthesis) speechSynthesis.cancel(); close(); openDictate(); } }, 'Много записей с проверкой →'))]);
    setTimeout(() => ta.focus(), 250);
  }
  if (window.speechSynthesis) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch (e) {} }

  /* ---------- Надиктовать ---------- */
  const TYPES = { task: 'Дело', event: 'Встреча', expense: 'Расход', income: 'Доход', bill: 'Общий платёж', bill_paid: 'Оплата платежа', goal: 'Цель', deposit: 'В накопления', note: 'Заметка' };
  function openDictate() {
    const ta = h('textarea', { placeholder: 'Например: «Завтра в 15:00 врач с сыном. Купить подарок маме до пятницы. Попроси жену оплатить садик 35 тысяч до 10-го. Потратил 8 500 на продукты. Отложили 50 тысяч на отпуск».', 'aria-label': 'Текст' });
    const err = h('div', { class: 'err' }), out = h('div');
    const btn = h('button', { class: 'btn' }, 'Разобрать');
    btn.onclick = async () => {
      err.textContent = ''; if (!ta.value.trim()) { ta.focus(); return; }
      btn.disabled = true; btn.textContent = 'Разбираю…';
      try { const r = await api('/api/parse', { text: ta.value }); showItems(r.items, out, ta); }
      catch (e) { err.textContent = e.message; }
      btn.disabled = false; btn.textContent = 'Разобрать';
    };
    sheet('Надиктовать', () => [
      h('div', { class: 'hint', style: 'margin:0 2px 8px' }, 'Нажмите 🎤 на клавиатуре iPhone и говорите. Потом — «Разобрать»: дела, встречи, платежи и расходы разложатся сами, а вы проверите перед сохранением.'),
      h('div', { class: 'card form' }, ta, err,
        S.ai.configured ? btn : h('div', { class: 'hint' }, S.me.role === 'admin' ? 'ИИ ещё не подключён: ⚙︎ → ИИ.' : 'ИИ ещё не подключён — попросите ' + nameOf(S.users.find(u => u.role === 'admin').id) + ' указать ключ в настройках.')),
      out]);
    setTimeout(() => ta.focus(), 250);
  }
  function showItems(items, out, ta) {
    if (!items.length) { out.replaceChildren(h('div', { class: 'card', style: 'margin-top:10px' }, empty('Ничего не распознано — попробуйте сказать подробнее'))); return; }
    const sp = spouse();
    const rows = items.map(it => {
      const on = h('button', { class: 'chk on', 'aria-label': 'Сохранять' }, '✓');
      const type = h('select', null, Object.entries(TYPES).map(([k, v]) => h('option', { value: k, selected: k === it.type }, v)));
      const title = h('input', { value: it.title, 'aria-label': 'Название' });
      const d = h('input', { type: 'date', value: it.date || '', 'aria-label': 'Дата' }), tm = h('input', { type: 'time', value: it.time || '', 'aria-label': 'Время' });
      const amt = h('input', { inputmode: 'numeric', value: it.amount === null || it.amount === undefined ? '' : String(it.amount), placeholder: 'Сумма', 'aria-label': 'Сумма' });
      const who = h('select', { 'aria-label': 'Для кого' }, h('option', { value: 'me', selected: it.who === 'me' }, 'Мне'), sp ? h('option', { value: 'spouse', selected: it.who === 'spouse' }, sp.name) : null, sp ? h('option', { value: 'both', selected: it.who === 'both' }, 'Обоим') : null);
      const extra = h('div', { class: 'two' });
      const fit = () => {
        const t = type.value;
        const parts = [];
        if (['task', 'event', 'expense', 'income', 'bill', 'goal', 'deposit', 'bill_paid'].includes(t)) parts.push(d);
        if (t === 'event') parts.push(tm);
        if (['expense', 'income', 'bill', 'goal', 'deposit', 'bill_paid'].includes(t)) parts.push(amt);
        if (t === 'task' || t === 'event') parts.push(who);
        extra.replaceChildren(...parts);
      };
      type.onchange = fit; fit();
      const row = h('div', { class: 'item' }, on, h('div', { class: 'fields' }, type, title, extra,
        it.type === 'bill' ? h('div', { class: 'hint' }, it.recurring ? 'Каждый месяц' + (it.day_of_month ? ', ' + it.day_of_month + '-го' : '') : 'Разовый') : null,
        it.ref ? h('div', { class: 'hint' }, '→ ' + it.ref) : null, it.note ? h('div', { class: 'hint' }, it.note) : null));
      let enabled = true;
      on.onclick = () => { enabled = !enabled; on.classList.toggle('on', enabled); on.textContent = enabled ? '✓' : ''; row.classList.toggle('off', !enabled); };
      return { row, get: () => enabled ? Object.assign({}, it, { type: type.value, title: title.value, date: d.value, time: tm.value, amount: amt.value === '' ? null : Number(amt.value.replace(/\s/g, '')), who: who.value }) : null };
    });
    const save = h('button', { class: 'btn' }, 'Сохранить выбранное');
    save.onclick = async () => {
      const items2 = rows.map(r => r.get()).filter(Boolean); if (!items2.length) return;
      save.disabled = true;
      try {
        const r = await api('/api/apply', { items: items2 });
        toast('Сохранено: ' + r.saved);
        if (r.errors.length) out.replaceChildren(h('div', { class: 'card pad err', style: 'margin-top:10px' }, 'Не сохранено: ' + r.errors.join('; ')));
        else { out.replaceChildren(); ta.value = ''; }
        await refresh();
      } catch (e) { toast(e.message); }
      save.disabled = false;
    };
    out.replaceChildren(h('h2', null, 'Проверьте'), h('div', { class: 'card' }, rows.map(r => r.row)), h('div', { class: 'btns', style: 'margin-top:12px' }, save));
  }

  function siriHelp(url) {
    const box = h('div', { style: 'display:grid;gap:10px' });
    const step = (n, ...t) => h('div', { class: 'row', style: 'align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)' }, h('span', { class: 'badge' }, String(n)), h('div', { class: 'grow' }, ...t));
    if (url) box.append(
      h('div', { class: 'hint' }, 'Ваша личная ссылка для Siri. Она даёт доступ к вашим делам и бюджету — никому её не пересылайте.'),
      h('div', { class: 'mono pwbox' }, url),
      h('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована'), () => toast('Скопируйте вручную')); } }, 'Скопировать ссылку'),
      h('div', { class: 'card pad' },
        h('b', null, 'Настройка на iPhone (один раз, 2 минуты)'),
        step(1, 'Откройте приложение «Команды» → вкладка «Команды» → «+».'),
        step(2, 'Найдите и добавьте действие «Диктовать текст». Язык — русский.'),
        step(3, 'Добавьте действие «Получить содержимое URL». Вставьте скопированную ссылку. Нажмите «›» (подробнее): Метод — ', h('b', null, 'POST'), ', Текст запроса — ', h('b', null, 'Форма'), '. Нажмите «Добавить поле» → «Текст»: ключ ', h('b', null, 'text'), ', значение — выберите переменную «Продиктованный текст».'),
        step(4, 'Добавьте действие «Произнести текст» — в нём должно стоять «Содержимое URL».'),
        step(5, 'Вверху назовите команду ', h('b', null, 'Дом'), ' и нажмите «Готово». Теперь говорите: «Привет, Siri, Дом» — и ваш вопрос или поручение.')));
    else box.append(
      h('div', { class: 'hint' }, 'Говорите «Привет, Siri, Дом» — и задавайте вопрос или поручение голосом, а ответ Siri прочитает вслух. Работает и с заблокированного экрана, и в машине.'),
      S.me.siri ? h('div', { class: 'hint' }, 'Siri уже подключена. Если потеряли телефон или хотите настроить заново — выдайте новую ссылку, старая перестанет работать.') : null);
    sheet('Siri', close => [box,
      h('div', { class: 'btns', style: 'margin-top:12px' },
        h('button', { class: url ? 'btn ghost' : 'btn', onclick: async () => {
          if (S.me.siri && !url && !confirm('Старая ссылка для Siri перестанет работать. Продолжить?')) return;
          try { const r = await api('/api/siri/token', {}); close(); await refresh(); siriHelp(location.origin + r.path); } catch (e) { toast(e.message); }
        } }, url ? 'Выдать другую ссылку' : S.me.siri ? 'Выдать новую ссылку' : 'Получить ссылку для Siri'),
        S.me.siri ? h('button', { class: 'btn ghost', onclick: async () => { if (confirm('Отключить Siri? Команда на iPhone перестанет работать.') && await act('/api/siri/off', {}, 'Siri отключена')) close(); } }, 'Отключить') : null)]);
  }

  /* ---------- Уведомления ---------- */
  const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function currentSub() { try { const r = await navigator.serviceWorker.ready; return await r.pushManager.getSubscription(); } catch (e) { return null; } }
  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error(isIOS() && !standalone() ? 'Откройте «Дом» с иконки на экране «Домой» — в обычном Safari уведомления недоступны' : 'Этот браузер не поддерживает уведомления');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Уведомления запрещены. Включите их: Настройки iPhone → Уведомления → Дом');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await api('/api/push/subscribe', sub.toJSON());
  }
  async function notifySettings() {
    const here = await currentSub();
    const prefs = S.me.notify || {};
    const KINDS = [['family', 'Новые дела и встречи от супруга'], ['confirm', 'Оплата отмечена — нужно подтвердить'], ['confirmed', 'Моя оплата подтверждена'], ['due', 'Платёж завтра или просрочен (в 9:00)'], ['morning', 'Утренняя сводка на день (в 8:30)']];
    const err = h('div', { class: 'err' });
    sheet('Уведомления', close => {
      const out = [];
      if (isIOS() && !standalone()) out.push(h('div', { class: 'card pad hint' }, 'На iPhone уведомления работают, только если «Дом» открыт с иконки на экране «Домой»: в Safari нажмите «Поделиться» → «На экран Домой», откройте с иконки и вернитесь сюда. Нужна iOS 16.4 или новее.'));
      out.push(h('div', { class: 'card form' },
        h('div', { class: 'hint' }, here ? 'На этом устройстве уведомления включены.' : 'На этом устройстве уведомления выключены.'),
        err,
        h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: async e => { err.textContent = ''; e.target.disabled = true; try { await enablePush(); await refresh(); toast('Уведомления включены'); close(); notifySettings(); } catch (x) { err.textContent = x.message; } e.target.disabled = false; } }, here ? 'Переподключить' : 'Включить на этом устройстве'),
          S.me.pushDevices ? h('button', { class: 'btn sec', onclick: async () => { try { const r = await api('/api/push/test', {}); toast(r.sent ? 'Отправлено — проверьте уведомление' : 'Не удалось доставить — переподключите уведомления'); } catch (x) { toast(x.message); } } }, 'Проверить') : null,
          here ? h('button', { class: 'btn ghost', onclick: async () => { try { await api('/api/push/unsubscribe', { endpoint: here.endpoint }); await here.unsubscribe(); await refresh(); toast('Выключено на этом устройстве'); close(); } catch (x) { toast(x.message); } } }, 'Выключить') : null)));
      out.push(h('h2', null, 'Что присылать'));
      out.push(h('div', { class: 'card' }, KINDS.map(([k, t]) => {
        const on = prefs[k] !== false;
        return h('div', { class: 'row', onclick: () => act('/api/push/prefs', { [k]: !on }).then(() => { close(); notifySettings(); }) },
          h('button', { class: 'chk' + (on ? ' on' : ''), 'aria-label': t }, on ? '✓' : ''), h('div', { class: 'grow' }, t));
      })));
      return out;
    });
  }

  /* ---------- Настройки ---------- */
  async function openSettings() {
    const err = h('div', { class: 'err' });
    const old = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Текущий пароль' }), pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Новый пароль' });
    const name = h('input', { value: S.me.name });
    const admin = h('div');
    sheet('Настройки', close => [
      h('h2', null, 'Профиль'),
      h('div', { class: 'card form' }, h('label', { class: 'f' }, 'Имя', name), old, pw, err,
        h('button', { class: 'btn sec', onclick: async () => { err.textContent = ''; try { await api('/api/password', { old: old.value, password: pw.value, name: name.value }); toast('Сохранено'); old.value = pw.value = ''; await refresh(); } catch (e) { err.textContent = e.message; } } }, 'Сменить пароль')),
      h('h2', null, 'Оформление'),
      h('div', { class: 'seg' }, [['man', 'Мужское'], ['woman', 'Женское'], ['neutral', 'Нейтральное']].map(([k, t]) =>
        h('button', { class: (S.me.theme || 'neutral') === k ? 'on' : '', onclick: async () => { document.documentElement.dataset.theme = k; if (await act('/api/theme', { theme: k }, 'Оформление сохранено')) { close(); openSettings(); } } }, t))),
      h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'btn sec', onclick: () => { close(); calHelp(); } }, 'Календарь iPhone')),
      h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'btn sec', onclick: () => { close(); siriHelp(); } }, S.me.siri ? 'Siri: подключена' : 'Подключить Siri')),
      h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'btn sec', onclick: () => { close(); notifySettings(); } }, S.me.pushDevices ? 'Уведомления: включены' : 'Включить уведомления')),
      admin,
      h('div', { class: 'btns', style: 'margin-top:20px' }, h('button', { class: 'btn ghost', onclick: async () => { await api('/api/logout', {}).catch(() => {}); S = null; close(); renderLogin(); } }, 'Выйти'))]);
    if (S.me.role !== 'admin') return;
    let info; try { info = await api('/api/admin/info'); } catch (e) { admin.replaceChildren(h('div', { class: 'err' }, e.message)); return; }
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: info.ai.configured ? 'Ключ задан (…' + info.ai.keyTail + '). Новый ключ — сюда' : 'Ключ Anthropic: sk-ant-…' });
    const model = h('select', null, info.ai.models.map(m => h('option', { value: m, selected: m === info.ai.model }, m)));
    const conf = h('select', null, info.users.filter(u => u.active).map(u => h('option', { value: u.id, selected: u.id === info.confirmer }, u.name)));
    const nl = h('input', { autocapitalize: 'none', placeholder: 'Логин латиницей (например, aigerim)' }), nn = h('input', { placeholder: 'Имя' });
    const pwOut = h('div');
    const showPw = r => pwOut.replaceChildren(h('div', { class: 'pwbox', style: 'margin-top:10px' }, h('div', null, 'Передайте лично (не в общий чат):'), h('div', { class: 'mono' }, 'Логин: ' + r.login), h('div', { class: 'mono' }, 'Временный пароль: ' + r.password), h('div', { class: 'hint' }, 'При первом входе приложение попросит сменить пароль. Этот пароль больше нигде не показывается.')));
    admin.replaceChildren(
      h('h2', null, 'ИИ (разбор речи)'),
      h('div', { class: 'card form' },
        h('div', { class: 'hint' }, 'Ключ вводится только здесь, хранится на сервере и наружу не отдаётся. Лучше создать для этого сайта отдельный ключ в console.anthropic.com.'),
        key, h('label', { class: 'f' }, 'Модель', model),
        h('div', { class: 'hint' }, 'В этом месяце: разборов ' + info.ai.runs + ', токенов ' + (info.ai.inTok + info.ai.outTok).toLocaleString('ru-RU')),
        h('div', { class: 'btns' },
          h('button', { class: 'btn sec', onclick: async () => { const b = { model: model.value }; if (key.value.trim()) b.key = key.value.trim(); if (await act('/api/admin/ai', b, 'Сохранено')) { key.value = ''; openSettings(); } } }, 'Сохранить'),
          info.ai.configured ? h('button', { class: 'btn ghost', onclick: async () => { if (confirm('Удалить ключ с сервера?') && await act('/api/admin/ai', { clear: true }, 'Ключ удалён')) openSettings(); } }, 'Удалить ключ') : null)),
      h('h2', null, 'Кто подтверждает оплату'),
      h('div', { class: 'card form' }, conf, h('button', { class: 'btn sec', onclick: () => act('/api/admin/confirmer', { uid: conf.value }, 'Сохранено') }, 'Сохранить')),
      h('h2', null, 'Участники'),
      h('div', { class: 'card' }, info.users.map(u => h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('div', { class: 't' }, u.name + (u.id === S.me.id ? ' (вы)' : '')), h('div', { class: 's' }, u.login + (u.mustChange ? ' · ещё не входил(а)' : '') + (!u.active ? ' · отключён(а)' : ''))),
        u.id !== S.me.id ? h('div', { class: 'btns' },
          h('button', { class: 'btn sm sec', onclick: async () => { if (!confirm('Выдать новый временный пароль?')) return; try { showPw(await api('/api/admin/users/' + u.id, { reset: true })); } catch (e) { toast(e.message); } } }, 'Пароль'),
          h('button', { class: 'btn sm ghost', onclick: async () => { if (confirm(u.active ? 'Отключить вход?' : 'Включить вход?') && await act('/api/admin/users/' + u.id, { active: !u.active }, 'Сохранено')) openSettings(); } }, u.active ? 'Откл.' : 'Вкл.')) : null))),
      h('div', { class: 'card form', style: 'margin-top:10px' }, h('b', null, 'Добавить участника'), nl, nn,
        h('button', { class: 'btn sec', onclick: async () => { try { const r = await api('/api/admin/users', { login: nl.value, name: nn.value }); showPw(r); nl.value = nn.value = ''; await refresh(); } catch (e) { toast(e.message); } } }, 'Добавить'), pwOut));
  }

  /* ---------- нижняя панель (sheet) ---------- */
  function sheet(title, build) {
    const shade = h('div', { class: 'shade' });
    const close = () => { shade.remove(); document.body.style.overflow = ''; };
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    box.append(h('div', { class: 'grab' }), h('h3', null, h('span', null, title), h('button', { class: 'iconbtn', 'aria-label': 'Закрыть', onclick: close }, '✕')));
    const c = build(close); [].concat(c).forEach(x => x && box.append(x));
    shade.append(box);
    shade.addEventListener('click', e => { if (e.target === shade) close(); });
    document.body.append(shade); document.body.style.overflow = 'hidden';
    return close;
  }

  /* ---------- запуск ---------- */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && !document.querySelector('.shade')) refresh().catch(() => {}); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  refresh().catch(() => { if (!S) renderLogin(); });
})();
