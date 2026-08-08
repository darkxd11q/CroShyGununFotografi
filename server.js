require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('./db');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// Fotoğraf yönetimi için tam yetkili admin girişi
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'croshy';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'croshyevrenseldir9467';

// Yalnızca ziyaretçi kaydını görüntüleyen ikinci giriş türü
const VIEWER_USERNAME = process.env.VIEWER_USERNAME || 'admin';
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || 'cokgizlisifre159753';

const SESSION_SECRET = process.env.SESSION_SECRET || 'gelistirme-icin-gizli-anahtar';

// ---- E-posta (opsiyonel, ücretsiz) ----
// SMTP_HOST/SMTP_USER/SMTP_PASS ortam değişkenleri girilmezse e-posta özellikleri
// sessizce devre dışı kalır; site bu değişkenler olmadan da tamamen çalışır
// (hesap kurtarma kodu sistemi zaten e-postasız çalışıyor).
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
const MAIL_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@example.com';

async function sendMail(to, subject, html) {
  if (!mailer) {
    if (!isProd) console.log(`[e-posta yapılandırılmamış] "${subject}" -> ${to}\n${html}\n`);
    return false;
  }
  try {
    await mailer.sendMail({ from: `"CroShy Günün Fotoğrafı" <${MAIL_FROM}>`, to, subject, html });
    return true;
  } catch (e) {
    console.error('E-posta gönderme hatası:', e.message);
    return false;
  }
}

// Render'da kalıcı disk kullanılıyorsa UPLOAD_DIR ortam değişkeniyle
// diskin bağlandığı klasör (örn. /var/data/uploads) belirtilebilir.
// Belirtilmezse proje içindeki public/uploads klasörü kullanılır.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Oturumlar da diğer veriler gibi DATA_DIR altında kalıcı olarak saklanır.
// Varsayılan (bellek içi) oturum deposu sunucu her yeniden başladığında
// tüm girişleri siler; "30 yıl hatırla" vaadinin gerçekten tutması için
// oturumların diske yazılması gerekir.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// 30 yıl (milisaniye ve saniye cinsinden)
const THIRTY_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 30;
const THIRTY_YEARS_S = 60 * 60 * 24 * 365 * 30;

// Render (ve diğer platformlar) bir ters proxy arkasında HTTPS sonlandırır;
// bu ayar olmadan express-session "secure" çerezleri doğru şekilde ayarlayamaz.
app.set('trust proxy', 1);

// ---- Ayarlar ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Güvenlik başlıkları (en başta uygulanmalı, tüm yanıtları kapsasın) ----
// CSP, sayfalarımızın kullandığı Google Fonts ve satır içi <script>/<style>
// bloklarına izin verecek şekilde özelleştirildi; aksi halde site çalışmaz.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Fotoğraflar UPLOAD_DIR neresi olursa olsun /uploads altından servis edilir
// (public/uploads dışında, örn. kalıcı bir Render diskinde olsa bile çalışır).
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(
  session({
    store: new FileStore({
      path: SESSIONS_DIR,
      ttl: THIRTY_YEARS_S,
      retries: 0,
      logFn: () => {}, // gereksiz konsol çıktısını sustur
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: THIRTY_YEARS_MS, // "hesabı 30 yıl hatırla"
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
    },
  })
);

// ---- Kaba kuvvet / spam koruması (hız sınırlama) ----
// Giriş, kayıt ve hesap kurtarma gibi kimlik doğrulama uçları için sıkı sınır
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.' },
});

// Oy/yorum/heartbeat gibi sık çağrılan ama düşük riskli uçlar için daha gevşek sınır
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek gönderildi. Lütfen biraz yavaşlayın.' },
});

// Dosya yükleme içeren uçlar için orta sıkılıkta sınır
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla yükleme denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.' },
});

// ---- Multer (fotoğraf yükleme) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  },
});
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Sadece jpg, jpeg, png, webp veya gif dosyaları yüklenebilir.'));
    }
    cb(null, true);
  },
});

// ---- Multer (profil fotoğrafı yükleme) ----
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Sadece jpg, jpeg, png, webp veya gif dosyaları yüklenebilir.'));
    }
    cb(null, true);
  },
});

// Kimse özel bir profil fotoğrafı seçmediyse herkes bu görseli kullanır
const DEFAULT_AVATAR = '/img/default-avatar.png';
function avatarUrl(profile) {
  if (profile && profile.avatar) return `/uploads/avatars/${profile.avatar}`;
  return DEFAULT_AVATAR;
}
app.locals.avatarUrl = avatarUrl;

// ---- Rozetler ----
// "croshy" ve "dark" yalnızca bir hesaba verilebilir (dışlayıcı), "trusted" birden fazlasına verilebilir,
// "weekly"/"monthly" hafta/ay başında hesaplanıp o dönem boyunca sabitlenir, "pro" CGF Pro+ onayıyla kazanılır.
const BADGE_META = {
  croshy: { label: 'CroShy', colorA: '#e11d2e', colorB: '#ffffff' },
  dark: { label: 'Dark', colorA: '#f4c430', colorB: '#0b1f4d' },
  trusted: { label: 'Güvenilir Kullanıcı', colorA: '#22c55e', colorB: '#ffffff' },
  weekly: { label: 'Haftanın Aktifi', colorA: '#e3a23c', colorB: '#1b191e' },
  monthly: { label: 'Ayın Aktifi', colorA: '#a855f7', colorB: '#ffffff' },
  pro: { label: 'CGF Pro+', colorA: '#0ea5e9', colorB: '#ffffff' },
};
app.locals.BADGE_META = BADGE_META;

// profile + o anki haftalık/aylık kazananlara göre uygulanabilir rozetlerin listesini döndürür
function getBadges(profile, weeklyUser, monthlyUser) {
  if (!profile) return [];
  const badges = [];
  if (profile.badgeCroshy) badges.push('croshy');
  if (profile.badgeDark) badges.push('dark');
  if (profile.badgeTrusted) badges.push('trusted');
  if (profile.cgfPro) badges.push('pro');
  if (weeklyUser && profile.name && profile.name.trim().toLowerCase() === weeklyUser.trim().toLowerCase()) badges.push('weekly');
  if (monthlyUser && profile.name && profile.name.trim().toLowerCase() === monthlyUser.trim().toLowerCase()) badges.push('monthly');
  return badges;
}
app.locals.getBadges = getBadges;

