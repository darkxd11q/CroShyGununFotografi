const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'photos.json');
const VISITS_PATH = path.join(DATA_DIR, 'visits.json');
const VOTES_PATH = path.join(DATA_DIR, 'votes.json');
const COMMENTS_PATH = path.join(DATA_DIR, 'comments.json');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json');
const ACTIVITY_PATH = path.join(DATA_DIR, 'activity.json');
const SUGGESTIONS_PATH = path.join(DATA_DIR, 'suggestions.json');
const FEEDBACK_PATH = path.join(DATA_DIR, 'feedback.json');
const PRO_SUBMISSIONS_PATH = path.join(DATA_DIR, 'pro-submissions.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ photos: [] }, null, 2));
  }
  if (!fs.existsSync(VISITS_PATH)) {
    fs.writeFileSync(VISITS_PATH, JSON.stringify({ visits: [] }, null, 2));
  }
  if (!fs.existsSync(VOTES_PATH)) {
    fs.writeFileSync(VOTES_PATH, JSON.stringify({ votes: [] }, null, 2));
  }
  if (!fs.existsSync(COMMENTS_PATH)) {
    fs.writeFileSync(COMMENTS_PATH, JSON.stringify({ comments: [] }, null, 2));
  }
  if (!fs.existsSync(PROFILES_PATH)) {
    fs.writeFileSync(PROFILES_PATH, JSON.stringify({ profiles: [] }, null, 2));
  }
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify({ accounts: [] }, null, 2));
  }
  if (!fs.existsSync(ACTIVITY_PATH)) {
    fs.writeFileSync(ACTIVITY_PATH, JSON.stringify({ activity: [] }, null, 2));
  }
  if (!fs.existsSync(SUGGESTIONS_PATH)) {
    fs.writeFileSync(SUGGESTIONS_PATH, JSON.stringify({ suggestions: [] }, null, 2));
  }
  if (!fs.existsSync(FEEDBACK_PATH)) {
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify({ feedback: [] }, null, 2));
  }
  if (!fs.existsSync(PRO_SUBMISSIONS_PATH)) {
    fs.writeFileSync(PRO_SUBMISSIONS_PATH, JSON.stringify({ submissions: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { photos: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Tarihi YYYY-MM-DD formatında, saat dilimi sorunu yaşamadan döndürür
function toDateOnly(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return toDateOnly(d);
}

function todayStr() {
  return toDateOnly(new Date());
}

function getAllPhotos() {
  return readDb().photos.sort((a, b) => (a.showDate < b.showDate ? -1 : 1));
}

// Yeni fotoğraf eklerken gösterim tarihini hesaplar:
// Hiç fotoğraf yoksa bugün, varsa en son planlanan fotoğrafın bir günü sonrası
function computeNextShowDate() {
  const db = readDb();
  if (db.photos.length === 0) {
    return todayStr();
  }
  const latest = db.photos.reduce((max, p) => (p.showDate > max ? p.showDate : max), db.photos[0].showDate);
  const today = todayStr();
  // Eğer en son planlanan tarih bugünden önceyse (sıra biriktiyse), bugünden devam et
  if (latest < today) {
    return today;
  }
  return addOneDay(latest);
}

function addPhoto({ name, color, description, filename }) {
  const db = readDb();
  const showDate = computeNextShowDate();
  const photo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name,
    color,
    description: description || '',
    filename,
    showDate,
    createdAt: new Date().toISOString(),
  };
  db.photos.push(photo);
  writeDb(db);
  return photo;
}

function deletePhoto(id) {
  const db = readDb();
  const photo = db.photos.find((p) => p.id === id);
  db.photos = db.photos.filter((p) => p.id !== id);
  writeDb(db);
  return photo;
}

function getTodaysPhoto() {
  const db = readDb();
  const today = todayStr();
  return db.photos.find((p) => p.showDate === today) || null;
}

function getUpcomingQueue() {
  const today = todayStr();
  return getAllPhotos().filter((p) => p.showDate >= today);
}

function getPastPhotos() {
  const today = todayStr();
  return getAllPhotos()
    .filter((p) => p.showDate < today)
    .sort((a, b) => (a.showDate < b.showDate ? 1 : -1));
}

function readVisits() {
  ensureDb();
  const raw = fs.readFileSync(VISITS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { visits: [] };
  }
}

function writeVisits(data) {
  fs.writeFileSync(VISITS_PATH, JSON.stringify(data, null, 2));
}

// Bir ziyaretçinin site girişini kaydeder (isim + zaman damgası)
function logVisit(name) {
  const data = readVisits();
  data.visits.push({ name, at: new Date().toISOString() });
  // Kayıt dosyasının aşırı büyümesini önlemek için son 2000 girişi tut
  if (data.visits.length > 2000) {
    data.visits = data.visits.slice(data.visits.length - 2000);
  }
  writeVisits(data);
}

// İsme göre gruplanmış, en son giriş zamanına göre sıralanmış özet liste
// (aynı isimle birden çok giriş varsa yalnızca en sonuncusu ve giriş sayısı gösterilir)
function getVisitorSummary() {
  const { visits } = readVisits();
  const byName = new Map();
  for (const v of visits) {
    const key = v.name.trim().toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, { name: v.name.trim(), lastVisit: v.at, count: 0 });
    }
    const entry = byName.get(key);
    entry.count += 1;
    if (v.at > entry.lastVisit) {
      entry.lastVisit = v.at;
      entry.name = v.name.trim();
    }
  }
  return Array.from(byName.values()).sort((a, b) => (a.lastVisit < b.lastVisit ? 1 : -1));
}

function readVotes() {
  ensureDb();
  const raw = fs.readFileSync(VOTES_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { votes: [] };
  }
}

function writeVotes(data) {
  fs.writeFileSync(VOTES_PATH, JSON.stringify(data, null, 2));
}

// Bir ziyaretçinin oyunu ayarlar. Aynı oya tekrar basılırsa oy geri alınır (toggle).
// Döndürülen değer: 'like' | 'dislike' | null (oy kaldırıldıysa)
function setVote(photoId, name, type) {
  const data = readVotes();
  const key = name.trim().toLowerCase();
  const idx = data.votes.findIndex((v) => v.photoId === photoId && v.name.trim().toLowerCase() === key);
  let result;
  if (idx >= 0) {
    if (data.votes[idx].type === type) {
      data.votes.splice(idx, 1);
      result = null;
    } else {
      data.votes[idx].type = type;
      data.votes[idx].at = new Date().toISOString();
      result = type;
    }
  } else {
    data.votes.push({ photoId, name: name.trim(), type, at: new Date().toISOString() });
    result = type;
  }
  writeVotes(data);
  return result;
}

function getVoteCounts(photoId) {
  const { votes } = readVotes();
  const relevant = votes.filter((v) => v.photoId === photoId);
  return {
    likes: relevant.filter((v) => v.type === 'like').length,
    dislikes: relevant.filter((v) => v.type === 'dislike').length,
  };
}

function getMyVote(photoId, name) {
  const { votes } = readVotes();
  const key = name.trim().toLowerCase();
  const v = votes.find((v) => v.photoId === photoId && v.name.trim().toLowerCase() === key);
  return v ? v.type : null;
}

function readComments() {
  ensureDb();
  const raw = fs.readFileSync(COMMENTS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { comments: [] };
  }
}

function writeComments(data) {
  fs.writeFileSync(COMMENTS_PATH, JSON.stringify(data, null, 2));
}

// Bir kişinin bir fotoğrafa yaptığı yorumu ekler ya da (zaten varsa) günceller
function upsertComment(photoId, name, text) {
  const data = readComments();
  const key = name.trim().toLowerCase();
  const idx = data.comments.findIndex((c) => c.photoId === photoId && c.name.trim().toLowerCase() === key);
  const now = new Date().toISOString();
  let comment;
  if (idx >= 0) {
    data.comments[idx].text = text;
    data.comments[idx].updatedAt = now;
    comment = data.comments[idx];
  } else {
    comment = { photoId, name: name.trim(), text, at: now, updatedAt: now, likedBy: [] };
    data.comments.push(comment);
  }
  writeComments(data);
  return comment;
}

// Bir yoruma beğeni ekler/kaldırır (aynı kişi tekrar basarsa geri alınır)
function toggleCommentLike(photoId, commentAuthorName, likerName) {
  const data = readComments();
  const authorKey = commentAuthorName.trim().toLowerCase();
  const idx = data.comments.findIndex((c) => c.photoId === photoId && c.name.trim().toLowerCase() === authorKey);
  if (idx < 0) return null;
  if (!Array.isArray(data.comments[idx].likedBy)) data.comments[idx].likedBy = [];
  const likerKey = likerName.trim().toLowerCase();
  const likedByLower = data.comments[idx].likedBy.map((n) => n.trim().toLowerCase());
  const existingPos = likedByLower.indexOf(likerKey);
  let liked;
  if (existingPos >= 0) {
    data.comments[idx].likedBy.splice(existingPos, 1);
    liked = false;
  } else {
    data.comments[idx].likedBy.push(likerName.trim());
    liked = true;
  }
  writeComments(data);
  return { liked, count: data.comments[idx].likedBy.length };
}

function getComments(photoId) {
  const { comments } = readComments();
  return comments
    .filter((c) => c.photoId === photoId)
    .map((c) => ({ ...c, likedBy: Array.isArray(c.likedBy) ? c.likedBy : [] }))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

function getMyComment(photoId, name) {
  const key = name.trim().toLowerCase();
  return getComments(photoId).find((c) => c.name.trim().toLowerCase() === key) || null;
}

// Bir fotoğraf için kim ne yaptı: isme göre gruplanmış { vote, comment, lastActivity } listesi
function getPhotoActivity(photoId) {
  const { votes } = readVotes();
  const { comments } = readComments();
  const byName = new Map();

  for (const v of votes.filter((v) => v.photoId === photoId)) {
    const key = v.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, { name: v.name.trim(), vote: null, comment: null, lastActivity: v.at });
    const entry = byName.get(key);
    entry.vote = v.type;
    if (v.at > entry.lastActivity) entry.lastActivity = v.at;
  }
  for (const c of comments.filter((c) => c.photoId === photoId)) {
    const key = c.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, { name: c.name.trim(), vote: null, comment: null, lastActivity: c.updatedAt });
    const entry = byName.get(key);
    entry.comment = c.text;
    if (c.updatedAt > entry.lastActivity) entry.lastActivity = c.updatedAt;
  }
  return byName;
}

function readProfiles() {
  ensureDb();
  const raw = fs.readFileSync(PROFILES_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { profiles: [] };
  }
}

function writeProfiles(data) {
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2));
}

