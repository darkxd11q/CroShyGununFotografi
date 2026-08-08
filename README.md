# CroShy Günün Fotoğrafı

Her gün yalnızca bir fotoğraf gösteren, admin panelli bir web sitesi. Fotoğraflar admin panelinden eklenir; sistem her fotoğrafa otomatik olarak bir gösterim günü atar ve o gün geldiğinde ana sayfada gösterir. Bu proje **Render** üzerinde çalışacak şekilde yapılandırılmıştır.

## Nasıl çalışır?

- Siteye girmek için gerçek bir **hesap** gerekir: `/kayit` üzerinden kullanıcı adı + şifre + hitap ile hesap oluşturulur, `/giris` üzerinden şifreyle giriş yapılır.
- **Şifreler hiçbir yerde düz metin olarak saklanmaz** — yalnızca bcrypt hash'i tutulur. Art arda 8 başarısız girişten sonra hesap 15 dakika kilitlenir.
- Kayıt sırasında bir kez gösterilen **kurtarma koduyla** (e-posta gerekmeden) şifre unutulduğunda hesap kurtarılabilir.
- Giriş yapıldığında site o hesabı **30 yıl boyunca hatırlar** (kalıcı, diske yazılan oturumlarla — sunucu yeniden başlasa/deploy edilse bile oturumlar kaybolmaz).
- **Bir IP adresinden en fazla 2 hesap** oluşturulabilir.
- Herkesin bir **profili** vardır: profil fotoğrafı, açıklama, profil rengi (CGF Pro+ ile 2 renk / gradyan) ve Discord ismi — `/profil` sayfasından düzenlenebilir. Herkesin profili `/kullanici/:kullaniciadi` üzerinden başkaları tarafından da görüntülenebilir.
- Kullanıcılar **rozet** kazanabilir: Haftanın Aktifi ve Ayın Aktifi her hafta/ay başında otomatik hesaplanıp o dönem boyunca sabitlenir; CroShy, Dark ve Güvenilir Kullanıcı rozetleri viewer panelinden elle verilir; CGF Pro+ rozeti onaylı başvurularla kazanılır. Rozetler yorumlarda, profil sayfalarında ve viewer panelinde tik olarak görünür.
- Günün fotoğrafı ilk kez açılırken bir Valorant Gece Pazarı tarzı **açılış animasyonu** oynar (parlayan gizem kartı → parçalanma → fotoğrafın patlamalı ortaya çıkışı). Bu animasyon her fotoğraf için günde yalnızca bir kez oynar.
- Günün fotoğrafına herkes **beğeni / beğenmeme** verebilir, **bir kere yorum** yazabilir (sonradan düzenlenebilir) ve **yorumları beğenebilir**.
- **5 günden fazla** (CGF Pro+ için 2 günden fazla) siteyle etkileşimde bulunan kullanıcılar `/oner` sayfasından **günde 1 kez fotoğraf önerebilir**. Öneriler `/admin/ziyaretciler` panelinden onaylanır/reddedilir; CGF Pro+ kullanıcılarının önerileri inceleme sırasında öne çıkar.
- Herkes ana sayfadaki **geri bildirim** kutusundan siteyle ilgili düşüncelerini iletebilir; bunlar viewer panelinden okunabilir.
- Admin panelinden bir fotoğraf eklendiğinde (ya da bir öneri onaylandığında), sırada fotoğraf yoksa **bugün**, varsa **son planlanan fotoğrafın bir gün sonrasına** planlanır.

## CGF Pro+

Herkes YouTube'da CroShy ve darkxd11 kanallarına abone olduğunu ve CroShy'nin son videosunu beğendiğini gösteren **tek bir ekran görüntüsü** göndererek `/cgf-pro` üzerinden başvurabilir. Viewer panelinden onaylanırsa aşağıdaki ayrıcalıklar aktif olur:

- 🎨 **7 tema** (4 tanesi Pro+'a özel: Sunset, Aurora, Rose Gold, Mono)
- 🖼️ Fotoğraf önerebilmek için 6 gün yerine yalnızca **3 gün** bekleme
- ⭐ Önerilen fotoğrafların inceleme kuyruğunda **öne çıkması**
- 🌈 Profilde **2 renk** seçip hem gradyanlı bir avatar çerçevesi hem de isminde **akan, animasyonlu bir gradyan** oluşturma (Pro+ olmayanlar tek renk seçer; ikinci rengi kaydetmeye çalışırlarsa kaydedilmez ve bunun bir Pro+ özelliği olduğu nazikçe hatırlatılır)
- ✅ İsmin yanında özel **CGF Pro+ rozeti**
- 💬 Daha uzun yorum (500) ve açıklama (400 karakter)
- ✨ Avatarda parlayan gradyan çerçeve efekti

Ana sayfada Pro+ olmayan kullanıcılara tanıtım kartı ve ara sıra hatırlatma mesajları gösterilir.

## Güvenlik

- Şifreler ve kurtarma kodları **bcrypt** ile (12 salt round) hash'lenir; hiçbir dosyada, günlükte ya da başka bir yerde düz metin olarak tutulmaz.
- **Helmet** ile güvenlik başlıkları (Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options vb.) tüm yanıtlara uygulanır.
- **Hız sınırlama (rate limiting):** giriş/kayıt/hesap kurtarma uçları 15 dakikada en fazla 20 istekle, oy/yorum/heartbeat gibi uçlar dakikada 60 istekle, dosya yükleyen uçlar (fotoğraf/profil/öneri/CGF Pro+ başvurusu) saatte 30 istekle sınırlıdır.
- Bir hesaba art arda 8 başarısız giriş (veya kurtarma) denemesinden sonra hesap 15 dakika kilitlenir (kaba kuvvet saldırılarına karşı).
- **Oturum sabitleme (session fixation) koruması:** giriş, kayıt, hesap kurtarma ve admin girişinde oturum kimliği yenilenir.
- Admin/viewer şifre karşılaştırması **sabit zamanlı (timing-safe)** yapılır; hesap var/yok bilgisi giriş ve kurtarma hata mesajlarından sızdırılmaz.
- Yaygın/zayıf şifreler (`12345678`, `password` vb.) kayıt sırasında reddedilir.
- Renk gibi kullanıcı girdileri sunucu tarafında doğrulanır; dosya yükleme uzantı ve boyut sınırlarıyla kontrol edilir.
- Oturum çerezleri `httpOnly` ve (üretimde) `secure` olarak ayarlanır; oturumlar diske yazılır, böylece 30 yıllık hatırlama vaadi sunucu yeniden başlasa bile geçerliliğini korur.
- Kullanıcı adı benzersizdir ve bir IP adresinden en fazla 2 hesap açılabilir.
- **Askıya alınan hesaplar** anında giriş yapamaz hale gelir; aktif bir oturumu varsa bir sonraki isteğinde otomatik olarak oturumu sonlandırılır.
- **Veri kalıcılığı:** tüm veri dosyaları yalnızca yoksa oluşturulur, mevcut bir dosyanın üzerine asla yazılmaz. Bu sayede yeni bir güncelleme deploy edildiğinde mevcut kullanıcılar, hesaplar, fotoğraflar ve tüm diğer veriler korunur — hiçbir güncelleme verileri sıfırlamaz.

## Hesap Kurtarma

İki bağımsız yöntemle çalışır — biri e-posta gerektirmez, diğeri opsiyonel e-postayla çalışır:

**1. Kurtarma kodu (her zaman çalışır, e-posta gerekmez)**
- Kayıt tamamlandığında ekranda **bir kez** bir kurtarma kodu gösterilir (örn. `AB12-CD34-EF56`). Bu kod yalnızca o an gösterilir, sisteme sonradan hiçbir yerden tekrar getirilemez — mutlaka kaydedilmesi gerekir.
- Şifre unutulduğunda `/hesap-kurtar` sayfasından kullanıcı adı + kurtarma kodu + yeni şifre girilerek hesap kurtarılır.
- Kurtarma kodu **tek kullanımlıktır** — başarılı bir kurtarmadan sonra otomatik olarak yeni bir kodla değiştirilir ve yine bir kez gösterilir.
- `/profil` sayfasından istenildiği zaman "Yeni Kurtarma Kodu Oluştur" ile kod elle de yenilenebilir (eskisi geçersiz olur).

**2. E-posta ile şifre sıfırlama (opsiyonel)**
- Kayıt sırasında ya da sonradan `/profil` sayfasından bir e-posta adresi eklenebilir (zorunlu değildir).
- E-posta eklendiyse, kayıt sırasında kurtarma kodu ayrıca o adrese de gönderilir (ekrandaki kodu kaybetme ihtimaline karşı yedek).
- Şifre unutulduğunda `/eposta-ile-kurtar` sayfasından e-posta girilir; hesapla eşleşiyorsa **30 dakika geçerli, tek kullanımlık** bir sıfırlama bağlantısı gönderilir. Bağlantıya tıklanınca yeni şifre belirlenir.
- Hangi e-postaların kayıtlı olduğunu sızdırmamak için, eşleşme olsun ya da olmasın her zaman aynı genel mesaj gösterilir.

**E-posta gönderimi tamamen ücretsizdir** ve site bu özellik yapılandırılmasa da eksiksiz çalışır (kurtarma kodu sistemi zaten bağımsızdır). Ücretsiz kurulum için `.env.example` dosyasındaki adım adım Gmail talimatlarına bakın — özetle: Gmail hesabınızda 2 Adımlı Doğrulamayı açıp bir "Uygulama Şifresi" oluşturup `SMTP_*` ortam değişkenlerine girmeniz yeterlidir, üçüncü parti bir servise kaydolmaya gerek yoktur.

## Rozetler

Profillerde, yorumlarda ve viewer panelinde küçük bir tik olarak görünür:

| Rozet | Nasıl kazanılır | Renk |
|---|---|---|
| Haftanın Aktifi | Otomatik — her Pazartesi başında bir önceki haftanın en aktif kullanıcısına verilir, o hafta boyunca sabit kalır | Amber |
| Ayın Aktifi | Otomatik — her ayın 1'inde bir önceki ayın en aktif kullanıcısına verilir, o ay boyunca sabit kalır | Mor |
| CroShy | Elle, `/admin/rozetler` üzerinden — **aynı anda yalnızca bir hesapta olabilir** | Kırmızı-beyaz |
| Dark | Elle, `/admin/rozetler` üzerinden — **aynı anda yalnızca bir hesapta olabilir** | Sarı-lacivert |
| Güvenilir Kullanıcı | Elle, `/admin/rozetler` üzerinden — birden fazla hesaba verilebilir | Yeşil |
| CGF Pro+ | Onaylı CGF Pro+ başvurusuyla otomatik | Mavi-beyaz |

CroShy ya da Dark rozeti başka birine verildiğinde, bir önceki sahibinden otomatik olarak kalkar.

## Geri Bildirim

- Ana sayfada, giriş yapmış herkesin görebileceği bir geri bildirim kutusu bulunur.
- Sekme açıkken belirli aralıklarla (yaklaşık 4 dakikada bir) "Geri bildirimleriniz bizim için çok önemli!" gibi nazik bir hatırlatma belirir.
- Gönderilen geri bildirimler `/admin/geribildirimler` sayfasından (yalnızca viewer girişiyle) isim, hitap, profil fotoğrafı ve zaman bilgisiyle görüntülenir.

## Fotoğraf Önerisi Sistemi

- Kullanıcı sayfada aktifken (sekme görünürken) istemci her 15 saniyede bir sunucuya "heartbeat" gönderir; bir günde toplam en az 60 saniye heartbeat gönderilmişse o gün "aktif gün" sayılır.
- **5'ten fazla** (CGF Pro+ için **2'den fazla**) aktif günü olan kullanıcılar `/oner` sayfasından fotoğraf, isim, renk ve opsiyonel açıklama ile **günde 1 kez** öneri gönderebilir.
- Öneriler onay bekler durumda `/admin/ziyaretciler` panelinde (yalnızca `admin` / `cokgizlisifre159753` girişiyle) görünür; CGF Pro+ kullanıcılarının önerileri listenin başında görünür:
  - **Onayla** → fotoğraf otomatik olarak sıraya eklenir.
  - **Reddet** → öneri ve yüklenen dosya silinir.