// CGF Pro+ kullanıcıları isimlerini iki renk arasında akan bir gradyanla gösterebilir
// (2. renk ayarlandığında otomatik aktif olur — aynı renkler avatar halkasında da kullanılır).
function nameStyle(profile) {
  if (profile && profile.cgfPro && profile.color2) {
    const c1 = profile.color || '#e3a23c';
    const c2 = profile.color2;
    return { cls: 'name-gradient', style: `background-image: linear-gradient(90deg, ${c1}, ${c2}, ${c1});` };
  }
  return { cls: '', style: `color: ${(profile && profile.color) || 'var(--accent)'};` };
}
app.locals.nameStyle = nameStyle;

// ---- Multer (fotoğraf önerisi yükleme) ----
const SUGGESTIONS_DIR = path.join(UPLOAD_DIR, 'suggestions');
if (!fs.existsSync(SUGGESTIONS_DIR)) fs.mkdirSync(SUGGESTIONS_DIR, { recursive: true });

const suggestionStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SUGGESTIONS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  },
});
const suggestionUpload = multer({
  storage: suggestionStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Sadece jpg, jpeg, png, webp veya gif dosyaları yüklenebilir.'));
    }
    cb(null, true);
  },
});

// ---- Multer (CGF Pro+ kanıt fotoğrafı yükleme) ----
const PRO_SUBMISSIONS_DIR = path.join(UPLOAD_DIR, 'pro-submissions');
if (!fs.existsSync(PRO_SUBMISSIONS_DIR)) fs.mkdirSync(PRO_SUBMISSIONS_DIR, { recursive: true });

const proSubmissionStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRO_SUBMISSIONS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  },
});
const proSubmissionUpload = multer({
  storage: proSubmissionStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Sadece jpg, jpeg, png, webp veya gif dosyaları yüklenebilir.'));
    }
    cb(null, true);
  },
});

// Fotoğraf önerebilmek için gereken en az "aktif gün" sayısı — CGF Pro+ kullanıcılar için daha kısa
// (bir gün, o günde en az 60 saniye siteyle etkileşimde kalınmışsa sayılır)
const MIN_ACTIVE_DAYS_FOR_SUGGESTION = 5;
const MIN_ACTIVE_DAYS_FOR_SUGGESTION_PRO = 2;

// Gerçek istemci IP'sini alır (trust proxy ayarlandığı için X-Forwarded-For'a göre çözümlenir)
function getClientIp(req) {
  return req.ip;
}

// Renk alanı için hafif doğrulama: hex kod, rgb()/hsl() ya da düz renk ismi gibi makul değerleri kabul eder
function isValidColor(value) {
  if (!value || value.length > 30) return false;
  return /^[a-zA-Z0-9#(),.%\s-]+$/.test(value);
}

// En fazla bu kadar hesap aynı IP adresinden açılabilir
const MAX_ACCOUNTS_PER_IP = 2;

// Sabit zamanlı karşılaştırma: admin/viewer şifreleri env değişkeninden düz metin geldiği için
// bcrypt kullanılamaz, ancak "==="ile karşılaştırmak zamanlama (timing) saldırılarına açık kapı bırakır.
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Uzunluk farkını da sızdırmamak için sabit uzunlukta bir karşılaştırma yap (yine de eşleşmeyecek)
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Multer/dosya yükleme hatalarını anlaşılır Türkçe mesajlara çevirir
function translateUploadError(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') return 'Dosya çok büyük.';
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return 'Beklenmeyen dosya alanı.';
  return err.message || 'Dosya yüklenirken bir hata oluştu.';
}

// Oturum sabitleme (session fixation) saldırılarına karşı: giriş/kayıt başarılı olduğunda
// oturum kimliğini yeniler, ardından verilen callback içinde yeni oturuma veri yazılır.
function regenerateSession(req, fillSession) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      fillSession(req.session);
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });
}

// Kurtarma kodu üretir: okunması/yazması kolay, güvenli rastgele bir kod (örn. AB12-CD34-EF56)
function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilecek karakterler (0/O, 1/I) çıkarıldı
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += alphabet[crypto.randomInt(alphabet.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

// ---- Yardımcı: yetki kontrolleri ----
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.redirect('/admin/login');
}

// Ziyaretçi kaydı/etkileşim paneli yalnızca "viewer" girişine özeldir;
// tam yetkili admin (croshy) bilerek buraya erişemez — bu alan kasıtlı olarak ayrık tutulur.
function requireViewer(req, res, next) {
  if (req.session && req.session.role === 'viewer') return next();
  return res.redirect('/admin/login');
}

function requireAnyAdmin(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'viewer')) return next();
  return res.redirect('/admin/login');
}

// Herkese açık siteye girmeden önce hesap girişi (kullanıcı adı + şifre) istenir
function requireVisitor(req, res, next) {
  if (req.session && req.session.role) return next();
  if (req.session && req.session.visitorName) {
    const account = db.getAccount(req.session.visitorName);
    if (db.isAccountSuspended(account)) {
      return req.session.destroy(() => res.redirect('/giris'));
    }
    return next();
  }
  return res.redirect('/giris');
}

// ================== HESAP GİRİŞİ (kullanıcı adı + şifre) ==================

app.get('/giris', (req, res) => {
  if (req.session && (req.session.visitorName || req.session.role)) return res.redirect('/');
  res.render('giris', { error: null, username: '' });
});

app.post('/giris', authLimiter, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
      return res.render('giris', { error: 'Kullanıcı adı ve şifre zorunludur.', username });
    }

    const account = db.getAccount(username);
    if (!account) {
      // Kullanıcı adının var olup olmadığını sızdırmamak için aynı süre/aynı mesajla yanıt ver
      await bcrypt.compare(password, '$2b$12$invalidsaltinvalidsaltinvalidsalt.invalidhashinvalidhas');
      return res.render('giris', { error: 'Kullanıcı adı veya şifre hatalı.', username });
    }
    if (db.isAccountLocked(account)) {
      return res.render('giris', { error: 'Çok fazla başarısız deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.', username });
    }

    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) {
      db.recordFailedLogin(username);
      return res.render('giris', { error: 'Kullanıcı adı veya şifre hatalı.', username });
    }
    if (db.isAccountSuspended(account)) {
      return res.render('giris', { error: 'Bu hesap askıya alınmış. Detaylar için yönetimle iletişime geçebilirsin.', username });
    }

    db.resetFailedLogin(username);
    await regenerateSession(req, (session) => {
      session.visitorName = account.username;
    });
    db.logVisit(account.username);
    res.redirect('/');
  } catch (e) {
    console.error('Giriş hatası:', e.message);
    res.status(500).render('giris', { error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', username: '' });
  }
});