function getProfile(name) {
  const key = name.trim().toLowerCase();
  const { profiles } = readProfiles();
  return profiles.find((p) => p.name.trim().toLowerCase() === key) || null;
}

// Profili oluşturur ya da mevcut alanları koruyarak günceller.
// updates içinde olmayan (undefined) alanlar mevcut değerini korur.
function upsertProfile(name, updates) {
  const data = readProfiles();
  const key = name.trim().toLowerCase();
  const idx = data.profiles.findIndex((p) => p.name.trim().toLowerCase() === key);
  const now = new Date().toISOString();

  const defaults = {
    name: name.trim(),
    hitap: '',
    avatar: null, // null => varsayılan profil fotoğrafı kullanılır
    description: '',
    color: '#e3a23c',
    color2: null, // yalnızca CGF Pro+ için — ikinci renk, ayarlıysa gradyan olarak kullanılır
    discord: '',
    suggestionBanUntil: null,
    badgeCroshy: false,
    badgeDark: false,
    badgeTrusted: false,
    cgfPro: false,
    createdAt: now,
    updatedAt: now,
  };


  if (idx >= 0) {
    const merged = { ...data.profiles[idx] };
    for (const key2 of Object.keys(updates)) {
      if (updates[key2] !== undefined) merged[key2] = updates[key2];
    }
    merged.updatedAt = now;
    data.profiles[idx] = merged;
    writeProfiles(data);
    return merged;
  }

  const created = { ...defaults, ...updates, name: name.trim(), updatedAt: now };
  data.profiles.push(created);
  writeProfiles(data);
  return created;
}

