'use strict';
/* Ghostchat web (PWA). Stesso backend dell'app Android/iPhone: Supabase + LiveKit. */

// ---------- utilità ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem('gc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem('gc.' + k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem('gc.' + k); },
};
const b64e = u8 => btoa(String.fromCharCode(...u8));
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const x = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
const vib = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };

// ---------- configurazione e client ----------
const CFG = window.GHOST_CONFIG || {};
const BASE = (CFG.url || '').split('/rest/v1')[0].trim().replace(/\/+$/, '');
const configured = /^https:\/\//.test(BASE) && !!(CFG.key || '').trim();
const sb = configured ? supabase.createClient(BASE, CFG.key.trim(), { auth: { persistSession: true, autoRefreshToken: true } }) : null;

// ---------- lingue ----------
let LANGS = [], KEYS = [];
const allLangs = () => LANGS.concat(LS.get('langs', []));
function curLang() {
  const code = LS.get('lang', null) || (LANGS.some(l => l.code === (navigator.language || 'en').slice(0, 2)) ? (navigator.language || 'en').slice(0, 2) : 'en');
  return allLangs().find(l => l.code === code) || LANGS.find(l => l.code === 'en');
}
function t(k, ...a) {
  const en = LANGS.find(l => l.code === 'en');
  let s = (curLang()?.map[k]) ?? en?.map[k] ?? k;
  a.forEach(v => { s = s.replace(/%[ds]/, v); });
  return s;
}

// ---------- temi ----------
const PRESETS = [
  { name: 'Ghost Dark', dark: true, bg: '#0E1621', surface: '#17212B', primary: '#5EB5F7', onPrimary: '#0E1621', out: '#2B5278', in: '#182533', text: '#FFFFFF' },
  { name: 'Ghost Light', dark: false, bg: '#FFFFFF', surface: '#F1F3F5', primary: '#3390EC', onPrimary: '#FFFFFF', out: '#DCEEFF', in: '#F1F3F5', text: '#111111' },
  { name: 'Midnight', dark: true, bg: '#000000', surface: '#111111', primary: '#B388FF', onPrimary: '#000000', out: '#4A2F7A', in: '#1A1A1A', text: '#FFFFFF' },
  { name: 'Forest', dark: true, bg: '#0F1A14', surface: '#16251D', primary: '#6FCF97', onPrimary: '#0F1A14', out: '#245B3E', in: '#1A2B22', text: '#EAF5EE' },
];
const curTheme = () => LS.get('theme', PRESETS[0]);
function themeVars(th, el) {
  const s = el.style;
  s.setProperty('--bg', th.bg); s.setProperty('--surface', th.surface); s.setProperty('--primary', th.primary);
  s.setProperty('--on-primary', th.onPrimary); s.setProperty('--out', th.out); s.setProperty('--in', th.in); s.setProperty('--text', th.text);
  s.setProperty('--muted', th.text + '99'); s.setProperty('--line', th.text + '1f');
  s.colorScheme = th.dark ? 'dark' : 'light';
}
// Liquid Glass: automatico su iOS 26+ (Safari 26 = iOS 26), altrimenti stile classico.
function glassOn() {
  const mode = LS.get('glass', 'auto');
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const ua = navigator.userAgent;
  if (!/iPhone|iPad|iPod/.test(ua)) return false;
  const m = ua.match(/Version\/(\d+)/);
  if (m) LS.set('iosv', +m[1]);   // nella app installata la versione non c'è: la ricordiamo da Safari
  return LS.get('iosv', 0) >= 26;
}
function applyTheme() {
  const th = curTheme();
  themeVars(th, document.documentElement);
  document.body.classList.toggle('lg', glassOn());
  $('meta[name=theme-color]').setAttribute('content', th.surface);
}

// ---------- PIN ----------
const pinRec = () => LS.get('pin', null);
async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64d(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return b64e(new Uint8Array(bits));
}
async function setPin(pin) {
  const salt = b64e(crypto.getRandomValues(new Uint8Array(16)));
  LS.set('pin', { salt, hash: await pinHash(pin, salt), len: pin.length });
  LS.set('fails', 0); LS.set('lockUntil', 0);
  S.unlocked = true;
}
/** Ritorna 'ok' | 'wrong' | numero (timestamp fine blocco). */
async function tryUnlock(pin) {
  const now = Date.now(), until = LS.get('lockUntil', 0);
  if (now < until) return until;
  const rec = pinRec();
  if (rec && (await pinHash(pin, rec.salt)) === rec.hash) { LS.set('fails', 0); LS.set('lockUntil', 0); S.unlocked = true; return 'ok'; }
  const f = LS.get('fails', 0) + 1; LS.set('fails', f);
  if (f >= 5) { const lock = now + Math.min(30000 * 2 ** Math.min(f - 5, 6), 3600000); LS.set('lockUntil', lock); return lock; }
  return 'wrong';
}