app.post('/cikis', (req, res) => {
  if (!req.session || !req.session.visitorName) return res.redirect('/');
  req.session.destroy(() => res.redirect('/giris'));
});

// ================== HESAP OLUŞTURMA ==================

const WEAK_PASSWORDS = new Set(['12345678', '123456789', 'password', 'sifre123', '11111111', 'qwertyui', 'password1', 'abc12345']);

app.get('/kayit', (req, res) => {
  if (req.session && (req.session.visitorName || req.session.role)) return res.redirect('/');
  res.render('kayit', { error: null, username: '', hitap: '', email: '' });
});

app.post('/kayit', authLimiter, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const hitap = (req.body.hitap || '').trim();
    const email = (req.body.email || '').trim();
    const password = req.body.password || '';
    const passwordConfirm = req.body.passwordConfirm || '';

    const usernamePattern = /^[a-zA-Z0-9_]{3,20}$/;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!usernamePattern.test(username)) {
      return res.render('kayit', { error: 'Kullanıcı adı 3-20 karakter olmalı ve yalnızca harf, rakam, alt çizgi içermelidir.', username, hitap, email });
    }
    if (!hitap) {
      return res.render('kayit', { error: 'Lütfen nasıl hitap edilmenizi istediğinizi yazın.', username, hitap, email });
    }
    if (hitap.length > 40) {
      return res.render('kayit', { error: 'Hitap çok uzun.', username, hitap, email });
    }
    if (email && !emailPattern.test(email)) {
      return res.render('kayit', { error: 'Geçerli bir e-posta adresi girin (ya da bu alanı boş bırakın).', username, hitap, email });
    }
    if (email && db.isEmailTaken(email)) {
      return res.render('kayit', { error: 'Bu e-posta adresi zaten başka bir hesapta kullanılıyor.', username, hitap, email });
    }
    if (password.length < 8) {
      return res.render('kayit', { error: 'Şifre en az 8 karakter olmalıdır.', username, hitap, email });
    }
    if (WEAK_PASSWORDS.has(password.toLowerCase())) {
      return res.render('kayit', { error: 'Bu şifre çok yaygın kullanılıyor, lütfen daha güçlü bir şifre seçin.', username, hitap, email });
    }
    if (password !== passwordConfirm) {
      return res.render('kayit', { error: 'Şifreler eşleşmiyor.', username, hitap, email });
    }
    if (db.isUsernameTaken(username)) {
      return res.render('kayit', { error: 'Bu kullanıcı adı zaten alınmış.', username, hitap, email });
    }

    const ip = getClientIp(req);
    if (db.countAccountsByIp(ip) >= MAX_ACCOUNTS_PER_IP) {
      return res.render('kayit', { error: `Bu IP adresinden en fazla ${MAX_ACCOUNTS_PER_IP} hesap oluşturulabilir.`, username, hitap, email });
    }

    // Şifre ve kurtarma kodu yalnızca bcrypt hash'i olarak saklanır; düz metin hiçbir yerde tutulmaz.
    const passwordHash = await bcrypt.hash(password, 12);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, 12);

    db.createAccount({ username, passwordHash, registrationIp: ip, recoveryCodeHash });
    db.upsertProfile(username, { hitap });
    if (email) db.setEmail(username, email);

    await regenerateSession(req, (session) => {
      session.visitorName = username;
    });
    db.logVisit(username);

    let emailSent = false;
    if (email) {
      emailSent = await sendMail(
        email,
        'CroShy Günün Fotoğrafı — Hesabın oluşturuldu',
        `<p>Merhaba ${hitap},</p>
         <p><strong>${username}</strong> kullanıcı adıyla hesabın oluşturuldu. Kurtarma kodun aşağıdadır — şifreni unutursan bu kodla hesabını kurtarabilirsin. Güvenli bir yerde sakla:</p>
         <p style="font-size:20px; font-weight:bold; letter-spacing:2px;">${recoveryCode}</p>
         <p>Bu kodu kimseyle paylaşma.</p>`
      );
    }

    // Kurtarma kodu yalnızca bu ekranda, bir kez gösterilir — kaydedilmezse bir daha gösterilmez.
    res.render('kayit-basarili', { username, recoveryCode, emailSent, email });
  } catch (e) {
    console.error('Kayıt hatası:', e.message);
    res.status(500).render('kayit', { error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', username: '', hitap: '', email: '' });
  }
});

// ================== HESAP KURTARMA ==================
// E-posta olmadan çalışır: kayıt sırasında bir kez gösterilen kurtarma koduyla şifre sıfırlanır.

app.get('/hesap-kurtar', (req, res) => {
  if (req.session && (req.session.visitorName || req.session.role)) return res.redirect('/');
  res.render('hesap-kurtar', { error: null, username: '', newRecoveryCode: null });
});

app.post('/hesap-kurtar', authLimiter, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const recoveryCode = (req.body.recoveryCode || '').trim().toUpperCase();
    const newPassword = req.body.newPassword || '';
    const newPasswordConfirm = req.body.newPasswordConfirm || '';

    if (!username || !recoveryCode || !newPassword) {
      return res.render('hesap-kurtar', { error: 'Tüm alanları doldurun.', username, newRecoveryCode: null });
    }

    const account = db.getAccount(username);
    if (!account || !account.recoveryCodeHash) {
      // Hesabın var olup olmadığını sızdırmamak için aynı hata mesajı ve benzer gecikme
      await bcrypt.compare(recoveryCode, '$2b$12$invalidsaltinvalidsaltinvalidsalt.invalidhashinvalidhas');
      return res.render('hesap-kurtar', { error: 'Kullanıcı adı veya kurtarma kodu hatalı.', username, newRecoveryCode: null });
    }
    if (db.isAccountLocked(account)) {
      return res.render('hesap-kurtar', { error: 'Çok fazla başarısız deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.', username, newRecoveryCode: null });
    }

    const codeOk = await bcrypt.compare(recoveryCode, account.recoveryCodeHash);
    if (!codeOk) {
      db.recordFailedLogin(username);
      return res.render('hesap-kurtar', { error: 'Kullanıcı adı veya kurtarma kodu hatalı.', username, newRecoveryCode: null });
    }
    if (newPassword.length < 8) {
      return res.render('hesap-kurtar', { error: 'Yeni şifre en az 8 karakter olmalıdır.', username, newRecoveryCode: null });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.render('hesap-kurtar', { error: 'Yeni şifreler eşleşmiyor.', username, newRecoveryCode: null });
    }

    db.resetFailedLogin(username);
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    db.setPasswordHash(username, newPasswordHash);

    // Kurtarma kodu tek kullanımlıktır — kullanıldıktan sonra yenisiyle değiştirilir
    const newRecoveryCode = generateRecoveryCode();
    const newRecoveryCodeHash = await bcrypt.hash(newRecoveryCode, 12);
    db.setRecoveryCodeHash(username, newRecoveryCodeHash);

    await regenerateSession(req, (session) => {
      session.visitorName = account.username;
    });
    db.logVisit(account.username);

    res.render('hesap-kurtar', { error: null, username, newRecoveryCode });
  } catch (e) {
    console.error('Hesap kurtarma hatası:', e.message);
    res.status(500).render('hesap-kurtar', { error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', username: '', newRecoveryCode: null });
  }
});