// ===========================================================
// ROZETLER — "croshy" ve "dark" yalnızca bir hesapta olabilir (dışlayıcı),
// "güvenilir kullanıcı" birden fazla hesaba verilebilir.
// ===========================================================

// field: 'badgeCroshy' | 'badgeDark'. value: true/false.
// true verilirse önce bu rozet herkesten kaldırılır, sonra yalnızca bu kullanıcıya verilir.
function setExclusiveBadge(name, field, value) {
  if (value) {
    const data = readProfiles();
    data.profiles.forEach((p) => {
      p[field] = false;
    });
    writeProfiles(data);
  }
  return upsertProfile(name, { [field]: value });
}

function toggleTrustedBadge(name, value) {
  return upsertProfile(name, { badgeTrusted: value });
}

// Rozet yönetim sayfası için: hesabı olan herkesi profilleriyle birlikte listeler
// Bir hesabı askıya alır/kaldırır — askıdaki hesaplarla giriş yapılamaz
function setAccountSuspended(username, value) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return null;
  data.accounts[idx].suspended = value;
  writeAccounts(data);
  return data.accounts[idx];
}

function isAccountSuspended(account) {
  return !!(account && account.suspended);
}

// Bir kullanıcı adını TÜM veri dosyalarında (hesap, profil, oylar, yorumlar, ziyaretler,
// aktivite, öneriler, geri bildirimler, CGF Pro+ başvuruları) tutarlı şekilde değiştirir.
function renameAccountEverywhere(oldUsername, newUsername) {
  const oldKey = oldUsername.trim().toLowerCase();
  const newTrimmed = newUsername.trim();

  const accountsData = readAccounts();
  const accIdx = accountsData.accounts.findIndex((a) => a.username.trim().toLowerCase() === oldKey);
  if (accIdx < 0) return false;
  accountsData.accounts[accIdx].username = newTrimmed;
  writeAccounts(accountsData);

  const profilesData = readProfiles();
  profilesData.profiles.forEach((p) => {
    if (p.name.trim().toLowerCase() === oldKey) p.name = newTrimmed;
  });
  writeProfiles(profilesData);

  const visitsData = readVisits();
  visitsData.visits.forEach((v) => {
    if (v.name.trim().toLowerCase() === oldKey) v.name = newTrimmed;
  });
  writeVisits(visitsData);

  const votesData = readVotes();
  votesData.votes.forEach((v) => {
    if (v.name.trim().toLowerCase() === oldKey) v.name = newTrimmed;
  });
  writeVotes(votesData);

  const commentsData = readComments();
  commentsData.comments.forEach((c) => {
    if (c.name.trim().toLowerCase() === oldKey) c.name = newTrimmed;
    if (Array.isArray(c.likedBy)) {
      c.likedBy = c.likedBy.map((n) => (n.trim().toLowerCase() === oldKey ? newTrimmed : n));
    }
  });
  writeComments(commentsData);

  const activityData = readActivity();
  activityData.activity.forEach((a) => {
    if (a.name.trim().toLowerCase() === oldKey) a.name = newTrimmed;
  });
  writeActivity(activityData);

  const suggestionsData = readSuggestions();
  suggestionsData.suggestions.forEach((s) => {
    if (s.name.trim().toLowerCase() === oldKey) s.name = newTrimmed;
  });
  writeSuggestions(suggestionsData);

  const feedbackData = readFeedback();
  feedbackData.feedback.forEach((f) => {
    if (f.name.trim().toLowerCase() === oldKey) f.name = newTrimmed;
  });
  writeFeedback(feedbackData);

  const proData = readProSubmissions();
  proData.submissions.forEach((s) => {
    if (s.name.trim().toLowerCase() === oldKey) s.name = newTrimmed;
  });
  writeProSubmissions(proData);

  return true;
}