- Her ziyaretçi için ayrıca **5 Gün Yasakla**, **Kalıcı Yasakla** ve **Yasağı Kaldır** kontrolleri bulunur.

## Giriş Türleri

Sitenin iki farklı admin girişi vardır, ikisi de `/admin/login` üzerinden yapılır. **Bu iki panel birbirinden kesinlikle izole edilmiştir** — `croshy` ile giren kişi ziyaretçi/etkileşim kaydını (ve ona bağlı rozet/geri bildirim/hesap yönetimi sayfalarını) göremez, `admin` ile giren kişi de fotoğraf yönetim paneline giremez.

| Kullanıcı Adı | Şifre | Ne yapabilir |
|---|---|---|
| `croshy` | `croshyevrenseldir9467` | Fotoğraf ekleme/silme paneli (`/admin`) — tam yetki |
| `admin` | `cokgizlisifre159753` | Ziyaretçi/etkileşim kaydı, rozet yönetimi, geri bildirimler, **hesap yönetimi** (askıya alma/kaldırma, yeniden adlandırma), CGF Pro+ ve fotoğraf önerisi onaylama/reddetme — bu alanlar yalnızca bu girişe özeldir |

Bu değerleri Render'daki ortam değişkenlerinden (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `VIEWER_USERNAME`, `VIEWER_PASSWORD`) istediğiniz zaman değiştirebilirsiniz.