// ================== E-POSTA İLE HESAP KURTARMA (opsiyonel) ==================

app.get('/eposta-ile-kurtar', (req, res) => {
  if (req.session && (req.session.visitorName || req.session.role)) return res.redirect('/');
  res.render('eposta-ile-kurtar', { error: null, success: null });
});

app.post('/eposta-ile-kurtar', authLimiter, async (req, res) => {
  try {
    const email = (req.body.email || '').trim();
    // Hesabın var olup olmadığını sızdırmamak için her durumda aynı genel mesaj gösterilir
    const genericSuccess = 'Bu e-posta adresine kayıtlı bir hesap varsa, şifre sıfırlama bağlantısı gönderildi. Gelen kutunu (ve spam klasörünü) kontrol et.';

    if (!email) {
      return res.render('eposta-ile-kurtar', { error: 'Lütfen e-posta adresini gir.', success: null });
    }

    const account = db.getAccountByEmail(email);
    if (account && !db.isAccountSuspended(account)) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = await bcrypt.hash(rawToken, 12);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 dakika
      db.setResetToken(account.username, tokenHash, expiresAt);

      const resetUrl = `${req.protocol}://${req.get('host')}/sifre-sifirla?u=${encodeURIComponent(account.username)}&token=${rawToken}`;
      await sendMail(
        email,
        'CroShy Günün Fotoğrafı — Şifre sıfırlama',
        `<p>Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla. Bu bağlantı 30 dakika geçerlidir:</p>
         <p><a href="${resetUrl}">${resetUrl}</a></p>
         <p>Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>`
      );
    }

    res.render('eposta-ile-kurtar', { error: null, success: genericSuccess });
  } catch (e) {
    console.error('E-posta ile kurtarma hatası:', e.message);
    res.status(500).render('eposta-ile-kurtar', { error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', success: null });
  }
});

app.get('/sifre-sifirla', (req, res) => {
  const { u, token } = req.query;
  res.render('sifre-sifirla', { username: u || '', token: token || '', error: null, success: false });
});

app.post('/sifre-sifirla', authLimiter, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const token = (req.body.token || '').trim();
    const newPassword = req.body.newPassword || '';
    const newPasswordConfirm = req.body.newPasswordConfirm || '';

    if (!username || !token) {
      return res.render('sifre-sifirla', { username, token, error: 'Geçersiz bağlantı.', success: false });
    }

    const account = db.getAccount(username);
    if (!account || !db.isResetTokenValid(account)) {
      return res.render('sifre-sifirla', { username, token, error: 'Bu bağlantının süresi dolmuş ya da geçersiz. Yeni bir bağlantı iste.', success: false });
    }

    const tokenOk = await bcrypt.compare(token, account.resetTokenHash);
    if (!tokenOk) {
      return res.render('sifre-sifirla', { username, token, error: 'Bu bağlantının süresi dolmuş ya da geçersiz. Yeni bir bağlantı iste.', success: false });
    }
    if (newPassword.length < 8) {
      return res.render('sifre-sifirla', { username, token, error: 'Yeni şifre en az 8 karakter olmalıdır.', success: false });
    }
    if (WEAK_PASSWORDS.has(newPassword.toLowerCase())) {
      return res.render('sifre-sifirla', { username, token, error: 'Bu şifre çok yaygın kullanılıyor, lütfen daha güçlü bir şifre seçin.', success: false });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.render('sifre-sifirla', { username, token, error: 'Şifreler eşleşmiyor.', success: false });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    db.setPasswordHash(account.username, newPasswordHash);
    db.clearResetToken(account.username);
    db.resetFailedLogin(account.username);

    res.render('sifre-sifirla', { username, token: '', error: null, success: true });
  } catch (e) {
    console.error('Şifre sıfırlama hatası:', e.message);
    res.status(500).render('sifre-sifirla', { username: '', token: '', error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', success: false });
  }
});

// Profildeyken kurtarma kodunu kaybettiyseniz ya da yenilemek isterseniz
app.post('/profil/yeni-kurtarma-kodu', requireVisitorName, async (req, res) => {
  try {
    const newRecoveryCode = generateRecoveryCode();
    const newRecoveryCodeHash = await bcrypt.hash(newRecoveryCode, 12);
    db.setRecoveryCodeHash(req.session.visitorName, newRecoveryCodeHash);
    const profile = db.getProfile(req.session.visitorName);
    const account = db.getAccount(req.session.visitorName);
    res.render('profil', { profile, error: null, success: null, newRecoveryCode, isPro: db.isCgfPro(profile), weeklyActiveUser: db.getWeeklyActiveUser(), monthlyActiveUser: db.getMonthlyActiveUser(), currentEmail: account ? account.email : null });
  } catch (e) {
    console.error('Kurtarma kodu yenileme hatası:', e.message);
    const profile = db.getProfile(req.session.visitorName);
    const account = db.getAccount(req.session.visitorName);
    res.render('profil', { profile, error: 'Kurtarma kodu yenilenemedi, tekrar deneyin.', success: null, newRecoveryCode: null, isPro: db.isCgfPro(profile), weeklyActiveUser: db.getWeeklyActiveUser(), monthlyActiveUser: db.getMonthlyActiveUser(), currentEmail: account ? account.email : null });
  }
});

// Yalnızca gerçek bir hesapla giriş yapmış ziyaretçiler oy/yorum/öneri bırakabilir
function requireVisitorName(req, res, next) {
  if (req.session && req.session.visitorName) return next();
  return res.status(403).json({ error: 'Bunun için hesabınla giriş yapmalısın.' });
}

app.post('/api/oy', apiLimiter, requireVisitorName, (req, res) => {
  const photo = db.getTodaysPhoto();
  if (!photo) return res.status(404).json({ error: 'Bugün için bir fotoğraf yok.' });
  const type = req.body.type === 'dislike' ? 'dislike' : req.body.type === 'like' ? 'like' : null;
  if (!type) return res.status(400).json({ error: 'Geçersiz oy türü.' });

  const myVote = db.setVote(photo.id, req.session.visitorName, type);
  const votes = db.getVoteCounts(photo.id);
  res.json({ votes, myVote });
});

app.post('/api/yorum', apiLimiter, requireVisitorName, (req, res) => {
  const photo = db.getTodaysPhoto();
  if (!photo) return res.status(404).json({ error: 'Bugün için bir fotoğraf yok.' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Lütfen bir yorum yazın.' });
  const isPro = db.isCgfPro(db.getProfile(req.session.visitorName));
  const maxLen = isPro ? 500 : 300;
  if (text.length > maxLen) return res.status(400).json({ error: `Yorum en fazla ${maxLen} karakter olabilir.` });

  const comment = db.upsertComment(photo.id, req.session.visitorName, text);
  const profile = db.getProfile(req.session.visitorName);
  const badges = getBadges(profile, db.getWeeklyActiveUser(), db.getMonthlyActiveUser());
  res.json({ comment, profile, badges });
});

app.post('/api/yorum/begen', apiLimiter, requireVisitorName, (req, res) => {
  const photo = db.getTodaysPhoto();
  if (!photo) return res.status(404).json({ error: 'Bugün için bir fotoğraf yok.' });
  const authorName = (req.body.authorName || '').trim();
  if (!authorName) return res.status(400).json({ error: 'Geçersiz istek.' });

  const result = db.toggleCommentLike(photo.id, authorName, req.session.visitorName);
  if (!result) return res.status(404).json({ error: 'Yorum bulunamadı.' });
  res.json(result);
});

// Sayfa açıkken istemciden periyodik olarak çağrılır; "kaç gün aktif kalındığını"
// güvenilir şekilde ölçmek için sabit bir miktar süre ekler (istemciden gelen süre bilgisine güvenilmez)
app.post('/api/heartbeat', apiLimiter, requireVisitorName, (req, res) => {
  db.recordHeartbeat(req.session.visitorName);
  res.json({ ok: true });
});

app.post('/api/geribildirim', apiLimiter, requireVisitorName, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Lütfen bir geri bildirim yazın.' });
  if (text.length > 500) return res.status(400).json({ error: 'Geri bildirim en fazla 500 karakter olabilir.' });

  db.addFeedback(req.session.visitorName, text);
  res.json({ ok: true });
});

// ================== FOTOĞRAF ÖNERİSİ ==================

function getSuggestionEligibility(name) {
  const activeDays = db.getActiveDaysCount(name);
  const profile = db.getProfile(name);
  const isPro = db.isCgfPro(profile);
  const requiredDays = isPro ? MIN_ACTIVE_DAYS_FOR_SUGGESTION_PRO : MIN_ACTIVE_DAYS_FOR_SUGGESTION;
  const banned = db.isSuggestionBanned(profile);
  const enoughDays = activeDays > requiredDays;
  const alreadyToday = db.hasSuggestedToday(name);
  return {
    activeDays,
    banned,
    banUntil: profile ? profile.suggestionBanUntil : null,
    enoughDays,
    alreadyToday,
    isPro,
    requiredDays,
    eligible: enoughDays && !banned && !alreadyToday,
  };
}

app.get('/oner', requireVisitorName, (req, res) => {
  const eligibility = getSuggestionEligibility(req.session.visitorName);
  res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: null, success: null });
});

app.post('/oner', uploadLimiter, requireVisitorName, (req, res) => {
  suggestionUpload.single('image')(req, res, (err) => {
    const eligibility = getSuggestionEligibility(req.session.visitorName);

    if (!eligibility.eligible) {
      if (req.file) fs.unlink(path.join(SUGGESTIONS_DIR, req.file.filename), () => {});
      return res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: 'Şu an fotoğraf önerme hakkın yok.', success: null });
    }
    if (err) {
      return res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: translateUploadError(err), success: null });
    }

    const photoName = (req.body.name || '').trim();
    const color = (req.body.color || '').trim();
    const description = (req.body.description || '').trim();

    if (!req.file) {
      return res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: 'Lütfen bir fotoğraf seçin.', success: null });
    }
    if (!photoName) {
      fs.unlink(path.join(SUGGESTIONS_DIR, req.file.filename), () => {});
      return res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: 'Fotoğraf ismi zorunludur.', success: null });
    }
    if (!color) {
      fs.unlink(path.join(SUGGESTIONS_DIR, req.file.filename), () => {});
      return res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: 'Renk seçimi zorunludur.', success: null });
    }
    if (!isValidColor(color)) {
      fs.unlink(path.join(SUGGESTIONS_DIR, req.file.filename), () => {});
      return res.render('oner', { eligibility, minDays: eligibility.requiredDays, error: 'Geçersiz renk değeri.', success: null });
    }

    db.addSuggestion({
      name: req.session.visitorName,
      photoName,
      color,
      description,
      filename: req.file.filename,
      featured: eligibility.isPro,
    });

    const refreshed = getSuggestionEligibility(req.session.visitorName);
    res.render('oner', { eligibility: refreshed, minDays: refreshed.requiredDays, error: null, success: 'Öneri gönderildi! Onaylanırsa sıraya eklenecek.' });
  });
});