function getAllAccountsWithProfiles() {
  const { accounts } = readAccounts();
  return accounts.map((a) => ({
    username: a.username,
    profile: getProfile(a.username),
  }));
}

// ===========================================================
// HESAPLAR — şifreler yalnızca bcrypt hash'i olarak saklanır,
// düz metin şifre hiçbir zaman diske yazılmaz.
// ===========================================================

function readAccounts() {
  ensureDb();
  const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { accounts: [] };
  }
}

function writeAccounts(data) {
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(data, null, 2));
}

function getAccount(username) {
  const key = username.trim().toLowerCase();
  const { accounts } = readAccounts();
  return accounts.find((a) => a.username.trim().toLowerCase() === key) || null;
}

function isUsernameTaken(username) {
  return getAccount(username) !== null;
}

// Bir IP adresinden şu ana kadar kaç hesap açılmış
function countAccountsByIp(ip) {
  const { accounts } = readAccounts();
  return accounts.filter((a) => a.registrationIp === ip).length;
}

// passwordHash: bcrypt ile önceden hash'lenmiş olmalı — burada asla düz metin şifre tutulmaz
// recoveryCodeHash: kurtarma kodunun bcrypt hash'i — düz metin kurtarma kodu da asla saklanmaz
function createAccount({ username, passwordHash, registrationIp, recoveryCodeHash }) {
  const data = readAccounts();
  const now = new Date().toISOString();
  const account = {
    username: username.trim(),
    passwordHash,
    recoveryCodeHash: recoveryCodeHash || null,
    registrationIp,
    createdAt: now,
    failedAttempts: 0,
    lockedUntil: null,
  };
  data.accounts.push(account);
  writeAccounts(data);
  return account;
}

