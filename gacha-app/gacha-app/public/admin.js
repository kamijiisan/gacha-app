// public/admin.js
let me = null;
let allGachas = [];
let allShops = [];
let allUsers = [];

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

// ---- タブ切り替え ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    $('#tabGachas').classList.toggle('hidden', target !== 'gachas');
    $('#tabShops').classList.toggle('hidden', target !== 'shops');
    $('#tabUsers').classList.toggle('hidden', target !== 'users');
    $('#tabTickets').classList.toggle('hidden', target !== 'tickets');
    $('#tabRevenue').classList.toggle('hidden', target !== 'revenue');
    if (target === 'shops') { resetShopForm(); await loadShops(); }
    if (target === 'users') await loadUsers();
    if (target === 'tickets') await loadTicketTab();
    if (target === 'revenue') await loadRevenueTab();
  });
});

// ---- 中身(items)フォーム ----
function addItemRow(name = '', probability = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text" placeholder="アイテム名" class="item-name" value="${escapeHtml(name)}">
    <input type="number" placeholder="確率%" step="0.01" min="0.01" max="100" class="item-prob" value="${probability}">
    <button type="button" class="btn btn-ghost btn-sm" style="padding:6px;">×</button>
  `;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    updateTotalProb();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateTotalProb));
  $('#itemsList').appendChild(row);
  updateTotalProb();
}

function updateTotalProb() {
  const rows = document.querySelectorAll('#itemsList .item-row');
  let total = 0;
  rows.forEach(r => {
    const v = parseFloat(r.querySelector('.item-prob').value);
    if (!isNaN(v)) total += v;
  });
  const el = $('#totalProb');
  el.textContent = total.toFixed(2);
  el.style.color = Math.abs(total - 100) < 0.001 ? 'var(--green)' : 'var(--red)';
}

$('#addItemBtn').addEventListener('click', () => addItemRow());

function resetGachaForm() {
  $('#formTitle').textContent = '新しいガチャを作成';
  $('#editingGachaId').value = '';
  $('#gachaName').value = '';
  $('#gachaType').value = 'normal';
  $('#gachaCost').value = 10;
  $('#itemsList').innerHTML = '';
  addItemRow();
  $('#cancelEditBtn').classList.add('hidden');
  showMsg($('#gachaFormMsg'), '');
}

$('#cancelEditBtn').addEventListener('click', resetGachaForm);

$('#saveGachaBtn').addEventListener('click', async () => {
  const name = $('#gachaName').value.trim();
  const type = $('#gachaType').value === 'ticket' ? 'ticket' : 'normal';
  const costPoints = parseInt($('#gachaCost').value, 10);
  const items = [...document.querySelectorAll('#itemsList .item-row')].map(r => ({
    name: r.querySelector('.item-name').value.trim(),
    probability: parseFloat(r.querySelector('.item-prob').value),
  })).filter(it => it.name);

  const editingId = $('#editingGachaId').value;
  try {
    if (editingId) {
      await api('/api/admin/gachas/' + editingId, {
        method: 'PUT',
        body: JSON.stringify({ name, type, costPoints, items }),
      });
      showMsg($('#gachaFormMsg'), '更新しました', 'success');
    } else {
      await api('/api/admin/gachas', {
        method: 'POST',
        body: JSON.stringify({ name, type, costPoints, items }),
      });
      showMsg($('#gachaFormMsg'), '作成しました', 'success');
    }
    resetGachaForm();
    await loadGachas();
  } catch (e) {
    showMsg($('#gachaFormMsg'), e.message);
  }
});

async function loadGachas() {
  const data = await api('/api/admin/gachas');
  allGachas = data.gachas;
  const list = $('#gachaAdminList');
  if (allGachas.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim)">まだガチャがありません。</p>';
    return;
  }
  list.innerHTML = '';
  allGachas.forEach(g => {
    const div = document.createElement('div');
    div.className = 'gacha-card';
    div.style.marginBottom = '12px';
    div.innerHTML = `
      <h3>${escapeHtml(g.name)}</h3>
      <div class="gacha-meta">${g.type === 'ticket' ? '🎟 特典チケットガチャ' : '通常ガチャ'} / 消費 ${g.costPoints}pt / 中身 ${g.items.length}種類</div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn btn-secondary btn-sm" data-act="edit">編集</button>
        <button class="btn btn-danger btn-sm" data-act="delete">削除</button>
      </div>
    `;
    div.querySelector('[data-act=edit]').addEventListener('click', () => editGacha(g));
    div.querySelector('[data-act=delete]').addEventListener('click', () => deleteGacha(g.id));
    list.appendChild(div);
  });
}

function editGacha(g) {
  $('#formTitle').textContent = `「${g.name}」を編集`;
  $('#editingGachaId').value = g.id;
  $('#gachaName').value = g.name;
  $('#gachaType').value = g.type === 'ticket' ? 'ticket' : 'normal';
  $('#gachaCost').value = g.costPoints;
  $('#itemsList').innerHTML = '';
  g.items.forEach(it => addItemRow(it.name, it.probability));
  $('#cancelEditBtn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteGacha(id) {
  if (!confirm('このガチャを削除しますか？')) return;
  await api('/api/admin/gachas/' + id, { method: 'DELETE' });
  await loadGachas();
}

// ---- ショップ管理 ----
function addShopItemRow(name = '', costPoints = '', destination = 'ticket') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.style.gridTemplateColumns = '1fr 90px 150px 30px';
  row.innerHTML = `
    <input type="text" placeholder="商品名" class="shopitem-name" value="${escapeHtml(name)}">
    <input type="number" placeholder="価格(pt)" min="0" class="shopitem-cost" value="${costPoints}">
    <select class="shopitem-dest">
      <option value="item" ${destination === 'item' ? 'selected' : ''}>アイテムに追加</option>
      <option value="ticket" ${destination === 'ticket' ? 'selected' : ''}>マイチケットに追加</option>
    </select>
    <button type="button" class="btn btn-ghost btn-sm" style="padding:6px;">×</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('#shopItemsList').appendChild(row);
}
$('#addShopItemBtn').addEventListener('click', () => addShopItemRow());

