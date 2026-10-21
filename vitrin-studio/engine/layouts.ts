// Yerleşim kütüphanesi — 20 hazır kompozisyon.
// Tüm koordinatlar oransal (0..1) ve 1320×2868 dikey slayt tabanına göre kurgulandı.
//   text.x / text.w  → metin bloğunun sol kenarı ve genişliği (ortalı bloklarda x = (1 - w) / 2)
//   text.y           → metin bloğunun ÜST hizası (rozet varsa rozet buradan başlar)
//   device.cx / cy   → cihazın MERKEZİ
//   device.scale     → cihaz yüksekliği / slayt yüksekliği (1'e yaklaştıkça kadraja sığmaz, taşar)
//   device.rotation  → radyan (saat yönü tersi negatif)
//   textZ            → çakışmada metin cihazın üstünde mi ("above" varsayılan)

import { isDuoFormat, type Format, type LayoutId, type LayoutSpec } from "./types";

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  // Başlık üstte nefes alan bir bantta, cihaz alt-orta. En güvenli okunabilirlik.
  "text-top": {
    id: "text-top",
    text: { x: 0.08, y: 0.055, w: 0.84, align: "center" },
    device: { cx: 0.5, cy: 0.63, scale: 0.66 },
    textZ: "above",
  },

  // Ters kurgu: cihaz üst-ortada, başlık alt üçte birde. Uzun alt yazılar için ideal.
  "text-bottom": {
    id: "text-bottom",
    text: { x: 0.08, y: 0.8, w: 0.84, align: "center" },
    device: { cx: 0.5, cy: 0.4, scale: 0.6 },
    textZ: "above",
  },

  // Klasik hero: cihaz alt kenardan taşar, üstte dev başlık. Set'in ilk karesi için.
  "device-bleed-bottom": {
    id: "device-bleed-bottom",
    text: { x: 0.08, y: 0.06, w: 0.84, align: "center" },
    device: { cx: 0.5, cy: 0.72, scale: 0.78 },
    textZ: "above",
  },

  // Hero'nun aynası: cihaz üst kenardan taşar, metin altta oturur.
  "device-bleed-top": {
    id: "device-bleed-top",
    text: { x: 0.08, y: 0.78, w: 0.84, align: "center" },
    device: { cx: 0.5, cy: 0.3, scale: 0.78 },
    textZ: "above",
  },

  // Metin cihazın üstüne biner — ekran neredeyse tam kadraj, başlık alt yarıda.
  "text-overlay": {
    id: "text-overlay",
    text: { x: 0.09, y: 0.68, w: 0.82, align: "center" },
    device: { cx: 0.5, cy: 0.46, scale: 0.88 },
    textZ: "above",
  },

  // Rozet + başlık üstte bir kule halinde, cihaz merkezde daha küçük ve havada durur.
  "badge-hero": {
    id: "badge-hero",
    text: { x: 0.1, y: 0.075, w: 0.8, align: "center" },
    device: { cx: 0.5, cy: 0.6, scale: 0.55 },
    textZ: "above",
  },

  // Diyagonal bölme: metin sol üstte sola hizalı, cihaz sağa kayık ve hafif eğik.
  "split-diagonal": {
    id: "split-diagonal",
    text: { x: 0.07, y: 0.06, w: 0.6, align: "left" },
    device: { cx: 0.6, cy: 0.58, scale: 0.66, rotation: -0.1 },
    textZ: "above",
  },

  // ---------------------------------------------------------------------------
  // SPLIT AİLESİ — iki özelliği tek karede göstermek için (screenshot + screenshot2).
  // Cihaz değil, iki bağımsız kırpılmış görsel alanı. Eksik ekran yer tutucu gösterir.
  // ---------------------------------------------------------------------------

  // Cropped columns. Visible frame geometry lives in splitScreens.ts;
  // device/device2 remain slot metadata for backwards-compatible projects.
  "split-v": {
    id: "split-v",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.26, cy: 0.61, scale: 0.42 },
    device2: { cx: 0.74, cy: 0.61, scale: 0.42 },
    splitPanels: "columns",
    textZ: "above",
  },

  // Two broad image crops stacked below the heading; no phone silhouettes.
  "split-h": {
    id: "split-h",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.72, cy: 0.265, scale: 0.43 },
    device2: { cx: 0.72, cy: 0.735, scale: 0.43 },
    splitPanels: "rows",
    textZ: "above",
  },

  // ---------------------------------------------------------------------------
  // R10/E — ÇOKLU CİHAZ 3D AİLESİ
  //
  // Bu düzenler split-v/split-h'ten iki noktada ayrılır:
  //   1. Cihazlar ÜST ÜSTE BİNER. Artık mümkün: motor N telefonu tek 3D
  //      sahnede kuruyor ve kutu SIRASI derinlik sırası oluyor — 0. kutu
  //      (`device`) EN ÖNDE, sonrakiler birer kademe geride
  //      (scene3dCore.DEPTH_STEP). Bu yüzden her düzende ÖNDE durması gereken
  //      telefon `device`'tır; okuma sırası değil, DERİNLİK sırası belirler.
  //   2. Cihaz eni = scale × 2868 × 0.4603 ≈ scale × 1320, yani scale doğrudan
  //      "slayt genişliğinin kaçta kaçı" demek. Aşağıdaki bütçeler bunu kullanır.
  // ---------------------------------------------------------------------------

  // İki telefon üst üste binen tek bir öbek, hafif dutch.
  //
  // Bindirme oranı %30 (back telefonun eni 0.475 → 0.1425 ≈ 188px kesişim):
  //   %50'nin üstünde arkadaki ekranın içeriği okunmaz hâle geliyor, %15'in
  //   altında iki ayrı telefon gibi duruyor. %30 "aynı uygulamanın iki yüzü"
  //   okumasını veren aralık.
  // Ön telefon SAĞDA ve BÜYÜK (0.52 / 0.475): Latin okuma yönünde göz soldan
  //   gelip önde biten yüzde durur — kahraman ekran son bakılan olur.
  // Dönme İKİSİNDE DE aynı yönde (+0.045 ≈ 2.6°, saat yönü): bindirme çizgisi
  //   paralel kalır. Karşıt yön denendi, kesişim makas gibi açılıp iki telefon
  //   birbirine "çarpıyor" gibi duruyor.
  "duo-overlap": {
    id: "duo-overlap",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.655, cy: 0.6, scale: 0.52, rotation: 0.045 },
    device2: { cx: 0.3, cy: 0.535, scale: 0.475, rotation: 0.045 },
    textZ: "above",
  },

  // Derinlik kademeli ikili: öndeki keskin ve büyük, arkadaki küçük ve — cihaz
  // stilinde `dof` açıksa — erimiş.
  //
  // Ölçek farkı 0.60 / 0.40 (3:2) BİLİNÇLİ olarak büyük: motor iki telefonu
  //   ayrıca 0.6 birim derinlikte ayırıyor ama perspektif telafisi ekran
  //   boyutunu SABİT tutuyor (kadraj bozulmasın diye), yani "uzakta" hissi
  //   yalnız ölçek + DoF'tan geliyor. Küçük fark (ör. 0.55/0.48) iki farklı
  //   boy telefon gibi okunuyor, derinlik gibi değil.
  // Arkadaki SOL KENARDAN ~13px taşar: kadrajı kesen nesne otomatik olarak
  //   "sahnenin devamı var" der; ortada duran küçük telefon ise sadece küçüktür.
  // Metin SOLA hizalı: kompozisyon zaten asimetrik, ortalı blok onu yalanlar.
  "duo-depth": {
    id: "duo-depth",
    text: { x: 0.07, y: 0.06, w: 0.72, align: "left" },
    device: { cx: 0.545, cy: 0.615, scale: 0.6, rotation: -0.02 },
    device2: { cx: 0.19, cy: 0.475, scale: 0.4, rotation: -0.06 },
    textZ: "above",
  },

  // Üçlü yay: ana ekran MERKEZDE ve en önde, iki yardımcı omuz gibi yanlarda.
  //
  // `device` = merkez (kahraman) — derinlik sırası kutu sırasıdır, ortadaki
  //   öne çıksın diye ilk sırada. `device2` sol, `device3` sağ omuz.
  // Ölçek 0.46 / 0.40: merkez %15 büyük. Eşit ölçekte üçlü "sekme çubuğu" gibi
  //   düzleşiyor; %30 fark merkezi yalnızlaştırıyor.
  // Omuzlar cx 0.10 / 0.90 → dış kenarlardan ~132px TAŞAR. Yay bir kesittir:
  //   taşma olmadan üç telefon 1320px'e ancak 0.30 ölçekle sığar ve ekranlar
  //   okunmaz olur. Kesişim omuz başına ~40px — yay tek bir öbek gibi okunur.
  // Dönme SİMETRİK ve DIŞA (∓0.055 ≈ 3.2°). split-v'de karşıt yön yasaklıydı
  //   çünkü orada iki telefon arasında AÇIK bir oluk var ve kama şeklinde
  //   açılıyordu; burada kesişim o oluğu kapatıyor, simetri yayı kuruyor.
  "trio-arc": {
    id: "trio-arc",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.5, cy: 0.605, scale: 0.46 },
    device2: { cx: 0.1, cy: 0.65, scale: 0.4, rotation: -0.055 },
    device3: { cx: 0.9, cy: 0.65, scale: 0.4, rotation: 0.055 },
    textZ: "above",
  },

  // Üçlü kademe: sol-alttan sağ-üste çekilen bir merdiven, metin altta.
  //
  // Her basamak bir öncekinin %87'si (0.44 → 0.385 → 0.335) ve ~%22 üstüne
  //   biner. %30+ denendi: ikinci ve üçüncü ekranda içerik kalmıyor, merdiven
  //   "üç telefon" değil "bir telefon ve iki kenar" gibi okunuyor.
  //   Sabit oran perspektifin kendi geometrisidir (eşit aralıklı
  //   nesneler eşit ORANDA küçülür); doğrusal küçültme merdiveni "eziyor".
  // Yön sol-alt → sağ-üst: alttaki metin bloğu ağırlığı aşağı çekiyor,
  //   merdiven onu dengelemek için yukarı tırmanıyor. Ters yön (sağ-alttan
  //   sol-üste) denendi — metnin sol hizası merdivenin ucuyla çakışıyor.
  // Üçüncü basamak sağdan ~109px taşar: merdivenin bittiği yer değil,
  //   kadrajın bittiği yer olsun diye.
  // Dönme ÜÇÜNDE DE -0.035: paralel kenarlar basamakları tek bir hareket
  //   yapar (split-v'deki aynı-yön kuralı).
  "trio-stack": {
    id: "trio-stack",
    text: { x: 0.08, y: 0.795, w: 0.84, align: "center" },
    device: { cx: 0.27, cy: 0.52, scale: 0.44, rotation: -0.035 },
    device2: { cx: 0.598, cy: 0.415, scale: 0.385, rotation: -0.035 },
    device3: { cx: 0.884, cy: 0.325, scale: 0.335, rotation: -0.035 },
    textZ: "above",
  },

  // ---------------------------------------------------------------------------
  // R11 — İKİLİ KOMPOZİSYON GENİŞLEMESİ
  //
  // split-v/split-h ikiliyi hep "iki eşit telefon, düz duruş" diye kuruyordu;
  // duo-overlap/duo-depth ise tek bir öbek. Aşağıdaki altı düzen ikilinin kalan
  // eksenlerini açar: KARŞIT eğim, HİYERARŞİ (kahraman + destek), DİKEY
  // kaydırma, ÇİFT TARAFLI taşma, EDİTÖRYEL kolon ve İNSET.
  //
  // Ortak aritmetik (aşağıdaki bütçelerin hepsi bunu kullanır):
  //   cihaz eni  = scale × 2868 × 0.4603 ≈ scale × 1320  (scale = slayt eninin oranı)
  //   cihaz boyu = scale × 2868
  //   θ radyan eğik kutunun eksen-hizalı kapladığı en = en·cosθ + boy·sinθ
  //
  // İKİ SAPMA — sayılar render üstünde doğrulandı, bunlar orada görüldü:
  //   1. 3D modelin GERÇEK eni bu formülden ~%5 fazla (çerçeve kalınlığı).
  //      Yani hesaplanan kenar boşlukları biraz iyimser; nihai değerler
  //      basılmış PNG'de ölçülüp düzeltildi.
  //   2. Derinlik kademesi (scene3dCore.DEPTH_STEP) ARKADAKİ telefonu bir tık
  //      küçültüp kaçış noktasına doğru kaydırır. Eşit `scale` verilse bile iki
  //      telefon kadrajda tıpatıp aynı boyda çıkmaz — trio-arc'ın omuzlarında
  //      da olan şey. Simetri iddiası bu yüzden POZDA'dır, pikselde değil.
  // ---------------------------------------------------------------------------

  // Karşıt eğimli ikili — yukarı doğru açılan bir yelpaze.
  //
  // split-v'nin yasağı ("karşıt yön kama açar") KESİŞİM YOKKEN geçerlidir;
  //   trio-arc bunu zaten kanıtladı: omuzlar birbirine binince simetrik dışa
  //   eğim yayı kuruyor. Burada da koşul sağlanıyor — telefonlar HER
  //   YÜKSEKLİKTE üst üste biniyor, açılan bir oluk hiç oluşmuyor.
  // Genişlik: scale 0.49 → 647px en, 1405px boy. Merkezler 0.305/0.695
  //   (aralık 0.39 × 1320 = 515px) → taban bindirme 647 − 515 = 132px (%20).
  // Eğim ∓0.045 rad (2.6°) uçları 2 × (1405/2) × sin2.6° ≈ 63px yaklaştırır:
  //   üstte bindirme 132 − 63 = 69px (%11), altta 132 + 63 = 195px (%30).
  //   Alt uç duo-overlap'in kanıtlanmış %15–50 bandında; üst uç bilinçli dar,
  //   iki ekranın TEPESİ (uygulama başlığı, sekme adı) açıkta kalsın diye.
  // Kenar boşluğu: eksen-hizalı yarı-en = (647·cos2.6° + 1405·sin2.6°)/2 ≈ 355
  //   → uçlar 47px içeride. Eğimi büyütmek (∓0.06) denendi: yarı-en 380'e
  //   çıkıyor, kenar boşluğu 23px'e düşüyor ve yelpaze kadrajı zorluyor.
  // Dikey: eğik kutunun boyu 1405·cos2.6° + 647·sin2.6° ≈ 1434px. cy 0.578 →
  //   941…2375px; metin bloğu ~460'ta bitiyor → üstte 481px, altta 493px nefes.
  //   Simetrik kompozisyon ortalı metni hak ediyor, blok ortalı bırakıldı.
  "duo-dutch": {
    id: "duo-dutch",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.695, cy: 0.578, scale: 0.49, rotation: 0.045 },
    device2: { cx: 0.305, cy: 0.578, scale: 0.49, rotation: -0.045 },
    textZ: "above",
  },

  // Kahraman + destek: bir ekran açıkça ana konu, ikincisi yardımcı.
  //
  // Ölçek oranı 0.60 / 0.32 ≈ 1.9. duo-depth'in 3:2'si DERİNLİK okutuyor (ikisi
  //   de aynı boy telefon, biri uzakta); buradaki 1.9 ise HİYERARŞİ: fark o
  //   kadar büyük ki göz "uzaktaki aynı telefon" diye okuyamıyor, "ana ekran +
  //   küçük detay" diye okuyor.
  // Genişlik: kahraman 792px (cx 0.375 → 495, 99…891), destek 422px
  //   (cx 0.775 → 1023, 812…1234). Bindirme 79px = desteğin %19'u.
  //   duo-overlap'in notu: %15'in altı "iki ayrı telefon" gibi duruyor — bu
  //   yüzden bilerek %15'in hemen üstünde tutuldu, ikisi tek öbek okunsun.
  //   Kenar boşlukları 99 / 86px; öbek yatayda dengeli oturuyor.
  // Dikey: ikisi de AYNI ZEMİN ÇİZGİSİNDE bitmeli. Kahraman alt kenarı
  //   0.60 × 2868 × 1.5 = 2581px; desteğin geometrik merkezi
  //   (2581 − 918/2) / 2868 = 0.740 çıkıyor. Ama eğim + derinlik kademesi
  //   desteği ~50px aşağı sarkıtıyor (basılmış karede ölçüldü), bu yüzden
  //   0.723'e çekildi. Ortak taban çizgisi iki farklı boydaki nesneyi tek bir
  //   rafa oturtur; ortalanmış olsalardı destek "havada" kalırdı.
  // Eğim ikisinde de −0.025: split-v'nin aynı-yön kuralı, paralel kenarlar.
  "duo-hero-aside": {
    id: "duo-hero-aside",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.375, cy: 0.6, scale: 0.6, rotation: -0.025 },
    device2: { cx: 0.775, cy: 0.723, scale: 0.32, rotation: -0.025 },
    textZ: "above",
  },

  // Biri yüksek biri alçak ikili; metin ÜSTTE DEĞİL, sol kolonda.
  //
  // Metin kolonu 0.05…0.49 (66…647px, 581px en). Kolon seçilmesinin sebebi
  //   dikey kaydırmanın kendisi — telefonlar tepeden dibe yayıldığı için üstte
  //   ortalı bir metin bandı kalmıyor, ısrar edilse üstteki telefonu aşağı
  //   itmek gerekirdi.
  // KOLON GENİŞLİĞİ SATIRLA DEĞİL, KELİMEYLE SINIRLI. 130px'lik başlıkta
  //   581px ≈ 9 karakter; wrapLines kelimenin İÇİNDE bölmediği için 10+ harfli
  //   tek bir kelime kolondan taşar ve 66px'lik oluğu yiyip telefona değer
  //   ("akıllı hatırlatma" ile görüldü, kolon 488px'ken). 488 → 581'e bu yüzden
  //   genişletildi; yine de bu düzen KISA kelimeli başlık ister (panorama-mid
  //   gibi), 12+ harfli bir kelime hâlâ taşar.
  // Yatay bütçe (scale 0.34 → 449px en, 975px boy): kolondan sonra
  //   647…1320 = 673px kalıyor, iki telefon 2 × 449 = 898px istiyor. Açık 225px
  //   + istenen ~120px sağ taşma, şöyle karşılandı:
  //     ön (alt) telefon  cx 0.71 → 937 → 713…1162; kolona 66px oluk (split-v'nin
  //       61px'iyle aynı dil — dıştan dar oluk ikiliyi metinden ayırır),
  //     arka (üst) telefon cx 0.92 → 1214 → 991…1440 → sağdan 120px (%27) taşar,
  //     bindirme 1162 − 991 = 171px (%38).
  //   Bindirme duo-overlap'in %15–50 bandında; taşma trio-stack'teki gerekçeyle
  //   (kadrajı kesen nesne "devamı var" der) ve kesilen ARKA/ikincil ekran.
  // Dikey kaydırma: cy 0.645 / 0.355 → merkezler 832px ayrı, telefon boyu
  //   975px, yani hâlâ 143px ortak bant var. Kaydırma boydan büyük olsaydı iki
  //   telefon hiçbir yüksekliği paylaşmaz, tek öbek okuması dağılırdı.
  //   Üst boşluk 530px, alt boşluk 531px — dizi kadrajda ortalanıyor.
  // Eğim ikisinde de −0.035 (aynı yön): kaydırma zaten diyagonal bir hareket,
  //   karşıt eğim onu iki ayrı yöne çekerdi.
  "duo-stagger": {
    id: "duo-stagger",
    text: { x: 0.05, y: 0.4, w: 0.44, align: "left" },
    device: { cx: 0.71, cy: 0.645, scale: 0.34, rotation: -0.035 },
    device2: { cx: 0.92, cy: 0.355, scale: 0.34, rotation: -0.035 },
    textZ: "above",
  },

  // İki BÜYÜK telefon karşıt kenarlardan taşar, aralarında dar bir oluk.
  //
  // split-h'te taşma yasaklıydı çünkü orada kesilen yer ekranın ÜSTÜ (özelliği
  //   tanıtan başlık) oluyordu. Burada kesilen yer ekranın DIŞ YAN kenarı —
  //   arayüzün kenar boşluğu — yani içerik kaybı yok, kazanç ise ölçek:
  //   telefonlar split-v'nin %42 sınırının çok üstünde, 0.56 (739px) enle çıkar.
  // Yatay bütçe: 2 × 739 = 1478px + 78px oluk = 1556px; kadraj 1320px, açık
  //   236px → iki kenara 118'er px taşma. Merkezler 0.19 (251 → −119…621) ve
  //   0.81 (1069 → 699…1439). Oluk 78px, split-v'nin 61px'iyle aynı ölçekte:
  //   dıştan (taşmadan) DAR olduğu için ikili hâlâ tek öbek okunuyor.
  // Dikey kaydırma 0.585 / 0.630 (129px): tamamen simetrik kadraj duvar kâğıdı
  //   gibi düzleşiyordu; küçük kayma okuma sırası veriyor (önce sol, sonra sağ).
  //   Alt kenarlar 2481 ve 2610px → alt boşluk 258px, taşma dikeye sıçramıyor.
  // Eğim ikisinde de −0.03: paralel kenarlar oluğu her yükseklikte sabit tutar.
  "duo-bleed-sides": {
    id: "duo-bleed-sides",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.19, cy: 0.585, scale: 0.56, rotation: -0.03 },
    device2: { cx: 0.81, cy: 0.63, scale: 0.56, rotation: -0.03 },
    textZ: "above",
  },

  // Editöryel bölme: solda metin kolonu, sağda iki küçük ekran alt alta.
  //
  // duo-stagger'ın SAKİN karşıtı — aynı sol kolon dili iki tempoda kullanılsın
  //   diye: orada telefonlar büyük, kaydırmalı ve taşıyor; burada ikisi de
  //   KADRAJ İÇİNDE ve neredeyse dikey bir sütun.
  // Yatay (scale 0.335 → 442px en, 961px boy): kolon 73…627px (0.055 + 0.42).
  //   cx 0.718 → 948 → 727…1169, cx 0.772 → 1019 → 798…1240. Kolona 100px oluk
  //   (kolon duo-stagger'daki kelime-taşması gerekçesiyle 0.40'tan genişletildi:
  //   10 harfli bir kelime 73…723px'e uzanıyor, oluğun içinde kalıyor),
  //   sağ kenar boşluğu 80px. Aradaki 71px'lik yatay kayma sütunu tam dikey
  //   olmaktan kurtarıp metnin sola hizalı diyagonaline eşlik ettiriyor.
  // Dikey: cy 0.295 → 366…1326, cy 0.71 → 1556…2517. Üst 366, ara 230, alt
  //   351px — ARA boşluk dış boşluklardan küçük, yani yakınlık ilkesi
  //   (split-v'nin oluk gerekçesinin dikey hâli): iki kare tek sütun okunuyor.
  // `device` ÜSTTEKİ: bindirme yok, derinlik sırası kadrajda görünmüyor, o
  //   yüzden kutu sırası burada okuma sırası olarak kullanıldı — 1. ekran üstte.
  // Metin y 0.375: sütunun görsel merkezi (366 + 2517)/2 ≈ 1441px; üç satırlık
  //   bir başlık 1075px'ten (0.375) başlayınca tam oraya oturuyor.
  "duo-editorial": {
    id: "duo-editorial",
    text: { x: 0.055, y: 0.375, w: 0.42, align: "left" },
    device: { cx: 0.718, cy: 0.295, scale: 0.335, rotation: -0.03 },
    device2: { cx: 0.772, cy: 0.71, scale: 0.335, rotation: -0.03 },
    textZ: "above",
  },

  // Resim içinde resim: büyük kahraman ekran + köşesine binen küçük inset.
  //
  // DİKKAT — SLOT SIRASI TERS. Derinlik sırası kutu sırasıdır (bkz. R10/E
  //   başlığı) ve inset ÖNDE durmak zorunda; dolayısıyla `device` = İNSET,
  //   `device2` = KAHRAMAN. Yani 1. ekran görüntüsü küçük karede, 2. ekran
  //   görüntüsü büyük karede çıkar — bu düzene detay/yakın plan karesini
  //   1. slota koyun. (Kutu sırasını çevirmek insetin arkaya düşmesi demek.)
  // Kahraman: scale 0.66 → 871 × 1893px; cx 0.42 → 554 (119…990),
  //   cy 0.575 → 702…2595. Metin bloğu ~500px'te bitiyor, tepesine 200px nefes.
  // İnset: scale 0.30 → 396 × 860px; cx 0.735 → 970 (772…1168),
  //   cy 0.735 → 1678…2538. Kahramanın SAĞ KENARINI ATLAR: eninin 218px'i
  //   (kendi eninin %55'i, kahramanınkinin %25'i) üstüne biner, kalan 178px
  //   dışarı taşar; sağda 152px kenar boşluğu kalır.
  //   Tamamen içeri almak denenebilirdi ama o zaman inset kahramanın KENDİ
  //   ekranını örtüyor — gösterilecek arayüzü kapatmak PiP'in amacına ters.
  //   Yarısı üstte yarısı dışarıda duran kare "üste yapıştırılmış kart" okunur.
  // Eğim KARŞIT ve küçük (kahraman −0.02, inset +0.045). duo-dutch'ta karşıt
  //   eğim simetri kuruyordu; burada tam tersi iş görüyor — açı farkı iki
  //   yüzeyi AYIRIYOR, inset ayrı bir katman gibi duruyor. Aynı yön verildiğinde
  //   inset kahramanın parçası, "ekranın içindeki bir pencere" gibi görünüyor.
  "duo-pip": {
    id: "duo-pip",
    text: { x: 0.07, y: 0.055, w: 0.86, align: "center" },
    device: { cx: 0.735, cy: 0.735, scale: 0.3, rotation: 0.045 },
    device2: { cx: 0.42, cy: 0.575, scale: 0.66, rotation: -0.02 },
    textZ: "above",
  },

  // Panorama serisinin orta karesi: cihaz tam merkezde, üstte kısa tek satır metin.
  // ---------------------------------------------------------------------------
  // R12 — TELEFONSUZ KOMPOZİSYONLAR. Cihaz stili `frame:"none"` ile çıplak
  // ekran basılır; bu iki düzen o çıplak ekranı telefon gövdesi yokmuş gibi
  // BÜYÜK kullanır. Gövde payı (bezel + ray) olmadığı için split-v'nin %42
  // tavanı burada geçerli değil: iki ekran %44'er ile 1162px + 40px oluk.
  // Tema, kartı/ayracı `Theme.elements` ile getirir (bkz. themes.ts "diptik").
  // ---------------------------------------------------------------------------

  // İki çıplak ekran yan yana, ALTTA metin bandı. Ekranlar üst üçte ikiyi
  // doldurur (cy 0.42 → üst kenar 0.42−0.22=0.20, alt 0.64); metin 0.70'te
  // başlar, iki satır başlık + alt satır 0.70–0.92'ye sığar.
  //   ekran eni = 0.44 × 2868 × 0.4603 = 581px; merkezler 0.28/0.72 (aralık
  //   581px) → oluk 0 → merkezler 0.265/0.735'e açıldı: aralık 620px, oluk 39px,
  //   kenar boşlukları 59px. Oluk < kenar: ikili tek kart gibi okunur.
  diptych: {
    id: "diptych",
    // İlk denemede cy 0.42 / text 0.70 üstü boş bırakıp altı sıkıştırıyordu
    // (üst 520px boş, alt 500). cy 0.40 + text 0.71: üst 578, alt ~500 — dengeli.
    text: { x: 0.08, y: 0.71, w: 0.84, align: "center" },
    device: { cx: 0.265, cy: 0.4, scale: 0.44 },
    device2: { cx: 0.735, cy: 0.4, scale: 0.44 },
    textZ: "above",
  },

  // Tek çıplak ekran, kart içinde ortalı, metin üstte. Ekran %62 (h 1778,
  // w 818) — kontur telefondan büyük çünkü çerçeve yok; kart temadan gelir.
  "screen-card": {
    id: "screen-card",
    text: { x: 0.08, y: 0.06, w: 0.84, align: "center" },
    device: { cx: 0.5, cy: 0.60, scale: 0.62 },
    textZ: "above",
  },

  // ---------------------------------------------------------------------------
  // R13 — TAMAMLAYAN KARELER. Mağazada kareler yan yana durur; bir telefonun
  // sağ yarısı N. karede, sol yarısı N+1'de görünürse ikisi tek sahne olur.
  // Zemin de aynı görselin komşu dilimleridir (Background.image.crop).
  //   cihaz eni 0.72 × 1320 = 950px; cx 0.86 → 1135 merkez, sol kenar 660,
  //   sağ kenar 1610 (kadraj 1320'de biter → %50 taşma). Metin SOLA yaslı,
  //   0.55 en: cihazın solundaki 660px'e sığar.
  // pano-right aynanın aynısı: cx 0.14, metin sağa yaslı.
  // ---------------------------------------------------------------------------
  "pano-left": {
    id: "pano-left",
    // Metin eni 0.42: 0.5'te blok 739'da bitip cihazın sol kenarına (660)
    // giriyordu; 0.42 → 634, 26px pay. Uzun kelime otomatik sığdırmayla küçülür.
    text: { x: 0.06, y: 0.08, w: 0.42, align: "left" },
    device: { cx: 0.86, cy: 0.56, scale: 0.72 },
    textZ: "above",
  },
  "pano-right": {
    id: "pano-right",
    text: { x: 0.52, y: 0.08, w: 0.42, align: "right" },
    device: { cx: 0.14, cy: 0.56, scale: 0.72 },
    textZ: "above",
  },

  // ---------------------------------------------------------------------------
  // R15 — YATAY iPAD düzenleri. Tuval 4:3, cihaz 4:3 (özdeşlik korunur:
  // cihaz eni/tuval eni = scale). Metin sütunu kenarda, cihaz büyük.
  //   wide-left: metin x 0.05..0.37 (en 0.32), cihaz cx 0.68, scale 0.74 →
  //   cihaz eni 0.74 × tuval eni → sol kenar 0.68−0.37 = 0.31. Sütun 0.37'de
  //   biter, 0.06 pay. Dikey: cihaz 0.13..0.87.
  // ---------------------------------------------------------------------------
  "wide-left": {
    id: "wide-left",
    text: { x: 0.05, y: 0.16, w: 0.32, align: "left" },
    device: { cx: 0.68, cy: 0.5, scale: 0.74 },
    textZ: "above",
  },
  "wide-right": {
    id: "wide-right",
    text: { x: 0.63, y: 0.16, w: 0.32, align: "right" },
    device: { cx: 0.32, cy: 0.5, scale: 0.74 },
    textZ: "above",
  },
  // wide-hero: başlık üstte tek satır, cihaz %92 ile alt kenardan taşar —
  // tam ekran arayüz gösterimi (yatay uygulamalar için klasik kare).
  "wide-hero": {
    id: "wide-hero",
    text: { x: 0.1, y: 0.05, w: 0.8, align: "center" },
    device: { cx: 0.5, cy: 0.72, scale: 0.92 },
    textZ: "above",
  },

  "panorama-mid": {
    id: "panorama-mid",
    text: { x: 0.05, y: 0.06, w: 0.9, align: "center" },
    device: { cx: 0.5, cy: 0.52, scale: 0.66 },
    textZ: "above",
  },
};