// ================== CGF PRO+ BAŞVURUSU ==================

app.get('/cgf-pro', requireVisitorName, (req, res) => {
  const profile = db.getProfile(req.session.visitorName);
  const isPro = db.isCgfPro(profile);
  const hasPending = db.hasPendingProSubmission(req.session.visitorName);
  res.render('cgf-pro', { isPro, hasPending, error: null, success: null });
});

app.post('/cgf-pro', uploadLimiter, requireVisitorName, (req, res) => {
  proSubmissionUpload.single('image')(req, res, (err) => {
    const profile = db.getProfile(req.session.visitorName);
    const isPro = db.isCgfPro(profile);
    const hasPending = db.hasPendingProSubmission(req.session.visitorName);

    if (isPro) {
      return res.render('cgf-pro', { isPro, hasPending, error: 'Zaten CGF Pro+ üyesisin.', success: null });
    }
    if (hasPending) {
      if (req.file) fs.unlink(path.join(PRO_SUBMISSIONS_DIR, req.file.filename), () => {});
      return res.render('cgf-pro', { isPro, hasPending, error: 'Zaten incelenmeyi bekleyen bir başvurun var.', success: null });
    }
    if (err) {
      return res.render('cgf-pro', { isPro, hasPending, error: translateUploadError(err), success: null });
    }
    if (!req.file) {
      return res.render('cgf-pro', { isPro, hasPending, error: 'Lütfen kanıt fotoğrafını yükle.', success: null });
    }

    db.addProSubmission({ name: req.session.visitorName, filename: req.file.filename });
    res.render('cgf-pro', { isPro: false, hasPending: true, error: null, success: 'Başvurun alındı! İncelendikten sonra CGF Pro+ üyeliğin aktif olacak.' });
  });
});