// Şifreyi değiştirir (yalnızca hash olarak saklanır)
function setPasswordHash(username, passwordHash) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return null;
  data.accounts[idx].passwordHash = passwordHash;
  writeAccounts(data);
  return data.accounts[idx];
}

// Kurtarma kodunu (yeniden) ayarlar — her kurtarma kodu tek kullanımlıktır,
// başarılı bir kurtarmadan sonra mutlaka yenisiyle değiştirilir.
function setRecoveryCodeHash(username, recoveryCodeHash) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return null;
  data.accounts[idx].recoveryCodeHash = recoveryCodeHash;
  writeAccounts(data);
  return data.accounts[idx];
}

// ===========================================================
// E-POSTA (opsiyonel) — hesap oluşturma sırasında kurtarma kodunu
// yedeklemek ve e-posta ile şifre sıfırlama için kullanılır.
// ===========================================================

function isEmailTaken(email) {
  const key = email.trim().toLowerCase();
  const { accounts } = readAccounts();
  return accounts.some((a) => a.email && a.email.trim().toLowerCase() === key);
}

function getAccountByEmail(email) {
  const key = email.trim().toLowerCase();
  const { accounts } = readAccounts();
  return accounts.find((a) => a.email && a.email.trim().toLowerCase() === key) || null;
}

function setEmail(username, email) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return null;
  data.accounts[idx].email = email ? email.trim().toLowerCase() : null;
  writeAccounts(data);
  return data.accounts[idx];
}

// E-posta ile şifre sıfırlama bağlantısı için tek kullanımlık, süreli token.
// Düz metin token asla saklanmaz — yalnızca bcrypt hash'i ve son geçerlilik zamanı tutulur.
function setResetToken(username, tokenHash, expiresAt) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return null;
  data.accounts[idx].resetTokenHash = tokenHash;
  data.accounts[idx].resetTokenExpiresAt = expiresAt;
  writeAccounts(data);
  return data.accounts[idx];
}

function clearResetToken(username) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return null;
  data.accounts[idx].resetTokenHash = null;
  data.accounts[idx].resetTokenExpiresAt = null;
  writeAccounts(data);
  return data.accounts[idx];
}

function isResetTokenValid(account) {
  if (!account || !account.resetTokenHash || !account.resetTokenExpiresAt) return false;
  return new Date(account.resetTokenExpiresAt) > new Date();
}

// Bu kullanıcı adıyla aynı kayıt IP'sini paylaşan başka hesaplar var mı?
// (şüpheli çoklu hesap tespiti için)
function getAccountsSharingIp(username) {
  const { accounts } = readAccounts();
  const acc = accounts.find((a) => a.username.trim().toLowerCase() === username.trim().toLowerCase());
  if (!acc || !acc.registrationIp) return [];
  return accounts
    .filter((a) => a.registrationIp === acc.registrationIp && a.username.trim().toLowerCase() !== username.trim().toLowerCase())
    .map((a) => a.username);
}