## Hesap Yönetimi

`/admin/hesaplar` sayfasından (yalnızca viewer girişiyle) tüm kayıtlı hesaplar listelenir:
- Profil fotoğrafı, kullanıcı adı, hitap, kayıt tarihi ve kayıt IP'si görünür.
- **Askıya Al / Askıyı Kaldır** — askıya alınan hesap giriş yapamaz; aktif bir oturumu varsa anında sonlandırılır.
- **Yeniden Adlandır** — kullanıcı adı, o hesaba ait TÜM veriler (profil, oylar, yorumlar, ziyaretler, aktivite geçmişi, öneriler, geri bildirimler, CGF Pro+ başvuruları) korunarak değiştirilir.

## Profil

`/profil` sayfasından (hesabıyla giriş yapan herkes) şunlar düzenlenebilir: hitap, profil fotoğrafı, açıklama, profil rengi (Pro+ ile 2. renk/gradyan), Discord ismi. Kurtarma kodu yenileme ve çıkış yap da bu sayfadan yapılır. Herkesin profili `/kullanici/:kullaniciadi` adresinden başkaları tarafından görüntülenebilir (rozetler dahil).

## Ziyaretçi Kaydı ve "Mühendislik Harikası" Özellikler

`/admin/ziyaretciler` sayfası (yalnızca `admin` / `cokgizlisifre159753` girişiyle) her kullanıcı için şunları listeler:
- **Profil fotoğrafı, kullanıcı adı, hitap, rozetleri ve Discord ismi**
- **Son giriş zamanı** ve **aktif gün sayısı** (öneri hakkı için)
- Bugünün fotoğrafına **beğendi mi / beğenmedi mi** ve **yazdığı yorum** (varsa)
- Profilindeki **açıklama** (varsa)
- Öneri sisteminden **yasaklı olup olmadığı** ve yasaklama/kaldırma kontrolleri

Ayrıca üç ekstra özellik bulunur:
1. **Canlı "şu an sitede" göstergesi** — son 90 saniye içinde heartbeat göndermiş kullanıcıların avatarında yeşil, nabız gibi atan bir nokta belirir.
2. **Arama / filtre / sıralama çubuğu** — isim, hitap ya da Discord'a göre anlık arama; yalnızca çevrimiçi ya da yalnızca yasaklı olanları filtreleme; son girişe/aktif güne/isme göre sıralama — sayfa yenilenmeden, tamamen istemci tarafında çalışır.
3. **Şüpheli çoklu hesap tespiti** — bir hesap, kayıt IP'sini paylaştığı başka hesaplar varsa bunu otomatik olarak bir uyarı satırıyla gösterir.

