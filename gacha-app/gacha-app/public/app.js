// public/app.js
let currentUser = null;
let isRegisterMode = false;
let gachas = [];
let shops = [];
let currentGacha = null;

const $ = (sel) => document.querySelector(sel);

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

function showMsg(el, text, type = 'error') {
  el.innerHTML = text ? `<div class="msg ${type}">${text}</div>` : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---- 認証画面 ----
$('#authSwitch').addEventListener('click', () => {
  isRegisterMode = !isRegisterMode;
  $('#authTitle').textContent = isRegisterMode ? '新規登録' : 'ログイン';
  $('#authSubmit').textContent = isRegisterMode ? '登録する' : 'ログイン';
  $('#authSwitch').innerHTML = isRegisterMode
    ? 'アカウントをお持ちですか？ <b>ログイン</b>'
    : 'アカウントをお持ちでないですか？ <b>新規登録</b>';
  showMsg($('#authMsg'), '');
});

$('#authSubmit').addEventListener('click', async () => {
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  try {
    const data = await api(isRegisterMode ? '/api/register' : '/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    currentUser = data.user;
    await enterApp();
  } catch (e) {
    showMsg($('#authMsg'), e.message);
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

// ---- タブ切り替え ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $('#tabGachas').classList.toggle('hidden', target !== 'gachas');
    $('#tabShop').classList.toggle('hidden', target !== 'shop');
    $('#tabMyItems').classList.toggle('hidden', target !== 'myitems');
    $('#tabMyTickets').classList.toggle('hidden', target !== 'mytickets');
    $('#tabHistory').classList.toggle('hidden', target !== 'history');
    if (target === 'history') loadHistory();
    if (target === 'shop') loadShops();
    if (target === 'myitems') renderMyItems();
    if (target === 'mytickets') renderMyTickets();
  });
});

// ---- メイン画面 ----
async function enterApp() {
  $('#authScreen').classList.add('hidden');
  $('#mainScreen').classList.remove('hidden');
  $('#meUsername').textContent = currentUser.username;
  $('#mePoints').textContent = currentUser.points;
  $('#adminLink').classList.toggle('hidden', !currentUser.isAdmin);
  await loadGachas();
}

async function loadGachas() {
  const data = await api('/api/gachas');
  gachas = data.gachas;
  const grid = $('#gachaGrid');
  grid.innerHTML = '';
  if (gachas.length === 0) {
    grid.innerHTML = '<div class="card">まだガチャがありません。管理者がガチャを作成するとここに表示されます。</div>';
    return;
  }
  gachas.forEach(g => {
    const ticketCount = currentUser.tickets[g.id] || 0;
    const div = document.createElement('div');
    div.className = 'gacha-card';
    div.innerHTML = `
      <h3>${escapeHtml(g.name)}</h3>
      ${g.type === 'ticket' ? '<div class="ticket-tag" style="color:var(--yellow); border-color:var(--yellow);">🎟 特典チケットが当たる</div>' : ''}
      <div class="gacha-meta">中身: ${g.itemCount}種類</div>
      <div class="gacha-meta">💰 ${g.costPoints} pt / 回</div>
      ${ticketCount > 0 ? `<div class="ticket-tag">🎟 チケット ${ticketCount}枚</div>` : ''}
      <button class="btn btn-primary btn-sm" style="margin-top:8px;">遊ぶ</button>
    `;
    div.querySelector('button').addEventListener('click', () => openPlayScreen(g.id));
    grid.appendChild(div);
  });
}

async function loadHistory() {
  const data = await api('/api/history');
  const list = $('#historyList');
  if (data.history.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim)">まだ結果がありません。</p>';
    return;
  }
  list.innerHTML = data.history.map(h => `
    <div class="history-item">
      <div>
        <div class="name">${escapeHtml(h.item)}</div>
        <div style="color:var(--text-dim)">${escapeHtml(h.gachaName)}${h.usedTicket ? ' (チケット使用)' : ''}</div>
      </div>
      <div class="date">${new Date(h.at).toLocaleString('ja-JP')}</div>
    </div>
  `).join('');
}

// ---- ショップ ----
async function loadShops() {
  const data = await api('/api/shops');
  shops = data.shops;
  const wrap = $('#shopList');
  if (shops.length === 0) {
    wrap.innerHTML = '<div class="card">まだショップがありません。管理者がショップを作成するとここに表示されます。</div>';
    return;
  }
  wrap.innerHTML = '';
  shops.forEach(shop => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3 style="margin-top:0">${escapeHtml(shop.name)}</h3><div class="gacha-grid" id="shopItems-${shop.id}"></div>`;
    wrap.appendChild(card);
    const grid = card.querySelector(`#shopItems-${shop.id}`);
    (shop.items || []).forEach(item => {
      const div = document.createElement('div');
      div.className = 'gacha-card';
      div.innerHTML = `
        <h3>${escapeHtml(item.name)}</h3>
        <div class="ticket-tag" style="${item.destination === 'item' ? 'color:var(--blue); border-color:var(--blue);' : ''}">${item.destination === 'item' ? '📦 アイテム' : '🎟 マイチケット'}</div>
        <div class="gacha-meta">💰 ${item.costPoints} pt</div>
        <button class="btn btn-primary btn-sm" style="margin-top:6px;">購入する</button>`;
      div.querySelector('button').addEventListener('click', () => buyShopItem(shop.id, item.id, div.querySelector('button')));
      grid.appendChild(div);
    });
  });
}