function resetShopForm() {
  $('#shopFormTitle').textContent = '新しいショップを作成';
  $('#editingShopId').value = '';
  $('#shopName').value = '';
  $('#shopRevenueEnabled').checked = false;
  $('#shopItemsList').innerHTML = '';
  addShopItemRow();
  $('#cancelShopEditBtn').classList.add('hidden');
  showMsg($('#shopFormMsg'), '');
}
$('#cancelShopEditBtn').addEventListener('click', resetShopForm);

$('#saveShopBtn').addEventListener('click', async () => {
  const name = $('#shopName').value.trim();
  const revenueEnabled = $('#shopRevenueEnabled').checked;
  const items = [...document.querySelectorAll('#shopItemsList .item-row')].map(r => ({
    name: r.querySelector('.shopitem-name').value.trim(),
    costPoints: parseInt(r.querySelector('.shopitem-cost').value, 10),
    destination: r.querySelector('.shopitem-dest').value === 'item' ? 'item' : 'ticket',
  })).filter(it => it.name);

  const editingId = $('#editingShopId').value;
  try {
    if (editingId) {
      await api('/api/admin/shops/' + editingId, {
        method: 'PUT',
        body: JSON.stringify({ name, revenueEnabled, items }),
      });
      showMsg($('#shopFormMsg'), '更新しました', 'success');
    } else {
      await api('/api/admin/shops', {
        method: 'POST',
        body: JSON.stringify({ name, revenueEnabled, items }),
      });
      showMsg($('#shopFormMsg'), '作成しました', 'success');
    }
    resetShopForm();
    await loadShops();
  } catch (e) {
    showMsg($('#shopFormMsg'), e.message);
  }
});

async function loadShops() {
  const data = await api('/api/admin/shops');
  allShops = data.shops;
  const list = $('#shopAdminList');
  if (allShops.length === 0) {
    list.innerHTML = '<p style="color:var(--text-dim)">まだショップがありません。</p>';
    return;
  }
  list.innerHTML = '';
  allShops.forEach(s => {
    const div = document.createElement('div');
    div.className = 'gacha-card';
    div.style.marginBottom = '10px';
    div.innerHTML = `
      <h3>${escapeHtml(s.name)}</h3>
      <div class="gacha-meta">商品数 ${(s.items || []).length}個</div>
      <div class="ticket-tag" style="${s.revenueEnabled ? '' : 'color:var(--text-dim); border-color:var(--line);'}">${s.revenueEnabled ? '💰 収益 ON' : '収益 OFF'}</div>
      <div style="display:flex; gap:8px; margin-top:6px;">
        <button class="btn btn-secondary btn-sm" data-act="edit">編集</button>
        <button class="btn btn-danger btn-sm" data-act="delete">削除</button>
      </div>`;
    div.querySelector('[data-act=edit]').addEventListener('click', () => editShop(s));
    div.querySelector('[data-act=delete]').addEventListener('click', () => deleteShop(s.id));
    list.appendChild(div);
  });
}