// Başarısız giriş denemesini kaydeder; art arda çok fazla denemede hesabı geçici kilitler
function recordFailedLogin(username) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return;
  data.accounts[idx].failedAttempts = (data.accounts[idx].failedAttempts || 0) + 1;
  if (data.accounts[idx].failedAttempts >= 8) {
    // 15 dakika kilitle
    data.accounts[idx].lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  }
  writeAccounts(data);
}

function resetFailedLogin(username) {
  const data = readAccounts();
  const key = username.trim().toLowerCase();
  const idx = data.accounts.findIndex((a) => a.username.trim().toLowerCase() === key);
  if (idx < 0) return;
  data.accounts[idx].failedAttempts = 0;
  data.accounts[idx].lockedUntil = null;
  writeAccounts(data);
}

// Hesap çok fazla başarısız denemeden sonra geçici olarak kilitli mi?
function isAccountLocked(account) {
  if (!account || !account.lockedUntil) return false;
  return new Date(account.lockedUntil) > new Date();
}

// ===========================================================
// AKTİVİTE — her kullanıcının günlük "sitede aktif kalma" süresi
// ===========================================================

function readActivity() {
  ensureDb();
  const raw = fs.readFileSync(ACTIVITY_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { activity: [] };
  }
}

function writeActivity(data) {
  fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(data, null, 2));
}

const HEARTBEAT_SECONDS = 15;

// Her heartbeat çağrısında bugünün süresine sabit bir miktar ekler
// (istemciden gelen süre bilgisine güvenilmez, kötüye kullanımı önler)
// Ayrıca "şu an çevrimiçi mi" göstergesi için son heartbeat zamanını da günceller.
function recordHeartbeat(name) {
  const data = readActivity();
  const key = name.trim().toLowerCase();
  const today = todayStr();
  const now = new Date().toISOString();
  const idx = data.activity.findIndex((a) => a.name.trim().toLowerCase() === key && a.date === today);
  if (idx >= 0) {
    data.activity[idx].seconds += HEARTBEAT_SECONDS;
    data.activity[idx].lastSeen = now;
  } else {
    data.activity.push({ name: name.trim(), date: today, seconds: HEARTBEAT_SECONDS, lastSeen: now });
  }
  writeActivity(data);
}

// En az 60 saniye aktif kalınan gün sayısı ("aktif gün")
function getActiveDaysCount(name) {
  const { activity } = readActivity();
  const key = name.trim().toLowerCase();
  return activity.filter((a) => a.name.trim().toLowerCase() === key && a.seconds >= 60).length;
}

const ONLINE_THRESHOLD_MS = 90 * 1000; // son 90 saniyede heartbeat geldiyse "çevrimiçi" sayılır

function getLastSeen(name) {
  const { activity } = readActivity();
  const key = name.trim().toLowerCase();
  const today = todayStr();
  const rec = activity.find((a) => a.name.trim().toLowerCase() === key && a.date === today);
  return rec ? rec.lastSeen || null : null;
}

function isOnline(name) {
  const last = getLastSeen(name);
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < ONLINE_THRESHOLD_MS;
}

