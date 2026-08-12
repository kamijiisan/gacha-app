// server.js
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./db');

db.init();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'gacha-app-local-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7日
}));

// ------- 補助関数 -------
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'ログインが必要です' });
  next();
}

function requireAdmin(req, res, next) {
  const user = db.getUserById(req.session.userId);
  if (!user || !user.isAdmin) return res.status(403).json({ error: '管理者権限が必要です' });
  next();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    points: user.points,
    tickets: user.tickets,
    rewardTickets: user.rewardTickets || [],
    items: user.items || [],
    isAdmin: user.isAdmin,
  };
}

// 確率の合計が100.00になっているかチェック(浮動小数の誤差を吸収)
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '中身が空です';
  if (items.length > 100) return '中身は100個までです';
  for (const it of items) {
    if (!it.name || typeof it.name !== 'string' || !it.name.trim()) return '中身の名前が不正です';
    if (typeof it.probability !== 'number' || it.probability < 0.01 || it.probability > 100) {
      return '確率は0.01〜100の範囲で設定してください';
    }
    // 0.01刻みかどうか(誤差許容)
    const scaled = Math.round(it.probability * 100);
    if (Math.abs(scaled - it.probability * 100) > 1e-6) return '確率は0.01刻みで設定してください';
  }
  const total = items.reduce((sum, it) => sum + Math.round(it.probability * 100), 0);
  if (total !== 10000) return `確率の合計は100.00%にしてください(現在: ${(total / 100).toFixed(2)}%)`;
  return null;
}

function validateShopItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '商品が空です';
  if (items.length > 50) return '商品は50個までです';
  for (const it of items) {
    if (!it.name || typeof it.name !== 'string' || !it.name.trim()) return '商品名が不正です';
    if (typeof it.costPoints !== 'number' || isNaN(it.costPoints) || it.costPoints < 0) return '価格は0以上の数値にしてください';
    if (it.destination !== 'item' && it.destination !== 'ticket') return '商品の区分(アイテム/マイチケット)が不正です';
  }
  return null;
}

function rollGacha(items) {
  // 0.01刻み(1/10000)の重み付き抽選
  const r = Math.random() * 10000;
  let acc = 0;
  for (const it of items) {
    acc += Math.round(it.probability * 100);
    if (r < acc) return it;
  }
  return items[items.length - 1];
}