function editShop(s) {
  $('#shopFormTitle').textContent = `「${s.name}」を編集`;
  $('#editingShopId').value = s.id;
  $('#shopName').value = s.name;
  $('#shopRevenueEnabled').checked = !!s.revenueEnabled;
  $('#shopItemsList').innerHTML = '';
  (s.items || []).forEach(it => addShopItemRow(it.name, it.costPoints, it.destination));
  $('#cancelShopEditBtn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteShop(id) {
  if (!confirm('このショップを削除しますか？')) return;
  await api('/api/admin/shops/' + id, { method: 'DELETE' });
  await loadShops();
}

// ---- ユーザー管理タブ ----
async function loadUsers() {
  const data = await api('/api/admin/users');
  allUsers = data.users;
  const tbody = $('#userTable');
  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.points}</td>
      <td>${u.isAdmin ? '管理者' : '一般'}</td>
      <td>
        <input type="number" value="10" style="width:70px" class="pt-input" data-id="${u.id}">
        <button class="btn btn-secondary btn-sm" data-give="${u.id}">付与</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-give]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.give;
      const input = tbody.querySelector(`.pt-input[data-id="${id}"]`);
      const amount = parseInt(input.value, 10);
      if (isNaN(amount)) return;
      await api(`/api/admin/users/${id}/points`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      await loadUsers();
    });
  });
}

// ---- チケット配布タブ ----
async function loadTicketTab() {
  if (allGachas.length === 0) await loadGachas();
  if (allUsers.length === 0) await loadUsers();

  const gachaOptions = allGachas.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  $('#sendAllGacha').innerHTML = gachaOptions || '<option disabled>ガチャがありません</option>';
  $('#sendOneGacha').innerHTML = gachaOptions || '<option disabled>ガチャがありません</option>';
  $('#sendOneUser').innerHTML = allUsers.map(u => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('');
}

$('#sendAllBtn').addEventListener('click', async () => {
  const gachaId = $('#sendAllGacha').value;
  const count = parseInt($('#sendAllCount').value, 10);
  try {
    const data = await api('/api/admin/tickets/send-all', {
      method: 'POST',
      body: JSON.stringify({ gachaId, count }),
    });
    showMsg($('#sendAllMsg'), `${data.affected}人に配布しました`, 'success');
  } catch (e) {
    showMsg($('#sendAllMsg'), e.message);
  }
});

$('#sendOneBtn').addEventListener('click', async () => {
  const userId = $('#sendOneUser').value;
  const gachaId = $('#sendOneGacha').value;
  const count = parseInt($('#sendOneCount').value, 10);
  try {
    await api('/api/admin/tickets/send', {
      method: 'POST',
      body: JSON.stringify({ userId, gachaId, count }),
    });
    showMsg($('#sendOneMsg'), '送りました', 'success');
  } catch (e) {
    showMsg($('#sendOneMsg'), e.message);
  }
});

// ---- 収益タブ ----
async function loadRevenueTab() {
  const data = await api('/api/admin/revenue');
  const rev = data.revenue;
  $('#revenueMonthLabel').textContent = `${rev.month} の収益`;
  $('#revenueCurrent').textContent = rev.current;
  const tbody = $('#revenueHistoryTable');
  const history = rev.history || [];
  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-dim)">まだ履歴がありません。</td></tr>';
  } else {
    tbody.innerHTML = history.map(h => `<tr><td>${escapeHtml(h.month)}</td><td>${h.total} pt</td></tr>`).join('');
  }
}

// ---- 起動時: 管理者チェック ----
(async function init() {
  try {
    const data = await api('/api/me');
    me = data.user;
    if (!me.isAdmin) {
      $('#guardMsg').textContent = 'このページは管理者のみアクセスできます。';
      return;
    }
    $('#guardScreen').classList.add('hidden');
    $('#adminWrap').classList.remove('hidden');
    resetGachaForm();
    await loadGachas();
  } catch (e) {
    $('#guardMsg').innerHTML = 'ログインが必要です。<a href="/index.html">ログイン画面へ</a>';
  }
})();