/** Resolve authored layout geometry before applying the user's offsets.
 * Tablet copy needs a taller header budget; wide columns need a narrower
 * device than the old 74% hero, which overlapped their text column. */
export function getLayoutForFormat(id: LayoutId, format: Format = "iphone"): LayoutSpec {
  const layout = LAYOUTS[id];
  if (format === "iphone") return layout;
  if (isDuoFormat(format)) {
    const landscape = format === "iphone-duo" || format.endsWith("landscape");
    if (id === "wide-left" || id === "wide-right") {
      const left = id === "wide-left";
      if (!landscape) return { ...layout, device2: undefined, device3: undefined, text: { x: .07, y: .07, w: .86, align: left ? "left" : "right" }, device: { cx: left ? .54 : .46, cy: .68, scale: .51 } };
      return { ...layout, device2: undefined, device3: undefined, text: { x: left ? .045 : .64, y: .2, w: .30, align: left ? "left" : "right" }, device: { cx: left ? .69 : .31, cy: .59, scale: landscape ? .51 : .42 } };
    }
    if (layout.splitPanels) return layout;
    if (layout.device2) return { ...layout, device: { ...layout.device, scale: Math.min(layout.device.scale, landscape ? .38 : .30) }, device2: { ...layout.device2, scale: Math.min(layout.device2.scale, landscape ? .38 : .30) }, device3: layout.device3 ? { ...layout.device3, scale: .28 } : undefined };
    const bottom = id === "text-bottom";
    if (id === "device-bleed-bottom" || id === "wide-hero") return { ...layout, text: { x: .07, y: .05, w: .86, align: "center" }, device: { cx: .5, cy: .77, scale: landscape ? .74 : .72 } };
    if (id === "device-bleed-top") return { ...layout, text: { x: .07, y: .75, w: .86, align: "center" }, device: { cx: .5, cy: .27, scale: landscape ? .75 : .72 } };
    if (id === "text-overlay") return { ...layout, text: { x: .07, y: .26, w: .86, align: "center" }, device: { cx: .53, cy: .6, scale: landscape ? .78 : .72 } };
    if (id.startsWith("pano") && id!=="panorama-mid") return { ...layout, device: { ...layout.device, scale: landscape ? .8 : .75 } };
    return { ...layout, text: { x: .07, y: bottom ? .77 : .055, w: .86, align: "center" }, device: { cx: .5, cy: bottom ? .38 : .66, scale: landscape ? .51 : .52 } };
  }
  if (layout.splitPanels) return { ...layout, text: { x: .055, y: .04, w: .89, align: "center" } };
  if (id === "wide-left" || id === "wide-right") {
    const left = id === "wide-left";
    return {
      ...layout,
      text: { x: left ? 0.055 : 0.64, y: 0.2, w: 0.305, align: left ? "left" : "right" },
      device: { cx: left ? 0.68 : 0.32, cy: 0.57, scale: 0.54 },
    };
  }
  if (id === "wide-hero") return {
    ...layout,
    text: { x: 0.08, y: 0.045, w: 0.84, align: "center" },
    device: { cx: 0.5, cy: 0.72, scale: 0.67 },
  };
  return layout;
}