app.post('/admin/cgf-pro/:id/onayla', requireViewer, (req, res) => {
  const submission = db.getProSubmission(req.params.id);
  if (!submission || submission.status !== 'pending') return res.redirect('/admin/ziyaretciler');
  db.setCgfPro(submission.name, true);
  db.setProSubmissionStatus(submission.id, 'approved');
  res.redirect('/admin/ziyaretciler');
});

app.post('/admin/cgf-pro/:id/reddet', requireViewer, (req, res) => {
  const submission = db.getProSubmission(req.params.id);
  if (!submission || submission.status !== 'pending') return res.redirect('/admin/ziyaretciler');
  fs.unlink(path.join(PRO_SUBMISSIONS_DIR, submission.filename), () => {});
  db.setProSubmissionStatus(submission.id, 'rejected');
  res.redirect('/admin/ziyaretciler');
});

app.post('/admin/ziyaretciler/:name/pro-kaldir', requireViewer, (req, res) => {
  db.setCgfPro(req.params.name, false);
  res.redirect('/admin/ziyaretciler');
});

// ================== PROFİL ==================

app.get('/profil', requireVisitorName, (req, res) => {
  const profile = db.getProfile(req.session.visitorName) || { hitap: '', description: '', color: '#e3a23c', color2: null, discord: '', avatar: null };
  const isPro = db.isCgfPro(profile);
  const account = db.getAccount(req.session.visitorName);
  res.render('profil', { profile, error: null, success: null, newRecoveryCode: null, isPro, weeklyActiveUser: db.getWeeklyActiveUser(), monthlyActiveUser: db.getMonthlyActiveUser(), currentEmail: account ? account.email : null });
});

app.post('/profil', uploadLimiter, requireVisitorName, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    const existing = db.getProfile(req.session.visitorName) || { hitap: '', description: '', color: '#e3a23c', color2: null, discord: '', avatar: null };
    const isPro = db.isCgfPro(existing);
    const weeklyActiveUser = db.getWeeklyActiveUser();
    const monthlyActiveUser = db.getMonthlyActiveUser();
    const existingAccount = db.getAccount(req.session.visitorName);
    const renderArgs = { newRecoveryCode: null, isPro, weeklyActiveUser, monthlyActiveUser, currentEmail: existingAccount ? existingAccount.email : null };

    if (err) {
      return res.render('profil', { profile: existing, error: translateUploadError(err), success: null, ...renderArgs });
    }

    const hitap = (req.body.hitap || '').trim();
    const description = (req.body.description || '').trim();
    const color = (req.body.color || '').trim();
    const color2 = (req.body.color2 || '').trim();
    const discord = (req.body.discord || '').trim();
    const email = (req.body.email || '').trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const descMax = isPro ? 400 : 200;

    if (!hitap) {
      if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
      return res.render('profil', { profile: existing, error: 'Hitap alanı zorunludur.', success: null, ...renderArgs });
    }
    if (hitap.length > 40) {
      if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
      return res.render('profil', { profile: existing, error: 'Hitap çok uzun.', success: null, ...renderArgs });
    }
    if (description.length > descMax) {
      if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
      return res.render('profil', { profile: existing, error: `Açıklama en fazla ${descMax} karakter olabilir.`, success: null, ...renderArgs });
    }
    if (discord.length > 40) {
      if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
      return res.render('profil', { profile: existing, error: 'Discord ismi çok uzun.', success: null, ...renderArgs });
    }
    if (email && !emailPattern.test(email)) {
      if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
      return res.render('profil', { profile: existing, error: 'Geçerli bir e-posta adresi girin (ya da bu alanı boş bırakın).', success: null, ...renderArgs });
    }
    if (email && (!existingAccount || existingAccount.email !== email.toLowerCase()) && db.isEmailTaken(email)) {
      if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
      return res.render('profil', { profile: existing, error: 'Bu e-posta adresi zaten başka bir hesapta kullanılıyor.', success: null, ...renderArgs });
    }

    const updates = { hitap, description, discord };
    if (color) {
      if (!isValidColor(color)) {
        if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
        return res.render('profil', { profile: existing, error: 'Geçersiz renk değeri.', success: null, ...renderArgs });
      }
      updates.color = color;
    }

    // İkinci profil rengi (gradyan) — yalnızca CGF Pro+ kullanıcıları için
    let color2Rejected = false;
    if (isPro) {
      if (color2) {
        if (!isValidColor(color2)) {
          if (req.file) fs.unlink(path.join(AVATAR_DIR, req.file.filename), () => {});
          return res.render('profil', { profile: existing, error: 'Geçersiz ikinci renk değeri.', success: null, ...renderArgs });
        }
        updates.color2 = color2;
      } else {
        updates.color2 = null;
      }
    } else if (color2) {
      color2Rejected = true;
    }

    if (req.file) {
      // Eski özel profil fotoğrafını temizle (varsayılan fotoğrafsa dokunma)
      if (existing.avatar) {
        fs.unlink(path.join(AVATAR_DIR, existing.avatar), () => {});
      }
      updates.avatar = req.file.filename;
    }

    db.setEmail(req.session.visitorName, email || null);

    const updated = db.upsertProfile(req.session.visitorName, updates);
    const success = color2Rejected
      ? 'Profilin kaydedildi. (İkinci profil rengi kaydedilmedi — bu bir CGF Pro+ özelliğidir! Ana sayfadaki "CGF Pro+ Ol" bölümüne göz atabilirsin. ✨)'
      : 'Profilin kaydedildi.';
    res.render('profil', { profile: updated, error: null, success, ...renderArgs, currentEmail: email || null });
  });
});

// ================== PUBLİK SAYFALAR ==================