// ------- 認証 -------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 2 || password.length < 4) {
    return res.status(400).json({ error: 'ユーザー名は2文字以上、パスワードは4文字以上にしてください' });
  }
  const users = db.getUsers();
  if (users.some(u => u.username === username)) {
    return res.status(400).json({ error: 'そのユーザー名は既に使われています' });
  }
  const newUser = {
    id: uuidv4(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    isAdmin: users.length === 0, // 最初に登録した人が管理者になる
    points: 100, // 初期ポイント
    tickets: {}, // { gachaId: count } ガチャを無料で引ける権利
    rewardTickets: [], // マイチケット(マッサージ券などの特典)
    items: [], // アイテム(手元に残るコレクション)
    history: [],
  };
  users.push(newUser);
  db.saveUsers(users);
  req.session.userId = newUser.id;
  res.json({ user: publicUser(newUser) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(400).json({ error: 'ユーザー名またはパスワードが違います' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'ログインが必要です' });
  res.json({ user: publicUser(user) });
});

// ------- ガチャ一覧・詳細(ユーザー向け) -------
app.get('/api/gachas', requireLogin, (req, res) => {
  const gachas = db.getGachas();
  res.json({ gachas: gachas.map(g => ({
    id: g.id, name: g.name, type: g.type || 'normal', costPoints: g.costPoints, itemCount: g.items.length,
  })) });
});

app.get('/api/gachas/:id', requireLogin, (req, res) => {
  const gacha = db.getGachaById(req.params.id);
  if (!gacha) return res.status(404).json({ error: 'ガチャが見つかりません' });
  res.json({ gacha });
});

// ------- ガチャを引く -------
app.post('/api/gachas/:id/play', requireLogin, (req, res) => {
  const { useTicket } = req.body || {};
  const users = db.getUsers();
  const user = users.find(u => u.id === req.session.userId);
  const gacha = db.getGachaById(req.params.id);
  if (!gacha) return res.status(404).json({ error: 'ガチャが見つかりません' });

  if (useTicket) {
    const have = user.tickets[gacha.id] || 0;
    if (have <= 0) return res.status(400).json({ error: 'このガチャのチケットを持っていません' });
    user.tickets[gacha.id] = have - 1;
  } else {
    if (user.points < gacha.costPoints) return res.status(400).json({ error: 'ポイントが足りません' });
    user.points -= gacha.costPoints;
  }

  const result = rollGacha(gacha.items);
  user.history.unshift({
    gachaId: gacha.id, gachaName: gacha.name, item: result.name,
    usedTicket: !!useTicket, at: new Date().toISOString(),
  });
  user.history = user.history.slice(0, 200);

  let gotRewardTicket = false;
  if (gacha.type === 'ticket') {
    user.rewardTickets = user.rewardTickets || [];
    user.rewardTickets.unshift({
      id: uuidv4(), name: result.name, source: `ガチャ「${gacha.name}」`,
      obtainedAt: new Date().toISOString(), used: false, usedAt: null,
    });
    gotRewardTicket = true;
  }

  db.saveUsers(users);
  res.json({ result: result.name, gotRewardTicket, user: publicUser(user) });
});

app.get('/api/history', requireLogin, (req, res) => {
  const user = db.getUserById(req.session.userId);
  res.json({ history: user.history });
});

// ------- マイチケットを使用済みにする -------
app.post('/api/my-tickets/:ticketId/use', requireLogin, (req, res) => {
  const users = db.getUsers();
  const user = users.find(u => u.id === req.session.userId);
  const t = user.rewardTickets.find(t => t.id === req.params.ticketId);
  if (!t) return res.status(404).json({ error: 'チケットが見つかりません' });
  t.used = true;
  t.usedAt = new Date().toISOString();
  db.saveUsers(users);
  res.json({ user: publicUser(user) });
});

// ------- ショップ(ユーザー向け) -------
app.get('/api/shops', requireLogin, (req, res) => {
  res.json({ shops: db.getShops() });
});

app.post('/api/shops/:shopId/items/:itemId/buy', requireLogin, (req, res) => {
  const users = db.getUsers();
  const user = users.find(u => u.id === req.session.userId);
  const shop = db.getShopById(req.params.shopId);
  const item = shop && shop.items.find(i => i.id === req.params.itemId);
  if (!shop || !item) return res.status(404).json({ error: '商品が見つかりません' });
  if (user.points < item.costPoints) return res.status(400).json({ error: 'ポイントが足りません' });

  user.points -= item.costPoints;
  let landedIn;
  if (item.destination === 'item') {
    user.items = user.items || [];
    user.items.unshift({ id: uuidv4(), name: item.name, source: `ショップ「${shop.name}」`, obtainedAt: new Date().toISOString() });
    landedIn = 'item';
  } else {
    user.rewardTickets = user.rewardTickets || [];
    user.rewardTickets.unshift({
      id: uuidv4(), name: item.name, source: `ショップ「${shop.name}」`,
      obtainedAt: new Date().toISOString(), used: false, usedAt: null,
    });
    landedIn = 'ticket';
  }
  db.saveUsers(users);

  if (shop.revenueEnabled) {
    db.addRevenue(item.costPoints);
  }

  res.json({ landedIn, user: publicUser(user) });
});

// ------- 管理者: ガチャ管理 -------
app.get('/api/admin/gachas', requireLogin, requireAdmin, (req, res) => {
  res.json({ gachas: db.getGachas() });
});

app.post('/api/admin/gachas', requireLogin, requireAdmin, (req, res) => {
  const { name, type, costPoints, items } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'ガチャ名を入力してください' });
  if (typeof costPoints !== 'number' || costPoints < 0) return res.status(400).json({ error: '消費ポイントが不正です' });
  const err = validateItems(items);
  if (err) return res.status(400).json({ error: err });

  const gachas = db.getGachas();
  const newGacha = {
    id: uuidv4(), name, type: type === 'ticket' ? 'ticket' : 'normal',
    costPoints, items, createdAt: new Date().toISOString(),
  };
  gachas.push(newGacha);
  db.saveGachas(gachas);
  res.json({ gacha: newGacha });
});

app.put('/api/admin/gachas/:id', requireLogin, requireAdmin, (req, res) => {
  const { name, type, costPoints, items } = req.body || {};
  const gachas = db.getGachas();
  const gacha = gachas.find(g => g.id === req.params.id);
  if (!gacha) return res.status(404).json({ error: 'ガチャが見つかりません' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'ガチャ名を入力してください' });
  if (typeof costPoints !== 'number' || costPoints < 0) return res.status(400).json({ error: '消費ポイントが不正です' });
  const err = validateItems(items);
  if (err) return res.status(400).json({ error: err });

  gacha.name = name;
  gacha.type = type === 'ticket' ? 'ticket' : 'normal';
  gacha.costPoints = costPoints;
  gacha.items = items;
  db.saveGachas(gachas);
  res.json({ gacha });
});

