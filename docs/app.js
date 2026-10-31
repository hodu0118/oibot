const $ = s => document.querySelector(s);
const CFG = window.OIBOT_CONFIG;
const S = { me: null };
const TOKEN_KEY = 'oibot_token';
let rid = 0;

const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
function getToken() {
  try { const o = JSON.parse(localStorage.getItem(TOKEN_KEY)); if (o && o.exp > Date.now()) return o.t; } catch (e) {}
  localStorage.removeItem(TOKEN_KEY);
  return null;
}
function login() {
  const state = crypto.randomUUID();
  sessionStorage.setItem('oibot_state', state);
  location.href = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    client_id: CFG.clientId, response_type: 'token', scope: 'identify guilds', redirect_uri: siteUrl(), state, prompt: 'none',
  });
}
// 로그인 직후 돌아왔으면 true
function captureToken() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (!q.get('access_token')) return false;
  let ok = false;
  if (q.get('state') && q.get('state') === sessionStorage.getItem('oibot_state')) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: q.get('access_token'), exp: Date.now() + Number(q.get('expires_in') || 0) * 1000 }));
    ok = true;
  }
  sessionStorage.removeItem('oibot_state');
  history.replaceState(null, '', location.pathname + '#/dashboard');
  return ok;
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const fmt = n => (n == null ? '-' : Number(n).toLocaleString(locale()));
const date = x => new Date(x).toLocaleDateString(locale());
const mount = (...n) => $('#view').replaceChildren(...n);
const icon = (src, name) => src
  ? h('img', { class: 'icon', src, alt: '', width: 40, height: 40, loading: 'lazy' })
  : h('span', { class: 'icon fb' }, [...String(name || '?')][0]);
const errorBox = msg => h('div', { class: 'notice error' }, msg);
const loading = () => h('p', { class: 'muted' }, t('불러오는 중…'));
const invite = gid => `https://discord.com/oauth2/authorize?client_id=${CFG.clientId}&scope=bot%20applications.commands&permissions=${CFG.invitePermissions || '1099511630854'}`
  + (gid ? `&guild_id=${gid}&disable_guild_select=true` : '');