## Render'a Deploy Etme

### Yöntem 1 — Blueprint ile (önerilen, tek tık)

1. Bu projeyi bir GitHub deposuna yükleyin (repo kökünde `render.yaml` bulunmalı — zaten var).
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → GitHub deponuzu seçin.
3. Render, `render.yaml` dosyasını okuyup gerekli servisi ve **kalıcı diski** (`/var/data`) otomatik oluşturur.
4. Kurulum sırasında sizden istenecek ortam değişkenlerini girin (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `VIEWER_USERNAME`, `VIEWER_PASSWORD` — yukarıdaki tabloyu kullanabilir ya da kendi değerlerinizi girebilirsiniz).
5. **Apply** deyip deploy'un bitmesini bekleyin. Render size `https://<servis-adiniz>.onrender.com` şeklinde bir adres verecek.

### Yöntem 2 — Manuel Web Service

1. Render Dashboard → **New** → **Web Service** → GitHub deponuzu bağlayın.
2. Ayarlar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
3. **Environment Variables** ekleyin:
   ```
   NODE_ENV=production
   ADMIN_USERNAME=croshy
   ADMIN_PASSWORD=croshyevrenseldir9467
   VIEWER_USERNAME=admin
   VIEWER_PASSWORD=cokgizlisifre159753
   SESSION_SECRET=rastgele-ve-uzun-bir-metin
   DATA_DIR=/var/data
   UPLOAD_DIR=/var/data/uploads
   ```
4. **Disks** sekmesinden bir kalıcı disk ekleyin: Mount Path `/var/data`, boyut en az 1 GB.
   > Bu adım önemlidir: Render'da disk eklenmezse, her yeniden başlatmada (deploy, uyku modundan uyanma vb.) yüklediğiniz fotoğraflar, ziyaretçi kaydı ve veriler silinir.
5. **Create Web Service** ile deploy edin.

Deploy tamamlandığında:
- Herkese açık sayfa: `https://<servis-adiniz>.onrender.com/`
- Admin girişi: `https://<servis-adiniz>.onrender.com/admin/login`

## Modern dokunuşlar

- **Renk çerçevesi ve ışıltı:** Fotoğraf eklerken seçtiğiniz renk, fotoğrafın kenarında bir çerçeve ve arkasında yumuşak bir ışıltı (glow) olarak beliriyor. Admin panelindeki fotoğraf listelerinde de aynı renk küçük resimlerin kenarında görünüyor.
- **"Gün #N" rozeti:** Fotoğrafın üzerinde, sitenin başından beri kaçıncı gün olduğunu gösteren bir rozet var.
- **Canlı geri sayım:** Başlığın altında bir sonraki fotoğrafa kalan süre saniye saniye akıyor.
- **Paylaş butonu:** Fotoğrafın sağ üstündeki ikonla, telefonlarda yerleşik paylaşım menüsü açılıyor; masaüstünde bağlantı otomatik panoya kopyalanıyor.
- **Sosyal paylaşım kartı:** Site bir yere (Discord, Twitter/X, WhatsApp vb.) paylaşıldığında, günün fotoğrafı ve ismi otomatik olarak önizleme kartında görünüyor (Open Graph meta etiketleri).
- **Favicon:** Sekme başlığında sitenin küçük bir ikonu var.

## Fotoğraf ekleme

Admin panelinde (`croshy` girişiyle) her fotoğraf için:
- **İsim** (zorunlu)
- **Renk** (zorunlu — renk seçiciyle veya `#e3a23c` gibi bir kod / "amber" gibi bir isim olarak girilebilir)
- **Açıklama** (opsiyonel)
- **Fotoğraf dosyası** (jpg, jpeg, png, webp, gif — maksimum 15MB)

girilir ve "Sıraya Ekle" ile kaydedilir.

## Temalar