app.delete('/api/admin/gachas/:id', requireLogin, requireAdmin, (req, res) => {
  let gachas = db.getGachas();
  gachas = gachas.filter(g => g.id !== req.params.id);
  db.saveGachas(gachas);
  res.json({ ok: true });
});

// ------- 管理者: ショップ管理 -------
app.get('/api/admin/shops', requireLogin, requireAdmin, (req, res) => {
  res.json({ shops: db.getShops() });
});

app.post('/api/admin/shops', requireLogin, requireAdmin, (req, res) => {
  const { name, revenueEnabled, items } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'ショップ名を入力してください' });
  const itemsWithId = (items || []).map(it => ({ ...it, id: it.id || uuidv4() }));
  const err = validateShopItems(itemsWithId);
  if (err) return res.status(400).json({ error: err });

  const shops = db.getShops();
  const newShop = { id: uuidv4(), name, revenueEnabled: !!revenueEnabled, items: itemsWithId, createdAt: new Date().toISOString() };
  shops.push(newShop);
  db.saveShops(shops);
  res.json({ shop: newShop });
});

app.put('/api/admin/shops/:id', requireLogin, requireAdmin, (req, res) => {
  const { name, revenueEnabled, items } = req.body || {};
  const shops = db.getShops();
  const shop = shops.find(s => s.id === req.params.id);
  if (!shop) return res.status(404).json({ error: 'ショップが見つかりません' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'ショップ名を入力してください' });

  // 既存の商品IDは維持し、新規追加分だけ新しいIDを振る
  const oldItems = shop.items || [];
  const itemsWithId = (items || []).map(it => {
    const existing = oldItems.find(o => o.name === it.name);
    return { ...it, id: existing ? existing.id : uuidv4() };
  });
  const err = validateShopItems(itemsWithId);
  if (err) return res.status(400).json({ error: err });

  shop.name = name;
  shop.revenueEnabled = !!revenueEnabled;
  shop.items = itemsWithId;
  db.saveShops(shops);
  res.json({ shop });
});

app.delete('/api/admin/shops/:id', requireLogin, requireAdmin, (req, res) => {
  let shops = db.getShops();
  shops = shops.filter(s => s.id !== req.params.id);
  db.saveShops(shops);
  res.json({ ok: true });
});

// ------- 管理者: ユーザー・ポイント管理 -------
app.get('/api/admin/users', requireLogin, requireAdmin, (req, res) => {
  const users = db.getUsers().map(publicUser);
  res.json({ users });
});

app.post('/api/admin/users/:id/points', requireLogin, requireAdmin, (req, res) => {
  const { amount } = req.body || {};
  if (typeof amount !== 'number') return res.status(400).json({ error: 'ポイント数が不正です' });
  const users = db.getUsers();
  const target = users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  target.points = Math.max(0, target.points + amount);
  db.saveUsers(users);
  res.json({ user: publicUser(target) });
});

// ------- 管理者: チケット送信 -------
// 特定ユーザーにチケットを送る
app.post('/api/admin/tickets/send', requireLogin, requireAdmin, (req, res) => {
  const { userId, gachaId, count } = req.body || {};
  if (!count || count <= 0) return res.status(400).json({ error: '枚数が不正です' });
  const gacha = db.getGachaById(gachaId);
  if (!gacha) return res.status(400).json({ error: 'ガチャが見つかりません' });
  const users = db.getUsers();
  const target = users.find(u => u.id === userId);
  if (!target) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  target.tickets[gachaId] = (target.tickets[gachaId] || 0) + count;
  db.saveUsers(users);
  res.json({ user: publicUser(target) });
});

// 全ユーザーにそれぞれチケットを送る(ガチャの種類・枚数を選択)
app.post('/api/admin/tickets/send-all', requireLogin, requireAdmin, (req, res) => {
  const { gachaId, count } = req.body || {};
  if (!count || count <= 0) return res.status(400).json({ error: '枚数が不正です' });
  const gacha = db.getGachaById(gachaId);
  if (!gacha) return res.status(400).json({ error: 'ガチャが見つかりません' });
  const users = db.getUsers();
  users.forEach(u => {
    u.tickets[gachaId] = (u.tickets[gachaId] || 0) + count;
  });
  db.saveUsers(users);
  res.json({ ok: true, affected: users.length });
});

// ------- 管理者: 収益 -------
app.get('/api/admin/revenue', requireLogin, requireAdmin, (req, res) => {
  res.json({ revenue: db.getRevenue() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ガチャガチャアプリ起動中: http://localhost:${PORT}`);
});