app.get('/', requireVisitor, (req, res) => {
  const photo = db.getTodaysPhoto();
  let edition = null;
  let ogImage = null;
  let votes = { likes: 0, dislikes: 0 };
  let myVote = null;
  let comments = [];
  let myComment = null;
  let myProfile = null;

  const weeklyActiveUser = db.getWeeklyActiveUser();
  const monthlyActiveUser = db.getMonthlyActiveUser();

  if (photo) {
    const all = db.getAllPhotos(); // showDate'e göre artan sırada
    const idx = all.findIndex((p) => p.id === photo.id);
    edition = idx >= 0 ? idx + 1 : null;
    ogImage = `${req.protocol}://${req.get('host')}/uploads/${photo.filename}`;
    votes = db.getVoteCounts(photo.id);
    comments = db.getComments(photo.id).map((c) => ({
      ...c,
      profile: db.getProfile(c.name),
      likeCount: c.likedBy.length,
      likedByMe: req.session.visitorName ? c.likedBy.some((n) => n.trim().toLowerCase() === req.session.visitorName.trim().toLowerCase()) : false,
    }));
    if (req.session.visitorName) {
      myVote = db.getMyVote(photo.id, req.session.visitorName);
      myComment = db.getMyComment(photo.id, req.session.visitorName);
    }
  }

  if (req.session.visitorName) {
    myProfile = db.getProfile(req.session.visitorName);
  }

  const suggestionEligibility = req.session.visitorName ? getSuggestionEligibility(req.session.visitorName) : null;

  res.render('index', {
    photo,
    today: db.todayStr(),
    edition,
    ogImage,
    votes,
    myVote,
    comments,
    myComment,
    visitorName: req.session.visitorName || null,
    myProfile,
    suggestionEligibility,
    weeklyActiveUser,
    monthlyActiveUser,
  });
});

// ================== HERKESE AÇIK PROFİL GÖRÜNTÜLEME ==================

app.get('/kullanici/:username', requireVisitor, (req, res) => {
  const profile = db.getProfile(req.params.username);
  if (!profile) {
    return res.status(404).render('kullanici', { profile: null, username: req.params.username, badges: [], weeklyActiveUser: null, monthlyActiveUser: null });
  }
  const weeklyActiveUser = db.getWeeklyActiveUser();
  const monthlyActiveUser = db.getMonthlyActiveUser();
  const badges = getBadges(profile, weeklyActiveUser, monthlyActiveUser);
  res.render('kullanici', { profile, username: req.params.username, badges, weeklyActiveUser, monthlyActiveUser });
});

// ================== ADMIN - GİRİŞ ==================

app.get('/admin/login', (req, res) => {
  if (req.session && req.session.role === 'admin') return res.redirect('/admin');
  if (req.session && req.session.role === 'viewer') return res.redirect('/admin/ziyaretciler');
  res.render('login', { error: null });
});

app.post('/admin/login', authLimiter, async (req, res) => {
  const username = req.body.username || '';
  const password = req.body.password || '';

  const isAdminMatch = safeCompare(username, ADMIN_USERNAME) && safeCompare(password, ADMIN_PASSWORD);
  const isViewerMatch = safeCompare(username, VIEWER_USERNAME) && safeCompare(password, VIEWER_PASSWORD);

  if (isAdminMatch) {
    await regenerateSession(req, (session) => {
      session.role = 'admin';
    });
    return res.redirect('/admin');
  }
  if (isViewerMatch) {
    await regenerateSession(req, (session) => {
      session.role = 'viewer';
    });
    return res.redirect('/admin/ziyaretciler');
  }
  res.render('login', { error: 'Kullanıcı adı veya şifre hatalı.' });
});