function toast(msg, type) {
  const el = h('div', { class: 'toast ' + (type || '') }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(path, opts = {}) {
  const token = getToken();
  let r;
  try {
    r = await fetch(CFG.apiUrl.replace(/\/$/, '') + '/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) { throw new Error(t('오이봇 서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.')); }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) localStorage.removeItem(TOKEN_KEY);
  if (!r.ok) throw Object.assign(new Error(t(data.error || '요청에 실패했어요.')), { status: r.status });
  return data;
}

function ask({ title, body, fields = [], confirm = t('확인'), danger }) {
  return new Promise(resolve => {
    const inputs = {};
    const dlg = h('dialog', { class: 'modal' });
    const form = h('form', { method: 'dialog' }, h('h3', null, title), body && h('p', { class: 'muted' }, body));
    for (const f of fields) {
      const el = f.type === 'select'
        ? h('select', { id: 'f-' + f.name }, f.options.map(([v, l]) => h('option', { value: v }, t(l))))
        : h('input', { id: 'f-' + f.name, maxlength: 200, placeholder: t(f.placeholder || '') });
      inputs[f.name] = el;
      form.append(h('label', { for: 'f-' + f.name }, t(f.label)), el);
    }
    form.append(h('div', { class: 'foot' },
      h('button', { class: 'btn', value: 'cancel', formnovalidate: true }, t('취소')),
      h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), value: 'ok' }, confirm)));
    dlg.append(form);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const vals = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      dlg.remove();
      resolve(ok ? vals : null);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

async function refreshMe() {
  try { S.me = getToken() ? await api('/me') : null; } catch (e) { S.me = null; }
  renderNav();
}
function renderNav() {
  const u = S.me && S.me.user;
  const langSel = h('select', {
    class: 'lang', 'aria-label': t('언어'),
    onchange: e => { setLang(e.target.value); renderNav(); route(); },
  }, LANGS.map(([c, l]) => h('option', { value: c, selected: c === LANG }, l)));
  $('#nav').replaceChildren(
    h('a', { href: '#/' }, t('홈')),
    h('a', { href: '#/dashboard' }, t('서버 관리')),
    langSel,
    u
      ? h('span', { class: 'me' }, icon(u.avatar, u.name), u.name,
        h('button', { class: 'btn small', onclick: () => { localStorage.removeItem(TOKEN_KEY); location.hash = '#/'; location.reload(); } }, t('로그아웃')))
      : h('button', { class: 'btn primary small', onclick: login }, t('디스코드로 로그인')));
}

// 로그인 보상: 이미 받은 서버는 건너뛰고, 새로 지급된 서버 수만 알려줘요
async function claimReward() {
  try {
    const r = await api('/reward', { method: 'POST', body: {} });
    if (r.granted > 0) toast(t('{n}개 서버에 {amount}포인트가 지급돼요!', { n: r.granted, amount: fmt(r.amount) }));
  } catch (e) { /* 보상 실패는 조용히 넘어가요 */ }
}

// ---------- 홈 ----------
async function homeView() {
  const id = ++rid;
  mount(loading());
  let st;
  try { st = await api('/stats'); } catch (e) { if (id === rid) mount(errorBox(e.message)); return; }
  if (id !== rid) return;
  const max = st.guilds && st.guilds[0] ? st.guilds[0].members || 1 : 1;
  mount(
    h('section', { class: 'hero' },
      h('h1', null, t('오이봇이 함께하는 서버')),
      h('p', null, tn('지금 {servers}개 서버, 멤버 합계 {members}명이 함께해요.', {
        servers: h('span', { class: 'num' }, fmt(st.guildCount)),
        members: h('span', { class: 'num' }, fmt(st.memberCount)),
      })),
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: invite(), target: '_blank', rel: 'noopener' }, t('오이봇 초대하기')),
        S.me && S.me.user
          ? h('a', { class: 'btn', href: '#/dashboard' }, t('내 서버 관리하기'))
          : h('button', { class: 'btn', onclick: login }, t('디스코드로 로그인')))),
    h('h2', null, t('서버 목록')),
    st.guilds
      ? h('ol', { class: 'rank' }, st.guilds.map(g => {
        const fill = h('i');
        fill.style.width = Math.max(2, (g.members / max) * 100) + '%';
        return h('li', null, icon(g.icon, g.name), h('span', { class: 'name' }, g.name),
          h('span', { class: 'bar' }, fill), h('span', { class: 'count' }, t('{n}명', { n: fmt(g.members) })));
      }))
      : h('p', { class: 'muted' }, t('서버 목록은 공개하지 않아요.')));
}

// ---------- 서버 선택 ----------
async function dashboardView() {
  const id = ++rid;
  mount(loading());
  await refreshMe();
  if (id !== rid) return;
  if (!S.me || !S.me.user) {
    return mount(h('section', { class: 'hero' },
      h('h1', null, t('서버 관리')),
      h('p', null, t('디스코드로 로그인하면, 관리자 권한이 있는 서버를 오이봇으로 관리할 수 있어요.')),
      h('button', { class: 'btn primary', onclick: login }, t('디스코드로 로그인'))));
  }
  const { guilds, invitable } = S.me;
  mount(
    h('h1', null, t('관리할 서버를 골라주세요')),
    h('h2', null, t('오이봇이 있는 서버')),
    guilds.length
      ? h('div', { class: 'rows' }, guilds.map(g => h('a', { class: 'row', href: '#/dashboard/' + g.id },
        icon(g.icon, g.name), h('span', { class: 'grow' }, g.name), h('span', { class: 'muted' }, t('{n}명', { n: fmt(g.members) })))))
      : h('p', { class: 'muted' }, t('관리자 권한이 있고 오이봇이 들어 있는 서버가 없어요. 아래에서 오이봇을 초대해보세요.')),
    invitable.length && h('h2', null, t('오이봇이 아직 없는 서버')),
    invitable.length && h('div', { class: 'rows' }, invitable.map(g => h('div', { class: 'row' },
      icon(g.icon, g.name), h('span', { class: 'grow' }, g.name),
      h('a', { class: 'btn small', href: invite(g.id), target: '_blank', rel: 'noopener' }, t('오이봇 초대')))))
  );
}

// ---------- 서버 관리 ----------
async function guildView(gid) {
  const id = ++rid;
  mount(loading());
  if (!S.me) await refreshMe();
  let g;
  try { g = await api('/guilds/' + gid); } catch (e) {
    if (id !== rid) return;
    return mount(errorBox(e.message), h('p', null, h('a', { href: '#/dashboard' }, t('서버 목록으로 돌아가기'))));
  }
  if (id !== rid) return;
  const panel = h('div');
  const tabs = [['overview', '개요'], ['members', '멤버'], ['announce', '공지 보내기']];
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const show = name => {
    for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    panel.replaceChildren(name === 'overview' ? overview(g) : name === 'members' ? membersPanel(g) : announcePanel(g));
  };
  for (const [k, l] of tabs) bar.append(h('button', { role: 'tab', 'data-tab': k, onclick: () => show(k) }, t(l)));
  mount(
    h('p', null, h('a', { href: '#/dashboard' }, t('← 서버 목록'))),
    h('div', { class: 'head' }, icon(g.icon, g.name), h('h1', null, g.name)),
    bar, panel);
  show('overview');
}

function overview(g) {
  const rows = [
    ['멤버', t('{n}명', { n: fmt(g.members) })],
    ['텍스트 채널', t('{n}개', { n: g.textChannels.length })], ['음성 채널', t('{n}개', { n: g.voiceChannels })],
    ['역할', t('{n}개', { n: g.roles })], ['부스트', t('레벨 {tier} ({n}개)', { tier: g.boostTier, n: g.boosts })],
    ['서버 생성일', date(g.createdAt)], ['내 권한', g.isOwner ? t('서버 주인') : t('관리 권한')],
  ];
  return h('dl', { class: 'facts' }, rows.flatMap(([k, v]) => [h('dt', null, t(k)), h('dd', null, v)]));
}

function membersPanel(g) {
  let cursor = null, query = '';
  const list = h('div', { class: 'rows' });
  const more = h('button', { class: 'btn', onclick: () => load() }, t('더 보기'));
  more.hidden = true;
  const input = h('input', { type: 'search', placeholder: t('이름으로 검색'), 'aria-label': t('멤버 검색') });
  const form = h('form', { class: 'line', onsubmit: e => { e.preventDefault(); query = input.value.trim(); reload(); } },
    input, h('button', { class: 'btn', type: 'submit' }, t('검색')));
  const msgBox = h('p', { class: 'muted' });

  async function run(label, fn) {
    try { await fn(); toast(t('{label} 완료', { label: t(label) })); reload(); } catch (e) { toast(e.message, 'error'); }
  }
  const post = (m, action, body) => api(`/guilds/${g.id}/members/${m.id}/${action}`, { method: 'POST', body });

  async function kick(m) {
    const v = await ask({
      title: t('{name} 추방', { name: m.name }), body: t('서버에서 내보내요. 초대 링크로 다시 들어올 수 있어요.'),
      confirm: t('추방하기'), danger: true, fields: [{ name: 'reason', label: '사유', placeholder: '선택 사항' }],
    });
    if (v) run('추방', () => post(m, 'kick', v));
  }
  async function ban(m) {
    const v = await ask({
      title: t('{name} 차단', { name: m.name }), body: t('차단하면 다시 들어올 수 없어요.'), confirm: t('차단하기'), danger: true,
      fields: [{ name: 'reason', label: '사유', placeholder: '선택 사항' },
        { name: 'deleteDays', label: '최근 메시지 삭제', type: 'select', options: [['0', '삭제 안 함'], ['1', '1일'], ['7', '7일']] }],
    });
    if (v) run('차단', () => post(m, 'ban', v));
  }
  async function timeout(m) {
    const v = await ask({
      title: t('{name} 타임아웃', { name: m.name }), confirm: t('적용하기'),
      fields: [{ name: 'minutes', label: '기간', type: 'select', options: [['10', '10분'], ['60', '1시간'], ['1440', '1일'], ['10080', '7일'], ['0', '타임아웃 해제']] },
        { name: 'reason', label: '사유', placeholder: '선택 사항' }],
    });
    if (v) run('타임아웃', () => post(m, 'timeout', { minutes: Number(v.minutes), reason: v.reason }));
  }

  function row(m) {
    const timed = m.timeoutUntil && new Date(m.timeoutUntil) > Date.now();
    return h('div', { class: 'row' },
      h('img', { class: 'icon', src: m.avatar, alt: '', width: 40, height: 40, loading: 'lazy' }),
      h('div', { class: 'grow' },
        h('div', null, m.nick || m.name, m.bot && h('span', { class: 'badge' }, t('봇')), timed && h('span', { class: 'badge warn' }, t('타임아웃'))),
        h('div', { class: 'sub' }, t('@{user} · 가입 {date}', { user: m.username, date: date(m.joinedAt) }))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: () => timeout(m) }, t('타임아웃')),
        h('button', { class: 'btn small danger', onclick: () => kick(m) }, t('추방')),
        h('button', { class: 'btn small danger', onclick: () => ban(m) }, t('차단'))));
  }

  async function load() {
    more.disabled = true;
    try {
      const qs = query ? 'query=' + encodeURIComponent(query) : cursor ? 'after=' + cursor : '';
      const d = await api(`/guilds/${g.id}/members?${qs}`);
      list.append(...d.members.map(row));
      cursor = d.next;
      more.hidden = !d.next;
      msgBox.textContent = list.children.length ? '' : t('멤버를 찾지 못했어요.');
    } catch (e) { msgBox.textContent = e.message; msgBox.className = 'notice error'; }
    more.disabled = false;
  }
  function reload() { list.replaceChildren(); cursor = null; msgBox.className = 'muted'; load(); }
  load();
  return h('div', null, form, list, msgBox, h('p', null, more));
}

function announcePanel(g) {
  const sel = h('select', { id: 'ch' }, g.textChannels.map(c => h('option', { value: c.id }, '#' + c.name)));
  const txt = h('textarea', { id: 'msg', maxlength: 2000, placeholder: t('오이봇이 보낼 메시지') });
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    btn.disabled = true;
    try {
      await api(`/guilds/${g.id}/messages`, { method: 'POST', body: { channelId: sel.value, content: txt.value } });
      txt.value = ''; toast(t('공지를 보냈어요.'));
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  } }, t('보내기'));
  if (!g.textChannels.length) return h('p', { class: 'muted' }, t('오이봇이 볼 수 있는 텍스트 채널이 없어요.'));
  return h('div', null,
    h('label', { for: 'ch' }, t('채널')), sel,
    h('label', { for: 'msg' }, t('내용')), txt,
    h('p', { class: 'muted' }, t('멘션(@everyone 등)은 알림 없이 글자로만 표시돼요.')), btn);
}

// ---------- 라우터 ----------
function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'dashboard') return p[1] ? guildView(p[1]) : dashboardView();
  homeView();
}
window.addEventListener('hashchange', route);
(async () => {
  const fresh = captureToken();
  await refreshMe();
  route();
  if (fresh) claimReward();
})();