// Belirli bir tarih aralığında (başlangıç dahil, bitiş hariç) en çok aktif olan kullanıcıyı bulur
function getTopActiveUserInRange(startStr, endStrExclusive) {
  const { activity } = readActivity();
  const totals = new Map(); // key(lowercase) -> { name, seconds }
  for (const a of activity) {
    if (a.date >= startStr && a.date < endStrExclusive) {
      const key = a.name.trim().toLowerCase();
      const cur = totals.get(key) || { name: a.name.trim(), seconds: 0 };
      cur.seconds += a.seconds;
      totals.set(key, cur);
    }
  }
  let top = null;
  for (const v of totals.values()) {
    if (!top || v.seconds > top.seconds) top = v;
  }
  return top && top.seconds > 0 ? top.name : null;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Pazar, 1=Pazartesi, ...
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

function getMonthStart(d) {
  const date = new Date(d);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

const BADGES_META_PATH_SUFFIX = 'badges-meta.json';
function readBadgesMeta() {
  ensureDb();
  const p = path.join(DATA_DIR, BADGES_META_PATH_SUFFIX);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify({ weekly: null, monthly: null }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return { weekly: null, monthly: null };
  }
}

function writeBadgesMeta(meta) {
  const p = path.join(DATA_DIR, BADGES_META_PATH_SUFFIX);
  fs.writeFileSync(p, JSON.stringify(meta, null, 2));
}

// Haftanın Aktifi: her Pazartesi başında, BİR ÖNCEKİ haftanın kazananı hesaplanıp o hafta boyunca sabitlenir.
function getWeeklyActiveUser() {
  const now = new Date();
  const thisWeekStart = getMonday(now);
  const periodKey = toDateOnly(thisWeekStart);
  const meta = readBadgesMeta();

  if (meta.weekly && meta.weekly.periodKey === periodKey) {
    return meta.weekly.winner;
  }

  const prevWeekStart = addDays(thisWeekStart, -7);
  const winner = getTopActiveUserInRange(toDateOnly(prevWeekStart), periodKey);
  meta.weekly = { periodKey, winner };
  writeBadgesMeta(meta);
  return winner;
}

// Ayın Aktifi: her ayın 1'inde, BİR ÖNCEKİ ayın kazananı hesaplanıp o ay boyunca sabitlenir.
function getMonthlyActiveUser() {
  const now = new Date();
  const thisMonthStart = getMonthStart(now);
  const periodKey = toDateOnly(thisMonthStart);
  const meta = readBadgesMeta();

  if (meta.monthly && meta.monthly.periodKey === periodKey) {
    return meta.monthly.winner;
  }

  const prevMonthStart = new Date(thisMonthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  const winner = getTopActiveUserInRange(toDateOnly(prevMonthStart), periodKey);
  meta.monthly = { periodKey, winner };
  writeBadgesMeta(meta);
  return winner;
}

// ===========================================================
// FOTOĞRAF ÖNERİLERİ
// ===========================================================

function readSuggestions() {
  ensureDb();
  const raw = fs.readFileSync(SUGGESTIONS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { suggestions: [] };
  }
}

function writeSuggestions(data) {
  fs.writeFileSync(SUGGESTIONS_PATH, JSON.stringify(data, null, 2));
}

function addSuggestion({ name, photoName, color, description, filename, featured }) {
  const data = readSuggestions();
  const suggestion = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    photoName,
    color,
    description: description || '',
    filename,
    featured: !!featured, // CGF Pro+ önerileri öne çıkarılır
    status: 'pending', // pending | approved | rejected
    submittedAt: new Date().toISOString(),
    submittedDate: todayStr(),
  };
  data.suggestions.push(suggestion);
  writeSuggestions(data);
  return suggestion;
}

function getSuggestion(id) {
  const { suggestions } = readSuggestions();
  return suggestions.find((s) => s.id === id) || null;
}

function getPendingSuggestions() {
  const { suggestions } = readSuggestions();
  return suggestions
    .filter((s) => s.status === 'pending')
    .sort((a, b) => {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1; // öne çıkanlar önce
      return a.submittedAt < b.submittedAt ? 1 : -1;
    });
}

function hasSuggestedToday(name) {
  const { suggestions } = readSuggestions();
  const key = name.trim().toLowerCase();
  const today = todayStr();
  return suggestions.some((s) => s.name.trim().toLowerCase() === key && s.submittedDate === today);
}

function setSuggestionStatus(id, status) {
  const data = readSuggestions();
  const idx = data.suggestions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  data.suggestions[idx].status = status;
  data.suggestions[idx].reviewedAt = new Date().toISOString();
  writeSuggestions(data);
  return data.suggestions[idx];
}

// ===========================================================
// ÖNERİ YASAKLARI — profildeki suggestionBanUntil alanı üzerinden
// ===========================================================

// duration: '5gun' | 'kalici'
function banFromSuggesting(name, duration) {
  const until = duration === 'kalici' ? 'permanent' : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  return upsertProfile(name, { suggestionBanUntil: until });
}

function unbanFromSuggesting(name) {
  return upsertProfile(name, { suggestionBanUntil: null });
}

function isSuggestionBanned(profile) {
  if (!profile || !profile.suggestionBanUntil) return false;
  if (profile.suggestionBanUntil === 'permanent') return true;
  return new Date(profile.suggestionBanUntil) > new Date();
}

// ===========================================================
// GERİ BİLDİRİM
// ===========================================================

function readFeedback() {
  ensureDb();
  const raw = fs.readFileSync(FEEDBACK_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { feedback: [] };
  }
}

function writeFeedback(data) {
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
}

function addFeedback(name, text) {
  const data = readFeedback();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    text,
    at: new Date().toISOString(),
  };
  data.feedback.push(entry);
  writeFeedback(data);
  return entry;
}

function getAllFeedback() {
  const { feedback } = readFeedback();
  return feedback.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ===========================================================
// CGF PRO+ BAŞVURULARI
// ===========================================================

function readProSubmissions() {
  ensureDb();
  const raw = fs.readFileSync(PRO_SUBMISSIONS_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { submissions: [] };
  }
}

function writeProSubmissions(data) {
  fs.writeFileSync(PRO_SUBMISSIONS_PATH, JSON.stringify(data, null, 2));
}

function addProSubmission({ name, filename }) {
  const data = readProSubmissions();
  const submission = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    filename,
    status: 'pending', // pending | approved | rejected
    submittedAt: new Date().toISOString(),
  };
  data.submissions.push(submission);
  writeProSubmissions(data);
  return submission;
}

function getPendingProSubmissions() {
  const { submissions } = readProSubmissions();
  return submissions.filter((s) => s.status === 'pending').sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
}

function hasPendingProSubmission(name) {
  const { submissions } = readProSubmissions();
  const key = name.trim().toLowerCase();
  return submissions.some((s) => s.name.trim().toLowerCase() === key && s.status === 'pending');
}

function getProSubmission(id) {
  const { submissions } = readProSubmissions();
  return submissions.find((s) => s.id === id) || null;
}

function setProSubmissionStatus(id, status) {
  const data = readProSubmissions();
  const idx = data.submissions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  data.submissions[idx].status = status;
  data.submissions[idx].reviewedAt = new Date().toISOString();
  writeProSubmissions(data);
  return data.submissions[idx];
}

function setCgfPro(name, value) {
  return upsertProfile(name, { cgfPro: value });
}

function isCgfPro(profile) {
  return !!(profile && profile.cgfPro);
}

module.exports = {
  getAllPhotos,
  addPhoto,
  deletePhoto,
  getTodaysPhoto,
  getUpcomingQueue,
  getPastPhotos,
  todayStr,
  logVisit,
  getVisitorSummary,
  setVote,
  getVoteCounts,
  getMyVote,
  upsertComment,
  toggleCommentLike,
  getComments,
  getMyComment,
  getPhotoActivity,
  getProfile,
  upsertProfile,
  getAccount,
  isUsernameTaken,
  countAccountsByIp,
  createAccount,
  setAccountSuspended,
  isAccountSuspended,
  renameAccountEverywhere,
  setPasswordHash,
  setRecoveryCodeHash,
  isEmailTaken,
  getAccountByEmail,
  setEmail,
  setResetToken,
  clearResetToken,
  isResetTokenValid,
  getAccountsSharingIp,
  recordFailedLogin,
  resetFailedLogin,
  isAccountLocked,
  recordHeartbeat,
  getActiveDaysCount,
  getLastSeen,
  isOnline,
  getWeeklyActiveUser,
  getMonthlyActiveUser,
  addSuggestion,
  getSuggestion,
  getPendingSuggestions,
  hasSuggestedToday,
  setSuggestionStatus,
  banFromSuggesting,
  unbanFromSuggesting,
  isSuggestionBanned,
  setExclusiveBadge,
  toggleTrustedBadge,
  getAllAccountsWithProfiles,
  addFeedback,
  getAllFeedback,
  addProSubmission,
  getPendingProSubmissions,
  hasPendingProSubmission,
  getProSubmission,
  setProSubmissionStatus,
  setCgfPro,
  isCgfPro,
};