Sitede 3 tema bulunur ve sol üstteki anahtardan değiştirilir:
- **Açık** — sıcak, krem tonlu modern bir görünüm
- **Koyu** — varsayılan koyu tema
- **Neon** — parlak neon vurgular ve hafif tarama-çizgisi efektiyle

Seçim tarayıcının `localStorage`'ında saklanır, bu yüzden her ziyaretçi kendi tercihini görür.

## Sosyal medya linklerini değiştirmek

Sağ üstteki YouTube / Kick / Twitch linkleri `views/partials/topbar.ejs` dosyasında tanımlıdır. Adresleri değiştirmek için ilgili `href` değerlerini güncelleyip yeniden deploy etmeniz yeterli.

## Yazı tipi

Başlıklarda **Bricolage Grotesque**, gövde metinlerinde **Inter**, tarih/etiket gibi ince detaylarda **JetBrains Mono** kullanılır — modern ve okunaklı bir kombinasyon.

## Veri ve dosyaların saklanması

- Fotoğraf bilgileri `photos.json`, ziyaretçi kaydı `visits.json`, beğeni/beğenmemeler `votes.json`, yorumlar `comments.json`, profiller (rozetler dahil) `profiles.json`, hesaplar (yalnızca şifre/kurtarma kodu hash'iyle) `accounts.json`, günlük aktivite `activity.json`, fotoğraf önerileri `suggestions.json`, geri bildirimler `feedback.json` dosyalarında saklanır — hepsi `DATA_DIR` altında (varsayılan: proje içindeki `data/` klasörü, Render'da `/var/data`).
- Oturumlar (giriş bilgisi) `DATA_DIR/sessions` klasöründe dosya olarak saklanır — bu, "hesabı 30 yıl hatırla" özelliğinin sunucu yeniden başlasa (deploy, uyku modundan uyanma vb.) bile çalışması için gereklidir. Bu klasör de mutlaka kalıcı diskte olmalıdır.
- Yüklenen profil fotoğrafları `UPLOAD_DIR/avatars`, fotoğraf önerileri `UPLOAD_DIR/suggestions` klasöründe tutulur. Varsayılan profil fotoğrafı (`public/img/default-avatar.png`) projeyle birlikte gelir ve her zaman erişilebilir olması için `UPLOAD_DIR`'den bağımsız, sabit bir dosya olarak servis edilir.
- Yüklenen görseller `UPLOAD_DIR` klasöründe tutulur (varsayılan: `public/uploads/`, Render'da `/var/data/uploads`).
- Render'da bu klasörlerin mutlaka kalıcı bir disk üzerinde olduğundan emin olun (yukarıdaki deploy adımlarına bakın).

## Yerel geliştirme (opsiyonel)

Siteyi Render'a almadan önce kendi bilgisayarınızda test etmek isterseniz:

```bash
npm install
cp .env.example .env
npm start
```

Sonra `http://localhost:3000` adresinden erişebilirsiniz. Bu tamamen opsiyoneldir — asıl kullanım Render üzerinden olacak şekilde tasarlanmıştır.

## Teknik yapı

- **Backend:** Node.js + Express
- **Şablonlar:** EJS
- **Dosya yükleme:** Multer
- **Şifreleme:** bcryptjs (12 salt round) — şifreler ve kurtarma kodları yalnızca hash olarak saklanır
- **E-posta:** nodemailer (opsiyonel, herhangi bir ücretsiz SMTP sağlayıcısıyla çalışır — Gmail dahil)
- **Güvenlik başlıkları:** Helmet (CSP, HSTS, X-Frame-Options vb.)
- **Hız sınırlama:** express-rate-limit (giriş/kayıt/kurtarma, API, dosya yükleme uçları için ayrı ayrı)
- **Oturum/giriş:** express-session + session-file-store (diske yazılan kalıcı oturumlar, 30 yıl; oturum sabitleme korumalı) — kullanıcı hesapları (kullanıcı adı/şifre) ve iki ayrı rollü admin girişi (`admin` / `viewer`)
- **Veri saklama:** JSON dosyaları (harici veritabanı gerekmez)
- **Tema sistemi:** CSS değişkenleri + `localStorage`, sunucu tarafı gerektirmez
