// db.js
// シンプルなJSONファイルベースのデータストア
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GACHAS_FILE = path.join(DATA_DIR, 'gachas.json');
const SHOPS_FILE = path.join(DATA_DIR, 'shops.json');
const REVENUE_FILE = path.join(DATA_DIR, 'revenue.json');

const MONTHLY_RESET_AMOUNT = 700;

function ensureFile(file, defaultData) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  ensureFile(USERS_FILE, []);
  ensureFile(GACHAS_FILE, []);
  ensureFile(SHOPS_FILE, []);
  ensureFile(REVENUE_FILE, { month: currentMonthStr(), current: MONTHLY_RESET_AMOUNT, history: [] });
}

function readJson(file, fallback) {
  const raw = fs.readFileSync(file, 'utf-8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Users ---
function getUsers() {
  const users = readJson(USERS_FILE, []);
  // 旧データ互換: 新しいフィールドを補完
  let changed = false;
  users.forEach(u => {
    if (!Array.isArray(u.rewardTickets)) { u.rewardTickets = []; changed = true; }
    if (!Array.isArray(u.items)) { u.items = []; changed = true; }
  });
  if (changed) saveUsers(users);
  return users;
}
function saveUsers(users) {
  writeJson(USERS_FILE, users);
}
function getUserById(id) {
  return getUsers().find(u => u.id === id) || null;
}
function getUserByUsername(username) {
  return getUsers().find(u => u.username === username) || null;
}

// --- Gachas ---
function getGachas() {
  return readJson(GACHAS_FILE, []);
}
function saveGachas(gachas) {
  writeJson(GACHAS_FILE, gachas);
}
function getGachaById(id) {
  return getGachas().find(g => g.id === id) || null;
}

// --- Shops ---
function getShops() {
  return readJson(SHOPS_FILE, []);
}
function saveShops(shops) {
  writeJson(SHOPS_FILE, shops);
}
function getShopById(id) {
  return getShops().find(s => s.id === id) || null;
}

// --- Revenue(管理者の収益) ---
// 月が変わっていたら、前月分を履歴に記録して今月分を700にリセットする
function getRevenue() {
  let rev = readJson(REVENUE_FILE, null);
  const nowMonth = currentMonthStr();
  if (!rev) {
    rev = { month: nowMonth, current: MONTHLY_RESET_AMOUNT, history: [] };
    writeJson(REVENUE_FILE, rev);
    return rev;
  }
  if (rev.month !== nowMonth) {
    rev.history = rev.history || [];
    rev.history.unshift({ month: rev.month, total: rev.current });
    rev.month = nowMonth;
    rev.current = MONTHLY_RESET_AMOUNT;
    writeJson(REVENUE_FILE, rev);
  }
  return rev;
}
function addRevenue(amount) {
  const rev = getRevenue(); // 月替わりチェックも兼ねる
  rev.current += amount;
  writeJson(REVENUE_FILE, rev);
  return rev;
}

module.exports = {
  init,
  getUsers, saveUsers, getUserById, getUserByUsername,
  getGachas, saveGachas, getGachaById,
  getShops, saveShops, getShopById,
  getRevenue, addRevenue,
};