// ---------- stato ----------
const S = {
  booting: true, session: null, me: null, profileLoaded: false, loadFailed: false,
  route: 'list', unlocked: false, chats: [], openChat: null, messages: [],
  busy: false, error: null, emailSent: null, form: {}, ch: null,
  call: null, incoming: null, timer: null, themeDraft: null, langDraft: null,
};
const screenName = () => {
  if (!configured) return 'noconfig';
  if (S.booting) return 'boot';
  if (S.loadFailed) return 'retry';
  if (!S.session || (S.profileLoaded && !S.me)) return 'onboarding';
  if (!S.profileLoaded) return 'boot';
  if (!pinRec()) return 'pinsetup';
  if (!S.unlocked) return 'lock';
  return S.route;
};
function render() {
  clearInterval(S.timer);
  applyTheme();
  const root = $('#app');
  const map = {
    noconfig: () => center('👻', t('not_configured')),
    boot: () => center('👻'),
    retry: () => center('👻', null, h('button', { class: 'btn primary', style: 'max-width:240px', onclick: boot }, t('retry'))),
    onboarding: scrOnboarding, pinsetup: scrPinSetup, lock: scrLock,
    list: () => scrList(false), archived: () => scrList(true), chat: scrChat,
    settings: scrSettings, themeEditor: scrThemeEditor, langEditor: scrLangEditor,
  };
  root.replaceChildren((map[screenName()] || map.boot)());
  if (screenName() === 'chat') scrollMsgs();
}
function center(icon, text, ...extra) {
  return h('div', { class: 'screen center' }, h('div', { class: 'big' }, icon), text ? h('p', {}, text) : null, ...extra);
}
async function run(fn) {
  S.error = null; S.busy = true; render();
  try { await fn(); } catch (e) { S.error = e.message || String(e); }
  S.busy = false; render();
}
const go = r => { S.route = r; render(); };
function avatar(p, size = 48) {
  const a = h('div', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${size / 2.4}px` });
  if (p.avatar_url) a.append(h('img', { src: p.avatar_url, alt: '' }));
  else a.append((p.display_name || p.tag || '?').trim().charAt(0).toUpperCase());
  return a;
}
const title = p => (p.display_name && p.display_name.trim()) || '@' + p.tag;
const fieldIn = (name, props) => h('input', Object.assign({ oninput: e => { S.form[name] = e.target.value; }, value: S.form[name] || '' }, props));
const errEl = () => (S.error ? h('p', { class: 'err' }, t(S.error)) : null);

// ---------- onboarding ----------
function scrOnboarding() {
  const step = !S.session ? (S.emailSent ? 1 : 0) : 2;
  let body;
  if (step === 0) {
    body = [
      fieldIn('email', { type: 'email', placeholder: t('email'), autocomplete: 'email', autocapitalize: 'none', autocorrect: 'off' }),
      h('button', { class: 'btn primary', disabled: S.busy, onclick: () => {
        const mail = (S.form.email || '').trim(); if (!mail.includes('@')) return;
        run(async () => { const { error } = await sb.auth.signInWithOtp({ email: mail }); if (error) throw error; S.emailSent = mail; });
      } }, t('send_code')),
    ];
  } else if (step === 1) {
    body = [
      h('p', { style: 'text-align:center' }, t('code_sent', S.emailSent)),
      fieldIn('code', { type: 'tel', inputmode: 'numeric', placeholder: t('code'), autocomplete: 'one-time-code' }),
      h('button', { class: 'btn primary', disabled: S.busy, onclick: () => {
        const code = (S.form.code || '').replace(/\D/g, ''); if (code.length < 6) return;
        run(async () => { const { error } = await sb.auth.verifyOtp({ email: S.emailSent, token: code, type: 'email' }); if (error) throw error; });
      } }, t('verify')),
      h('button', { class: 'btn', onclick: () => { S.emailSent = null; S.error = null; render(); } }, t('email')),
    ];
  } else {
    const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: e => { S.form.photo = e.target.files[0] || null; render(); } });
    const prev = h('div', { class: 'avatar', style: 'width:110px;height:110px;font-size:40px;background:var(--surface);cursor:pointer', onclick: () => file.click() },
      S.form.photo ? h('img', { src: URL.createObjectURL(S.form.photo), alt: '' }) : '📷');
    const tagIn = fieldIn('tag', { type: 'text', placeholder: '@' + t('tag'), autocapitalize: 'none', autocorrect: 'off', maxlength: 20,
      oninput: e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20); S.form.tag = e.target.value; btn.disabled = !/^[a-z0-9_]{3,20}$/.test(e.target.value) || S.busy; } });
    const btn = h('button', { class: 'btn primary', disabled: S.busy || !/^[a-z0-9_]{3,20}$/.test(S.form.tag || ''), onclick: () => run(createProfile) }, t('start'));
    body = [h('div', { style: 'display:grid;place-items:center' }, prev), file, h('p', { class: 'hint', style: 'text-align:center' }, t('choose_photo')),
      fieldIn('name', { type: 'text', placeholder: t('display_name') }), tagIn, h('p', { class: 'hint' }, t('tag_hint')), btn];
  }
  const hint = (!window.navigator.standalone && /iPhone|iPad/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches)
    ? h('p', { class: 'hint', style: 'text-align:center' }, t('install_hint')) : null;
  return h('div', { class: 'screen scroll' }, h('div', { class: 'center' },
    h('div', { class: 'big' }, '👻'), h('h2', { style: 'margin:0' }, step === 2 ? t('profile_title') : t('welcome')),
    h('div', { class: 'form' }, body, errEl(), hint)));
}

// ---------- backend: profilo, chat, messaggi ----------
async function uploadImage(file, max = 512) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
}
async function uploadAvatar(userId, file) {
  const blob = await uploadImage(file);
  const path = `${userId}/avatar.jpg`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
}
async function createProfile() {
  const id = S.session.user.id;
  const avatar_url = S.form.photo ? await uploadAvatar(id, S.form.photo) : null;
  const p = { id, tag: (S.form.tag || '').toLowerCase(), display_name: (S.form.name || '').trim() || null, avatar_url };
  const { error } = await sb.from('profiles').insert(p);
  if (error) throw new Error(error.code === '23505' ? 'tag_taken' : error.message);
  S.me = p; S.profileLoaded = true; S.form = {};
  await refreshChats(); startRealtime();
}
async function loadProfile() {
  S.loadFailed = false;
  try {
    const { data, error } = await sb.from('profiles').select('*').eq('id', S.session.user.id).maybeSingle();
    if (error) throw error;
    S.me = data; S.profileLoaded = true;
    if (S.me) { await refreshChats(); startRealtime(); }
  } catch (e) { S.loadFailed = true; }
}
async function refreshChats() {
  if (!S.me) return;
  try {
    const mine = (await sb.from('members').select('*').eq('user_id', S.me.id)).data || [];
    if (!mine.length) { S.chats = []; return; }
    const ids = mine.map(m => m.conversation_id);
    const others = (await sb.from('members').select('*').in('conversation_id', ids).neq('user_id', S.me.id)).data || [];
    const profs = {};
    if (others.length) ((await sb.from('profiles').select('*').in('id', others.map(o => o.user_id))).data || []).forEach(p => { profs[p.id] = p; });
    const recent = (await sb.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: false }).limit(300)).data || [];
    const last = {}; recent.forEach(m => { if (!last[m.conversation_id]) last[m.conversation_id] = m; });
    S.chats = mine.map(m => {
      const o = others.find(x => x.conversation_id === m.conversation_id);
      return o && profs[o.user_id] ? { id: m.conversation_id, other: profs[o.user_id], last: last[m.conversation_id] || null, archived: m.archived } : null;
    }).filter(Boolean).sort((a, b) => (b.last?.created_at || '').localeCompare(a.last?.created_at || ''));
  } catch (e) { toast(e.message); }
  if (screenName() === 'list' || screenName() === 'archived') render();
}
async function startChat(tag) {
  const { data, error } = await sb.rpc('start_chat', { other_tag: tag.trim().replace('@', '').toLowerCase() });
  if (error) { const m = error.message || ''; throw new Error(m.includes('user_not_found') ? 'user_not_found' : m.includes('cannot_chat_self') ? 'cannot_chat_self' : m); }
  await refreshChats();
  const c = S.chats.find(x => x.id === data);
  if (c) await openChat(c);
}
async function openChat(c) {
  S.openChat = c; S.messages = []; S.route = 'chat'; render();
  const { data, error } = await sb.from('messages').select('*').eq('conversation_id', c.id).order('created_at', { ascending: true });
  if (error) return toast(error.message);
  S.messages = data || []; if (S.route === 'chat') render();
}
async function toggleArchive(c) {
  const { error } = await sb.from('members').update({ archived: !c.archived }).eq('conversation_id', c.id).eq('user_id', S.me.id);
  if (error) toast(error.message); else refreshChats();
}
async function sendMsg(m) {
  m.id = uid(); m.conversation_id = S.openChat.id; m.sender_id = S.me.id;
  const local = Object.assign({ created_at: new Date().toISOString() }, m);
  S.messages.push(local); addMsgEl(local);
  const { error } = await sb.from('messages').insert(m);
  if (error) toast(error.message);
}
function onMsg(m) {
  if (S.openChat && S.openChat.id === m.conversation_id && !S.messages.some(x => x.id === m.id)) { S.messages.push(m); if (screenName() === 'chat') addMsgEl(m); }
  refreshChats();
}

// ---------- realtime ----------
function startRealtime() {
  if (S.ch || !S.me) return;
  S.ch = sb.channel('ghost-' + S.me.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onMsg(p.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, p => onCallInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, p => onCallUpdate(p.new))
    .subscribe();
}
function stopRealtime() { if (S.ch) { sb.removeChannel(S.ch); S.ch = null; } }

// ---------- schermate: PIN ----------
function pinPad(len, onDone, locked) {
  let pin = '';
  const dots = h('div', { class: 'dots' }, Array.from({ length: len }, () => h('i')));
  const upd = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const keys = [...'123456789 0<'].map(c => c === ' ' ? h('span', { class: 'key ghost' }) :
    h('button', { class: 'key', onclick: () => {
      if (locked && locked()) return; vib();
      if (c === '<') pin = pin.slice(0, -1);
      else { pin += c; if (pin.length === len) { const p = pin; pin = ''; upd(); onDone(p); return; } }
      upd();
    } }, c === '<' ? '⌫' : c));
  return h('div', {}, dots, h('div', { class: 'keys' }, keys));
}
function scrPinSetup() {
  const len = S.form.pinLen, first = S.form.pinFirst;
  let body;
  if (!len) {
    body = [h('p', {}, t('choose_len')), [4, 6, 8].map(n => h('button', { class: 'btn primary', onclick: () => { S.form.pinLen = n; render(); } }, t('digits', n)))];
  } else {
    body = [h('h3', { style: 'margin:0' }, first ? t('confirm_pin') : t('create_pin')), S.form.pinBad ? h('p', { class: 'err' }, t('pin_mismatch')) : null,
      pinPad(len, async pin => {
        if (!first) { S.form.pinFirst = pin; S.form.pinBad = false; render(); }
        else if (pin === first) { S.form = {}; await setPin(pin); render(); }
        else { S.form.pinFirst = null; S.form.pinBad = true; render(); }
      })];
  }
  return h('div', { class: 'screen scroll' }, h('div', { class: 'center' }, h('div', { class: 'big' }, '👻'), h('h2', { style: 'margin:0' }, t('welcome')), h('div', { class: 'form', style: 'align-items:center' }, body)));
}
function scrLock() {
  let until = LS.get('lockUntil', 0), wrong = false;
  const msg = h('p', { class: 'err', style: 'min-height:24px;margin:0' }, ' ');
  const tick = () => { const left = Math.ceil((until - Date.now()) / 1000); msg.textContent = left > 0 ? t('locked_for', left) : (wrong ? t('wrong_pin') : ' '); };
  S.timer = setInterval(tick, 500); tick();
  const pad = pinPad(pinRec().len, async pin => {
    const r = await tryUnlock(pin);
    if (r === 'ok') return render();
    wrong = true; if (typeof r === 'number') until = r; tick();
  }, () => until > Date.now());
  return h('div', { class: 'screen center' }, h('div', { class: 'big' }, '👻'), h('h3', { style: 'margin:0' }, t('enter_pin')), msg, pad);
}

// ---------- schermate: lista chat ----------
function actionSheet(c) {
  if ($('.modal[data-as]')) return;
  const close = () => m.remove();
  const m = h('div', { class: 'modal', 'data-as': '1', onclick: e => { if (e.target === m) close(); } },
    h('div', { class: 'sheet' }, h('h3', { style: 'margin:0' }, title(c.other)),
      h('button', { class: 'btn', onclick: () => { close(); toggleArchive(c); } }, c.archived ? t('unarchive') : t('archive')),
      h('button', { class: 'btn', onclick: close }, t('close'))));
  document.body.append(m);
}
function newChatDialog() {
  let err = h('p', { class: 'err', style: 'margin:0' });
  const inp = h('input', { type: 'text', placeholder: '@' + t('find_by_tag'), autocapitalize: 'none', autocorrect: 'off',
    oninput: e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_@]/g, ''); } });
  const m = h('div', { class: 'modal', onclick: e => { if (e.target === m) m.remove(); } },
    h('div', { class: 'sheet' }, h('h3', { style: 'margin:0' }, t('new_chat')), inp, err,
      h('button', { class: 'btn primary', onclick: async () => {
        try { await startChat(inp.value); m.remove(); } catch (e) { err.textContent = t(e.message); }
      } }, t('start')),
      h('button', { class: 'btn', onclick: () => m.remove() }, t('close'))));
  document.body.append(m); setTimeout(() => inp.focus(), 50);
}
function scrList(arch) {
  const shown = S.chats.filter(c => !!c.archived === arch);
  const nArch = S.chats.filter(c => c.archived).length;
  const rows = [];
  if (!arch && nArch > 0) rows.push(h('div', { class: 'row', onclick: () => go('archived') }, h('div', { class: 'avatar', style: 'width:48px;height:48px;background:var(--surface)' }, '🗄'), h('div', { class: 't' }, `${t('archived')} (${nArch})`)));
  if (!shown.length) rows.push(h('p', { class: 'muted pad-16' }, arch ? t('no_archived') : t('no_chats')));
  shown.forEach(c => {
    let timer;
    const last = c.last, prev = !last ? '@' + c.other.tag : last.kind === 'voice' ? '🎤 ' + t('voice_note') : (last.body || '');
    const r = h('div', { class: 'row',
      onclick: () => openChat(c),
      oncontextmenu: e => { e.preventDefault(); actionSheet(c); },
      onpointerdown: () => { timer = setTimeout(() => { timer = null; r.dataset.lp = '1'; actionSheet(c); }, 550); },
      onpointerup: () => clearTimeout(timer), onpointerleave: () => clearTimeout(timer), onpointermove: () => clearTimeout(timer) },
      avatar(c.other), h('div', { class: 'col' }, h('div', { class: 't' }, title(c.other)), h('div', { class: 's', style: `font-size:${LS.get('textSize', 17) - 2}px` }, prev)));
    r.addEventListener('click', e => { if (r.dataset.lp) { e.stopImmediatePropagation(); delete r.dataset.lp; } }, true);
    rows.push(r);
  });
  return h('div', { class: 'screen rel' },
    h('div', { class: 'bar' },
      arch ? h('button', { class: 'icon-btn', onclick: () => go('list') }, '‹') : null,
      h('h1', {}, arch ? t('archived') : t('chats')),
      arch ? null : h('button', { class: 'icon-btn', onclick: newChatDialog }, '✎'),
      h('button', { class: 'icon-btn', onclick: () => go('settings') }, '⚙')),
    h('div', { class: 'scroll' }, rows),
    arch ? null : h('button', { class: 'fab', onclick: newChatDialog }, '+'));
}

// ---------- schermata: chat ----------
const timeOf = iso => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
let playing = null;
function msgEl(m) {
  const mine = m.sender_id === S.me.id;
  const el = h('div', { class: 'msg' + (mine ? ' mine' : ''), 'data-id': m.id });
  if (m.kind === 'voice') {
    const sec = Math.round((m.duration_ms || 0) / 1000);
    const btn = h('button', { onclick: () => {
      if (playing && playing.btn === btn) { playing.a.pause(); btn.textContent = '▶'; playing = null; return; }
      if (playing) { playing.a.pause(); playing.btn.textContent = '▶'; }
      const a = new Audio(m.media_url); a.onended = () => { btn.textContent = '▶'; playing = null; };
      a.play().then(() => { btn.textContent = '⏸'; playing = { a, btn }; }).catch(e => toast(e.message));
    } }, '▶');
    el.append(h('div', { class: 'voice' }, btn, `🎤 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`));
  } else {
    el.append(h('span', { style: `font-size:${m.font_size || 16}px` }, m.body || ''));   // la dimensione l'ha scelta chi ha scritto
  }
  el.append(h('span', { class: 'tm' }, timeOf(m.created_at)));
  return el;
}
function addMsgEl(m) { const box = $('#msgs'); if (!box) return; box.append(msgEl(m)); scrollMsgs(); }
function scrollMsgs() { const b = $('#msgs'); if (b) b.scrollTop = b.scrollHeight; }
let rec = null;
async function startRec(btn, stillHolding) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!stillHolding()) { stream.getTracks().forEach(x => x.stop()); return; }
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = []; mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec = { mr, stream, chunks, t0: Date.now(), mime: mr.mimeType || mime || 'audio/mp4' };
    mr.start(); btn.classList.add('on'); vib();
  } catch (e) { toast(e.message); rec = null; }
}
function stopRec(btn, send) {
  const r = rec; if (!r) return; rec = null; btn.classList.remove('on');
  const dur = Date.now() - r.t0;
  r.mr.onstop = async () => {
    r.stream.getTracks().forEach(x => x.stop());
    if (!send || dur < 600) return;
    const ext = r.mime.includes('mp4') ? 'm4a' : 'webm', id = uid(), path = `${S.me.id}/${id}.${ext}`;
    const blob = new Blob(r.chunks, { type: r.mime });
    const { error } = await sb.storage.from('voice').upload(path, blob, { contentType: r.mime });
    if (error) return toast(error.message);
    const url = sb.storage.from('voice').getPublicUrl(path).data.publicUrl;
    sendMsg({ kind: 'voice', media_url: url, duration_ms: dur, font_size: 16 });
  };
  try { r.mr.stop(); } catch { r.stream.getTracks().forEach(x => x.stop()); }
}
function sizeDialog(cur, onChange) {
  const prev = h('p', { style: `font-size:${cur}px;margin:0` }, t('msg_out'));
  const lab = h('div', {}, `${t('text_size_msg')}: ${cur}`);
  const m = h('div', { class: 'modal', onclick: e => { if (e.target === m) m.remove(); } },
    h('div', { class: 'sheet' }, lab, h('input', { type: 'range', min: 12, max: 32, step: 1, value: cur,
      oninput: e => { const v = +e.target.value; prev.style.fontSize = v + 'px'; lab.textContent = `${t('text_size_msg')}: ${v}`; onChange(v); } }), prev,
      h('button', { class: 'btn', onclick: () => m.remove() }, t('close'))));
  document.body.append(m);
}
function scrChat() {
  const c = S.openChat; let size = S.form.msgSize || LS.get('textSize', 17);
  const ta = h('textarea', { rows: 1, placeholder: t('message'), style: `font-size:${size}px`,
    oninput: e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; toggle(); } });
  const send = h('button', { class: 'round send hide', onclick: () => {
    const body = ta.value.trim(); if (!body) return; vib();
    ta.value = ''; ta.style.height = 'auto'; toggle(); sendMsg({ kind: 'text', body, font_size: size });
  } }, '↑');
  const mic = h('button', { class: 'round rec', 'aria-label': t('voice_note') }, '🎤');
  let holding = false;
  mic.addEventListener('pointerdown', e => { e.preventDefault(); holding = true; try { mic.setPointerCapture(e.pointerId); } catch {} startRec(mic, () => holding); });
  mic.addEventListener('pointerup', () => { holding = false; stopRec(mic, true); });
  mic.addEventListener('pointercancel', () => { holding = false; stopRec(mic, false); });
  mic.addEventListener('contextmenu', e => e.preventDefault());
  const toggle = () => { const has = ta.value.trim().length > 0; send.classList.toggle('hide', !has); mic.classList.toggle('hide', has); };
  const msgs = h('div', { class: 'msgs bm-' + ({ split: 'split', allLeft: 'left', allRight: 'right' }[LS.get('bubbles', 'split')]), id: 'msgs' }, S.messages.map(msgEl));
  return h('div', { class: 'screen' },
    h('div', { class: 'bar' },
      h('button', { class: 'icon-btn', onclick: () => { S.openChat = null; S.messages = []; S.form.msgSize = null; go('list'); } }, '‹'),
      avatar(c.other, 36), h('h1', {}, title(c.other)),
      h('button', { class: 'icon-btn', 'aria-label': 'call', onclick: () => startCall(false) }, '📞'),
      h('button', { class: 'icon-btn', 'aria-label': 'video', onclick: () => startCall(true) }, '🎥')),
    msgs,
    h('div', { class: 'composer' },
      h('button', { class: 'round', onclick: () => sizeDialog(size, v => { size = v; S.form.msgSize = v; ta.style.fontSize = v + 'px'; }) }, 'Aa'),
      ta, send, mic));
}

// ---------- chiamate (LiveKit) ----------
async function livekitToken(callId) {
  const { data: { session } } = await sb.auth.getSession();
  let status = 0;
  for (let i = 0; i < 4; i++) {   // se lo stato "accepted" non è ancora arrivato sul server, riprova
    const r = await fetch(BASE + '/functions/v1/livekit-token', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token, apikey: CFG.key.trim() }, body: JSON.stringify({ callId }) });
    if (r.ok) return r.json();
    status = r.status; if (status !== 403) break;
    await new Promise(res => setTimeout(res, 700));
  }
  throw new Error('token ' + status);
}
const setCallStatus = (id, status) => sb.from('calls').update({ status }).eq('id', id);
async function startCall(video) {
  if (S.call || !S.openChat) return;
  const c = S.openChat, id = uid();
  const { error } = await sb.from('calls').insert({ id, conversation_id: c.id, caller_id: S.me.id, callee_id: c.other.id, video, status: 'ringing' });
  if (error) return toast(error.message);
  S.call = { id, video, other: c.other, caller: true, status: 'ringing', room: null, muted: false, cam: video };
  renderOverlay();
  setTimeout(() => { if (S.call && S.call.id === id && S.call.status === 'ringing') { setCallStatus(id, 'missed'); endCallLocal(); } }, 45000);
}
async function onCallInsert(r) {
  if (!S.me || r.callee_id !== S.me.id || r.status !== 'ringing' || S.call) return;
  const { data } = await sb.from('profiles').select('*').eq('id', r.caller_id).maybeSingle();
  if (data) { S.incoming = { row: r, from: data }; renderOverlay(); }
}
function onCallUpdate(r) {
  if (S.call && S.call.id === r.id) {
    if (['ended', 'declined', 'missed'].includes(r.status)) return endCallLocal();
    S.call.status = r.status; renderOverlay(); if (r.status === 'accepted') connectCall();
  }
  if (S.incoming && S.incoming.row.id === r.id && r.status !== 'ringing') { S.incoming = null; renderOverlay(); }
}
async function acceptCall() {
  const inc = S.incoming; S.incoming = null;
  S.call = { id: inc.row.id, video: inc.row.video, other: inc.from, caller: false, status: 'accepted', room: null, muted: false, cam: inc.row.video };
  renderOverlay(); await setCallStatus(inc.row.id, 'accepted'); connectCall();
}
function declineCall() { const inc = S.incoming; S.incoming = null; renderOverlay(); setCallStatus(inc.row.id, 'declined'); }
function hangUp() { if (!S.call) return; setCallStatus(S.call.id, 'ended'); endCallLocal(); }
function endCallLocal() {
  if (S.call && S.call.room) { try { S.call.room.disconnect(); } catch {} }
  S.call = null; renderOverlay();
}
async function connectCall() {
  const call = S.call; if (!call || call.room || call.connecting) return; call.connecting = true;
  try {
    const { token, url } = await livekitToken(call.id);
    const LK = window.LivekitClient;
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    room.on(LK.RoomEvent.TrackSubscribed, track => {
      if (track.kind === 'video') { const v = $('#remoteVideo'); if (v) track.attach(v); }
      else { const a = track.attach(); a.style.display = 'none'; document.body.append(a); }
    });
    room.on(LK.RoomEvent.TrackUnsubscribed, track => track.detach());
    room.on(LK.RoomEvent.AudioPlaybackStatusChanged, () => renderOverlay());
    await room.connect(url, token);
    if (!S.call || S.call.id !== call.id) { room.disconnect(); return; }
    call.room = room;
    await room.startAudio().catch(() => {});
    await room.localParticipant.setMicrophoneEnabled(true);
    if (call.video) {
      await room.localParticipant.setCameraEnabled(true);
      const pub = room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
      if (pub && pub.track) { const v = $('#localVideo'); if (v) pub.track.attach(v); }
    }
    renderOverlay();
  } catch (e) { toast(e.message || String(e)); hangUp(); }
  finally { if (S.call) S.call.connecting = false; }
}
function renderOverlay() {
  const ov = $('#overlay');
  if (S.incoming) {
    const i = S.incoming;
    ov.replaceChildren(h('div', { class: 'call', style: 'background:var(--bg)' }, h('div', { class: 'who' },
      h('p', { class: 'muted' }, i.row.video ? t('incoming_video') : t('incoming_call')), avatar(i.from, 140), h('h1', { style: 'margin:0' }, title(i.from))),
      h('div', { class: 'ctrl' },
        h('button', { class: 'cbtn red', 'aria-label': t('decline'), onclick: declineCall }, '✕'),
        h('button', { class: 'cbtn green', 'aria-label': t('accept'), onclick: acceptCall }, '📞'))));
    return;
  }
  const c = S.call;
  if (!c) { ov.replaceChildren(); return; }
  const existing = $('#remoteVideo');
  if (existing && ov.dataset.call === c.id) {   // non ricostruire il video durante la chiamata: aggiorna solo stato e pulsanti
    $('#cstatus').textContent = c.room ? '●' : (c.status === 'ringing' ? t('ringing') : t('connecting'));
    const ab = $('#audioBtn'); if (ab) ab.style.display = c.room && !c.room.canPlaybackAudio ? '' : 'none';
    return;
  }
  ov.dataset.call = c.id;
  const LK = window.LivekitClient;
  const audioBtn = h('button', { id: 'audioBtn', class: 'audio-btn', style: 'display:none', onclick: () => { c.room && c.room.startAudio(); renderOverlay(); } }, t('enable_audio'));
  ov.replaceChildren(h('div', { class: 'call' },
    h('video', { id: 'remoteVideo', class: 'remote', autoplay: true, playsinline: true }),
    c.video ? h('video', { id: 'localVideo', class: 'local', autoplay: true, playsinline: true, muted: true }) : null,
    h('div', { class: 'who' }, avatar(c.other, 140), h('h1', { style: 'margin:0' }, title(c.other)), h('p', { id: 'cstatus', class: 'muted', style: 'margin:0' }, t('ringing'))),
    audioBtn,
    h('div', { class: 'ctrl' },
      h('button', { class: 'cbtn', onclick: async e => { c.muted = !c.muted; e.target.textContent = c.muted ? '🔇' : '🎙'; try { await c.room.localParticipant.setMicrophoneEnabled(!c.muted); } catch {} } }, '🎙'),
      c.video ? h('button', { class: 'cbtn', onclick: async e => { c.cam = !c.cam; e.target.textContent = c.cam ? '📷' : '🚫'; try { await c.room.localParticipant.setCameraEnabled(c.cam); } catch {} } }, '📷') : null,
      h('button', { class: 'cbtn red', 'aria-label': t('hang_up'), onclick: hangUp }, '📞'))));
  if (!LK) toast('LiveKit non caricato');
}

// ---------- impostazioni ----------
function msgPreview(th, mode, size) {
  const box = h('div', { class: 'preview bm-' + ({ split: 'split', allLeft: 'left', allRight: 'right' }[mode]) },
    h('div', { class: 'msg', style: `font-size:${size}px` }, t('msg_in')), h('div', { class: 'msg mine', style: `font-size:${size}px` }, t('msg_out')));
  themeVars(th, box); box.style.color = th.text; return box;
}
function scrSettings() {
  const th = curTheme(), custom = LS.get('themes', []), size = LS.get('textSize', 17), mode = LS.get('bubbles', 'split');
  const radio = (on, label, fn) => h('div', { class: 'item', onclick: fn }, h('span', { class: 'check', style: 'width:20px' }, on ? '●' : '○'), h('span', { class: 'grow' }, label));
  const prev = h('div'); const redraw = () => prev.replaceChildren(msgPreview(curTheme(), LS.get('bubbles', 'split'), LS.get('textSize', 17)));
  redraw();
  const photo = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const url = await uploadAvatar(S.me.id, f); await sb.from('profiles').update({ avatar_url: url }).eq('id', S.me.id); S.me.avatar_url = url; render(); } catch (er) { toast(er.message); }
  } });
  const share = async () => {
    const text = t('share_text', S.me.tag);
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('✓'); } } catch {}
  };
  const gm = LS.get('glass', 'auto');
  return h('div', { class: 'screen' },
    h('div', { class: 'bar' }, h('button', { class: 'icon-btn', onclick: () => go('list') }, '‹'), h('h1', {}, t('settings'))),
    h('div', { class: 'scroll' },
      h('div', { class: 'sec' }, t('my_profile')),
      h('div', { class: 'item' }, avatar(S.me, 64), h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, title(S.me)), h('div', { class: 'muted' }, '@' + S.me.tag))),
      h('div', { class: 'item' }, h('button', { class: 'check', onclick: () => photo.click() }, t('change_photo')), photo, h('span', { class: 'grow' }), h('button', { class: 'check', onclick: share }, t('share_tag'))),
      h('div', { class: 'sec' }, t('text_size')),
      h('div', { class: 'pad-16' }, h('input', { type: 'range', min: 12, max: 28, step: 1, value: size, oninput: e => { LS.set('textSize', +e.target.value); redraw(); } })),
      h('div', { class: 'sec' }, t('bubbles')),
      radio(mode === 'split', t('bubbles_split'), () => { LS.set('bubbles', 'split'); render(); }),
      radio(mode === 'allLeft', t('bubbles_left'), () => { LS.set('bubbles', 'allLeft'); render(); }),
      radio(mode === 'allRight', t('bubbles_right'), () => { LS.set('bubbles', 'allRight'); render(); }),
      prev,
      h('div', { class: 'sec' }, t('theme')),
      PRESETS.concat(custom).map(x => h('div', { class: 'item', onclick: () => { LS.set('theme', x); render(); } },
        h('span', { class: 'dot', style: `background:${x.primary}` }), h('span', { class: 'grow' }, x.name), th.name === x.name ? h('span', { class: 'check' }, '✓') : null,
        custom.some(c => c.name === x.name) ? h('button', { class: 'muted', onclick: e => { e.stopPropagation(); LS.set('themes', custom.filter(c => c.name !== x.name)); render(); } }, '✕') : null)),
      h('div', { class: 'pad-16' }, h('button', { class: 'btn', onclick: () => { S.themeDraft = Object.assign({}, th, { name: '' }); go('themeEditor'); } }, '🎨 ' + t('new_theme'))),
      h('div', { class: 'sec' }, t('languages')),
      allLangs().map(l => h('div', { class: 'item', onclick: () => { LS.set('lang', l.code); render(); } }, h('span', { class: 'grow' }, l.name), curLang().code === l.code ? h('span', { class: 'check' }, '✓') : null)),
      h('div', { class: 'pad-16' }, h('button', { class: 'btn', onclick: () => { S.langDraft = { name: '', map: {} }; go('langEditor'); } }, '🌍 ' + t('new_language'))),
      h('div', { class: 'sec' }, t('liquid_glass')),
      ['auto', 'on', 'off'].map(v => radio(gm === v, t('glass_' + v), () => { LS.set('glass', v); render(); })),
      h('div', { class: 'pad-16' }, h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, t('sign_out'))), h('div', { style: 'height:30px' })));
}
function scrThemeEditor() {
  const d = S.themeDraft;
  const prev = h('div'); const redraw = () => { const x = Object.assign({}, d); prev.replaceChildren(msgPreview(x, 'split', 17)); };
  redraw();
  const rows = [['c_bg', 'bg'], ['c_surface', 'surface'], ['c_primary', 'primary'], ['c_onprimary', 'onPrimary'], ['c_out', 'out'], ['c_in', 'in'], ['c_text', 'text']];
  const save = h('button', { class: 'icon-btn', disabled: !d.name.trim(), style: 'width:auto;padding:0 8px;font-size:17px', onclick: () => {
    d.name = d.name.trim(); const list = LS.get('themes', []).filter(x => x.name !== d.name).concat([d]); LS.set('themes', list); LS.set('theme', d); go('settings');
  } }, t('save'));
  return h('div', { class: 'screen' },
    h('div', { class: 'bar' }, h('button', { class: 'icon-btn', onclick: () => go('settings') }, '‹'), h('h1', {}, t('new_theme')), save),
    h('div', { class: 'scroll' },
      h('div', { class: 'pad-16' }, h('input', { type: 'text', placeholder: t('name'), value: d.name, oninput: e => { d.name = e.target.value; save.disabled = !d.name.trim(); } })),
      h('div', { class: 'item' }, h('span', { class: 'grow' }, t('dark_mode')), h('input', { type: 'checkbox', checked: d.dark, onchange: e => { d.dark = e.target.checked; redraw(); } })),
      prev,
      h('div', { class: 'colors', style: 'margin-top:12px' }, rows.map(([lab, key]) => [h('span', {}, t(lab)),
        h('input', { type: 'color', value: d[key].slice(0, 7), oninput: e => { d[key] = e.target.value.toUpperCase(); redraw(); } })]))));
}
function scrLangEditor() {
  const d = S.langDraft, en = LANGS.find(l => l.code === 'en').map;
  const save = h('button', { class: 'icon-btn', disabled: !d.name.trim(), style: 'width:auto;padding:0 8px;font-size:17px', onclick: () => {
    const code = 'x_' + d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const map = {}; Object.entries(d.map).forEach(([k, v]) => { if (v.trim()) map[k] = v; });
    const list = LS.get('langs', []).filter(l => l.code !== code).concat([{ code, name: d.name.trim(), map }]); LS.set('langs', list); LS.set('lang', code); go('settings');
  } }, t('save'));
  return h('div', { class: 'screen' },
    h('div', { class: 'bar' }, h('button', { class: 'icon-btn', onclick: () => go('settings') }, '‹'), h('h1', {}, t('new_language')), save),
    h('div', { class: 'scroll' },
      h('p', { class: 'hint pad-16' }, t('lang_hint')),
      h('div', { class: 'pad-16' }, h('input', { type: 'text', placeholder: t('name'), value: d.name, oninput: e => { d.name = e.target.value; save.disabled = !d.name.trim(); } })),
      KEYS.map(k => h('div', { class: 'lang-key' }, h('small', {}, en[k] || k), h('input', { type: 'text', value: d.map[k] || '', oninput: e => { d.map[k] = e.target.value; } }))),
      h('div', { style: 'height:30px' })));
}

// ---------- avvio ----------
async function boot() {
  S.booting = true; S.loadFailed = false; render();
  try {
    const f = await (await fetch('languages.json')).json(); LANGS = f.langs; KEYS = f.keys;
  } catch { LANGS = [{ code: 'en', name: 'English', map: {} }]; }
  if (!configured) { S.booting = false; return render(); }
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (session) await loadProfile();
  S.booting = false; render();
  if (!boot.listening) {
    boot.listening = true;
    sb.auth.onAuthStateChange((ev, sess) => {
      if (ev === 'INITIAL_SESSION') return;
      setTimeout(async () => {
        if (ev === 'SIGNED_OUT') { stopRealtime(); Object.assign(S, { session: null, me: null, profileLoaded: false, chats: [], openChat: null, messages: [], emailSent: null, form: {}, unlocked: false, route: 'list' }); return render(); }
        if (ev === 'SIGNED_IN' && sess && (!S.session || S.session.user.id !== sess.user.id)) { S.session = sess; S.profileLoaded = false; await loadProfile(); render(); }
        else S.session = sess;
      }, 0);
    });
    // si blocca quando l'app esce dallo schermo (tranne durante una chiamata)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (!S.call) S.unlocked = false; return; }
      if (S.me) { stopRealtime(); startRealtime(); refreshChats(); if (S.openChat) openChat(S.openChat); }
      render();
    });
  }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
glassOn(); applyTheme();
boot();