async function buyShopItem(shopId, itemId, btn) {
  btn.disabled = true;
  try {
    const data = await api(`/api/shops/${shopId}/items/${itemId}/buy`, { method: 'POST' });
    currentUser = data.user;
    $('#mePoints').textContent = currentUser.points;
    alert(`購入しました！${data.landedIn === 'item' ? 'アイテム' : 'マイチケット'}に追加されました。`);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---- アイテム ----
function renderMyItems() {
  const list = $('#myItemsList');
  const items = currentUser.items || [];
  if (items.length === 0) { list.innerHTML = '<p style="color:var(--text-dim)">まだアイテムがありません。</p>'; return; }
  list.innerHTML = items.map(it => `
    <div class="history-item">
      <div><div class="name">${escapeHtml(it.name)}</div><div style="color:var(--text-dim)">${escapeHtml(it.source || '')}</div></div>
      <div class="date">${new Date(it.obtainedAt).toLocaleString('ja-JP')}</div>
    </div>`).join('');
}

// ---- マイチケット ----
function renderMyTickets() {
  const list = $('#myTicketsList');
  const tickets = currentUser.rewardTickets || [];
  if (tickets.length === 0) { list.innerHTML = '<p style="color:var(--text-dim)">まだチケットがありません。</p>'; return; }
  list.innerHTML = '';
  tickets.forEach(t => {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.innerHTML = `
      <div>
        <div class="name">${escapeHtml(t.name)} ${t.used ? '<span class="ticket-tag" style="color:var(--text-dim); border-color:var(--line);">使用済み</span>' : '<span class="ticket-tag">未使用</span>'}</div>
        <div style="color:var(--text-dim)">${escapeHtml(t.source || '')} / ${new Date(t.obtainedAt).toLocaleString('ja-JP')}</div>
      </div>`;
    if (!t.used) {
      const useBtn = document.createElement('button');
      useBtn.className = 'btn btn-secondary btn-sm';
      useBtn.textContent = '使用済みにする';
      useBtn.addEventListener('click', () => markTicketUsed(t.id));
      row.appendChild(useBtn);
    }
    list.appendChild(row);
  });
}

async function markTicketUsed(ticketId) {
  try {
    const data = await api(`/api/my-tickets/${ticketId}/use`, { method: 'POST' });
    currentUser = data.user;
    renderMyTickets();
  } catch (e) {
    alert(e.message);
  }
}

// ---- ガチャを回す画面 ----
async function openPlayScreen(gachaId) {
  const data = await api('/api/gachas/' + gachaId);
  currentGacha = data.gacha;
  $('#mainScreen').classList.add('hidden');
  $('#playScreen').classList.remove('hidden');
  $('#playGachaName').textContent = currentGacha.name;
  $('#playGachaMeta').textContent = `消費ポイント: ${currentGacha.costPoints} pt`;
  $('#resultText').textContent = '';
  $('#capsuleArea').innerHTML = '<div class="knob" id="knob">まわす</div>';
  $('#playWithPoints').textContent = `ポイントで引く (${currentGacha.costPoints}pt)`;
  $('#ticketCount').textContent = currentUser.tickets[currentGacha.id] || 0;
  showMsg($('#playMsg'), '');

  const oddsBody = $('#oddsTable');
  oddsBody.innerHTML = currentGacha.items.map(it =>
    `<tr><td>${escapeHtml(it.name)}</td><td>${it.probability.toFixed(2)}%</td></tr>`
  ).join('');
}

$('#backBtn').addEventListener('click', () => {
  $('#playScreen').classList.add('hidden');
  $('#mainScreen').classList.remove('hidden');
  loadGachas();
});

$('#playWithPoints').addEventListener('click', () => doPlay(false));
$('#playWithTicket').addEventListener('click', () => doPlay(true));

async function doPlay(useTicket) {
  showMsg($('#playMsg'), '');
  const btns = [$('#playWithPoints'), $('#playWithTicket')];
  btns.forEach(b => b.disabled = true);
  try {
    const data = await api(`/api/gachas/${currentGacha.id}/play`, {
      method: 'POST',
      body: JSON.stringify({ useTicket }),
    });
    currentUser = data.user;
    $('#mePoints').textContent = currentUser.points;
    $('#ticketCount').textContent = currentUser.tickets[currentGacha.id] || 0;

    $('#capsuleArea').innerHTML = `
      <div class="capsule-result drop">
        <div class="capsule-inner">${escapeHtml(data.result)}</div>
      </div>`;
    $('#resultText').textContent = data.gotRewardTicket
      ? `🎉 「${data.result}」が当たりました！マイチケットに追加されました。`
      : `🎉 「${data.result}」が出ました！`;
  } catch (e) {
    showMsg($('#playMsg'), e.message);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

// ---- 起動時 ----
(async function init() {
  try {
    const data = await api('/api/me');
    currentUser = data.user;
    await enterApp();
  } catch (e) {
    // 未ログイン -> ログイン画面のまま
  }
})();