app.post('/admin/logout', requireAnyAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ================== ZİYARETÇİ KAYDI VE ETKİLEŞİMLER (yalnızca viewer girişine özel) ==================

app.get('/admin/ziyaretciler', requireViewer, (req, res) => {
  const visitors = db.getVisitorSummary();
  const todaysPhoto = db.getTodaysPhoto();
  const activityMap = todaysPhoto ? db.getPhotoActivity(todaysPhoto.id) : new Map();
  const weeklyActiveUser = db.getWeeklyActiveUser();
  const monthlyActiveUser = db.getMonthlyActiveUser();

  // Ziyaretçi listesini bugünkü oy/yorum bilgisi, profil bilgisi, öneri istatistikleri,
  // "mühendislik harikası" özellikler (çevrimiçi durumu, şüpheli IP paylaşımı) ile zenginleştir
  const enriched = visitors.map((v) => {
    const key = v.name.trim().toLowerCase();
    const activity = activityMap.get(key);
    const profile = db.getProfile(v.name);
    return {
      ...v,
      vote: activity ? activity.vote : null,
      comment: activity ? activity.comment : null,
      profile,
      activeDays: db.getActiveDaysCount(v.name),
      banned: db.isSuggestionBanned(profile),
      banUntil: profile ? profile.suggestionBanUntil : null,
      online: db.isOnline(v.name),
      sharedIpWith: db.getAccountsSharingIp(v.name),
      isPro: db.isCgfPro(profile),
    };
  });

  const pendingSuggestions = db.getPendingSuggestions().map((s) => ({
    ...s,
    profile: db.getProfile(s.name),
  }));

  const pendingProSubmissions = db.getPendingProSubmissions().map((s) => ({
    ...s,
    profile: db.getProfile(s.name),
  }));

  res.render('visitors', {
    visitors: enriched,
    todaysPhoto,
    pendingSuggestions,
    pendingProSubmissions,
    minDays: MIN_ACTIVE_DAYS_FOR_SUGGESTION,
    weeklyActiveUser,
    monthlyActiveUser,
  });
});

app.post('/admin/oneriler/:id/onayla', requireViewer, (req, res) => {
  const suggestion = db.getSuggestion(req.params.id);
  if (!suggestion || suggestion.status !== 'pending') return res.redirect('/admin/ziyaretciler');

  // Öneri dosyasını suggestions/ klasöründen ana yükleme klasörüne taşı,
  // sonra normal fotoğraf sırasına ekle
  const from = path.join(SUGGESTIONS_DIR, suggestion.filename);
  const to = path.join(UPLOAD_DIR, suggestion.filename);
  try {
    fs.renameSync(from, to);
  } catch (e) {
    // dosya zaten taşınmışsa ya da bulunamıyorsa sessizce devam et
  }

  db.addPhoto({
    name: suggestion.photoName,
    color: suggestion.color,
    description: suggestion.description,
    filename: suggestion.filename,
  });
  db.setSuggestionStatus(suggestion.id, 'approved');
  res.redirect('/admin/ziyaretciler');
});

app.post('/admin/oneriler/:id/reddet', requireViewer, (req, res) => {
  const suggestion = db.getSuggestion(req.params.id);
  if (!suggestion || suggestion.status !== 'pending') return res.redirect('/admin/ziyaretciler');

  fs.unlink(path.join(SUGGESTIONS_DIR, suggestion.filename), () => {});
  db.setSuggestionStatus(suggestion.id, 'rejected');
  res.redirect('/admin/ziyaretciler');
});

app.post('/admin/ziyaretciler/:name/yasakla', requireViewer, (req, res) => {
  const duration = req.body.duration === 'kalici' ? 'kalici' : '5gun';
  db.banFromSuggesting(req.params.name, duration);
  res.redirect('/admin/ziyaretciler');
});

app.post('/admin/ziyaretciler/:name/yasak-kaldir', requireViewer, (req, res) => {
  db.unbanFromSuggesting(req.params.name);
  res.redirect('/admin/ziyaretciler');
});

// ================== ROZETLER (kim ne yaptı yanındaki yan sayfa) ==================

app.get('/admin/rozetler', requireViewer, (req, res) => {
  const accounts = db.getAllAccountsWithProfiles();
  const weeklyActiveUser = db.getWeeklyActiveUser();
  const monthlyActiveUser = db.getMonthlyActiveUser();
  res.render('rozetler', { accounts, weeklyActiveUser, monthlyActiveUser });
});

app.post('/admin/rozetler/:name/croshy', requireViewer, (req, res) => {
  const profile = db.getProfile(req.params.name);
  const newValue = !(profile && profile.badgeCroshy);
  db.setExclusiveBadge(req.params.name, 'badgeCroshy', newValue);
  res.redirect('/admin/rozetler');
});

app.post('/admin/rozetler/:name/dark', requireViewer, (req, res) => {
  const profile = db.getProfile(req.params.name);
  const newValue = !(profile && profile.badgeDark);
  db.setExclusiveBadge(req.params.name, 'badgeDark', newValue);
  res.redirect('/admin/rozetler');
});

app.post('/admin/rozetler/:name/guvenilir', requireViewer, (req, res) => {
  const profile = db.getProfile(req.params.name);
  const newValue = !(profile && profile.badgeTrusted);
  db.toggleTrustedBadge(req.params.name, newValue);
  res.redirect('/admin/rozetler');
});

// ================== GERİ BİLDİRİMLER (kim ne yaptı yanındaki yan sayfa) ==================

app.get('/admin/geribildirimler', requireViewer, (req, res) => {
  const feedback = db.getAllFeedback().map((f) => ({
    ...f,
    profile: db.getProfile(f.name),
  }));
  res.render('geribildirimler', { feedback });
});

// ================== HESAP YÖNETİMİ (kim ne yaptı yanındaki yan sayfa) ==================

app.get('/admin/hesaplar', requireViewer, (req, res) => {
  const accounts = db.getAllAccountsWithProfiles().map((a) => {
    const account = db.getAccount(a.username);
    return {
      ...a,
      suspended: db.isAccountSuspended(account),
      createdAt: account ? account.createdAt : null,
      registrationIp: account ? account.registrationIp : null,
    };
  });
  res.render('hesaplar', { accounts, error: null });
});

app.post('/admin/hesaplar/:username/askiya-al', requireViewer, (req, res) => {
  db.setAccountSuspended(req.params.username, true);
  res.redirect('/admin/hesaplar');
});

app.post('/admin/hesaplar/:username/askiyi-kaldir', requireViewer, (req, res) => {
  db.setAccountSuspended(req.params.username, false);
  res.redirect('/admin/hesaplar');
});

app.post('/admin/hesaplar/:username/yeniden-adlandir', requireViewer, (req, res) => {
  const newUsername = (req.body.newUsername || '').trim();
  const usernamePattern = /^[a-zA-Z0-9_]{3,20}$/;

  const renderError = (error) => {
    const accounts = db.getAllAccountsWithProfiles().map((a) => {
      const account = db.getAccount(a.username);
      return { ...a, suspended: db.isAccountSuspended(account), createdAt: account ? account.createdAt : null, registrationIp: account ? account.registrationIp : null };
    });
    res.render('hesaplar', { accounts, error });
  };

  if (!usernamePattern.test(newUsername)) {
    return renderError('Yeni kullanıcı adı 3-20 karakter olmalı ve yalnızca harf, rakam, alt çizgi içermelidir.');
  }
  if (db.isUsernameTaken(newUsername)) {
    return renderError('Bu kullanıcı adı zaten alınmış.');
  }
  const ok = db.renameAccountEverywhere(req.params.username, newUsername);
  if (!ok) {
    return renderError('Hesap bulunamadı.');
  }
  res.redirect('/admin/hesaplar');
});

// ================== ADMIN - PANEL ==================

app.get('/admin', requireAdmin, (req, res) => {
  const queue = db.getUpcomingQueue();
  const past = db.getPastPhotos();
  res.render('admin', { queue, past, error: null, success: null, today: db.todayStr() });
});

app.post('/admin/photos', uploadLimiter, requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    const queue = db.getUpcomingQueue();
    const past = db.getPastPhotos();

    if (err) {
      return res.render('admin', { queue, past, error: translateUploadError(err), success: null, today: db.todayStr() });
    }
    const { name, color, description } = req.body;
    if (!req.file) {
      return res.render('admin', { queue, past, error: 'Lütfen bir fotoğraf seçin.', success: null, today: db.todayStr() });
    }
    if (!name || !name.trim()) {
      return res.render('admin', { queue, past, error: 'Fotoğraf ismi zorunludur.', success: null, today: db.todayStr() });
    }
    if (!color || !color.trim()) {
      return res.render('admin', { queue, past, error: 'Renk seçimi zorunludur.', success: null, today: db.todayStr() });
    }
    if (!isValidColor(color.trim())) {
      return res.render('admin', { queue, past, error: 'Geçersiz renk değeri.', success: null, today: db.todayStr() });
    }

    const photo = db.addPhoto({
      name: name.trim(),
      color: color.trim(),
      description: description ? description.trim() : '',
      filename: req.file.filename,
    });

    const refreshedQueue = db.getUpcomingQueue();
    const refreshedPast = db.getPastPhotos();
    res.render('admin', {
      queue: refreshedQueue,
      past: refreshedPast,
      error: null,
      success: `"${photo.name}" eklendi. Gösterim tarihi: ${photo.showDate}`,
      today: db.todayStr(),
    });
  });
});

app.post('/admin/photos/:id/delete', requireAdmin, (req, res) => {
  const photo = db.deletePhoto(req.params.id);
  if (photo) {
    const filePath = path.join(UPLOAD_DIR, photo.filename);
    fs.unlink(filePath, () => {});
  }
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`Günün Fotoğrafı sunucusu ${PORT} portunda çalışıyor (ortam: ${isProd ? 'production' : 'development'})`);
});
