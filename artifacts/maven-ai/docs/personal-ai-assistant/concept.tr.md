# Cognirise Kişisel Ajan — konsept belgesi

> Çalışma adı: **Cognirise Kişisel Ajan**. Persona başına ajan kişilikleri: **Atlas** (Satış) ve **Ember** (İK).
>
> Bu belge, marketplace aracı girişi, iki demo (Cockpit ve Mind) ve altlarındaki seed verileri için sözleşmedir. Yukarıdan aşağıya yaklaşık 15 dakikada okunur.

---

## 1. Yönetici özeti ve üç öldürücü açı

Bugün kurumsal AI asistanlarının çoğu, kurumsal verilere bağlı akıllı sohbet botlarıdır. Araç değiştirdiğinizde söylediklerinizi unuturlar. İş değiştirdiğinizde sizi tamamen unuturlar. Kara kutuda akıl yürütürler. Ve işteki insanın evdeki insanla ilgisi yokmuş gibi davranırlar.

**Cognirise Kişisel Ajan**, bu dört varsayımı da reddeder. İşi ve kişiyi öğrenen, bu bilgiyi **çalışanın sahip olduğu ve işverenler arasında taşıyabildiği bir Kişisel Bağlam Grafiğinde (PCG)** depolayan ve **cam-kutu güven modeli** altında her karar için tek tıkla geri alma ile özerk hareket eden, her çalışan için her zaman açık bir AI ajanıdır. Tek bir ajan, bütün kişi için — teklif mektubunuzu yazıp aynı zamanda kızınızın resitalini hatırlayarak — iş kapsamı ile kişisel kapsam arasında katı bir gizlilik sınırıyla.

Üç öldürücü açı, her biri hâkim pazar duruşunun bilinçli bir tersine çevrilmesidir:

1. **Çalışana ait, taşınabilir Kişisel Bağlam Grafiği.** PCG çalışana aittir. İşveren iş kapsamı erişimi için öder; bellek, yeni bir işin ilk gününde çalışanla birlikte gider. Emsal vardır (mesleki kimlik için LinkedIn, Iury Souza, Plurality Network, Synthreo ve Piyush'un erken "bellek taşınabilirliği" yazıları) ancak hiçbir kurumsal ürün bunu sevk etmemiştir. Biz ediyoruz.

2. **Cam-kutu güven.** Her asistan yanıtı, onu bilgilendiren kesin PCG düğümlerine dayandırılır ve canlı olarak Bağlam-kullanılan şeritte yüzeylenir. Her özerk eylem bir makbuz bırakır — ne yapıldı, hangi düğümler bilgilendirdi, güven, kazandırılan zaman — tek tıkla geri alma ile. Bu, gözetim ve kara kutu kaygısının panzehiridir.

3. **Yaşam-ötesi ajan.** Bütün kişi için tek bir ajan, iş ve kişisel kapsam arasında çalışanın kontrol ettiği bir gizlilik sınırıyla. İşveren yalnızca iş-kapsamı toplam sonuçlarını görür (kazandırılan saatler, otomatikleştirilen görev türleri, memnuniyet). Asla bir ham gözlem veya bir sohbet sırası görmez.

İki demo bunu gerçek kılar: **Cockpit** (sohbet + çalışma alanı + cam-kutu şeridi) ve **Mind** (Gün-1'den Yıl-1'e zaman çubuğuyla etkileşimli PCG görselleştirmesi).

---

## 2. Sorun ve fırsat

Modern bilgi işçisini tanımlayan üç kesişen hayal kırıklığı:

- **Verimlilik tavanı.** Copilot'larla bile, ortanca bilgi işçisi haftasının %20–30'unu hâlâ koordinasyon, durum güncellemeleri, takipler, planlama ve daha önce yüzlerce kez yazdığı eserlerin yavaş taslak yazımına kaybeder.
- **Alanlar arası zaman sızıntısı.** İş ve kişisel yaşam aynı saatleri paylaşır. Takvim bir resital, aile WhatsApp grubu ve son tarihle çarpıştığında, herkes için verimlilik çöker — ancak hiçbir kurumsal araç yardımcı olmaz çünkü kurumsal araçlar takvimin kişisel yarısına bakmayı reddeder.
- **Bellek kilidi.** İşçinin ChatGPT, Copilot veya Cedric'e tercihlerini öğretmek için harcadığı her dakika, araç veya iş değiştirdiğinde tekrar kaybedeceği bir dakikadır. Satıcının silosuna sadakatin bedelini çalışan, yeniden eğitim vergisiyle öder.

Pazar hareket ediyor. Andy Jassy'nin Haziran 2025 hissedar mektubu alışılmadık şekilde dürüst: "ajanlar nasıl çalıştığımızı ve yaşadığımızı değiştirecek" ve Amazon, ajanlar rutin işi devraldıkça "kurumsal işgücünü azaltmayı" bekliyor (Andy Jassy, "Some thoughts on Generative AI", 2025). Bill Gates iki yıl önce, Kasım 2023'te AI ajanlarını "bir sonraki platform" olarak adlandırdı (gatesnotes.com/AI-agents). MIT 2025 AI Agent Index (Casper et al., 2025) ve Anthropic'in "Measuring agent autonomy in practice" çalışması özerklik merdivenini resmileştirir. Microsoft 365 Copilot Memory 2025'te sevk edildi — PCG'nin en yakın mevcut analoğu.

Eksik olan ters çevirmedir: çalışanın tüm kariyeri boyunca bağlamı katlayan, özerklikle güvenilebilecek kadar şeffaf, çalışanın sahip olduğu bir ajan.

---

## 3. Gerçek dünya öncülleri ve farklılaşma

### Amazon Cedric (Eylül 2024 ve sonrası)
Dahili Amazon asistanı, Bedrock + Anthropic Claude. Eugene Kim tarafından Business Insider'da (Eylül 2024) "ChatGPT'den daha güvenli", saniyeler içinde memo taslakları çıkaran, şifreli geçmişe sahip olarak bildirildi. Cedric, kurumsal-veri dayanağı olan **tek bir sohbet botudur**. Çalışan-taşınabilir bir grafik tutmaz, dayanağını canlı yüzeylemez ve yaşam-ötesi boyutu yoktur.

### Amazon Q Business
AWS'in rol uzmanlıklarına sahip kurumsal veri-dayanaklı asistanı. Aynı tek-sohbet-botu mimarisini ve aynı bellek silosunu miras alır: bağlamlar Q içinde yaşar, IAM ile kapılı, taşınabilir değil.

### Andy Jassy 2024 memosu ve 2025 hissedar mektubu
Ajanları bir sonraki bilgi işlem platformu olarak çerçeveler ve hissedarlara açıkça ajanlar rutin işi devraldıkça işgücünün küçüleceğini söyler. Amazon'un ticari ürün stratejisi Cedric kalıbını izleyecek — satıcıya ait bellek, işverene ait erişim.

### Microsoft 365 Copilot Memory (2025)
PCG'ye en yakın pazar analoğu. Copilot etkileşimleri arasında tercihleri ve bağlamı yakalar — ancak **Microsoft'un kiracısı içinde**, işverene ait, farklı bir satıcıya veya farklı bir işe taşınabilir değil. Bellek bir özelliktir, bir cüzdan değil.

### Bill Gates — "AI agents are the next platform" (gatesnotes.com/AI-agents, Kasım 2023)
Temel vizyon parçası: ne yaptığınızı gözlemleyen, neye ihtiyacınız olduğunu tahmin eden ve sizin adınıza hareket eden ajanlar — açıkça sağlık, eğitim, üretkenlik ve eğlenceyi yeniden şekillendireceklerini savunur. Tüm kategorinin vizyon belgesi.

### MIT 2025 AI Agent Index (Casper et al., 2025) ve Anthropic "Measuring agent autonomy in practice"
Özerklik seviyeleri, yetenek-yetenek değerlendirmesi ve dereceli özerklik için güvenlik vakası için iki referans çerçeve. Beş seviyeli merdiveni doğrudan benimsiyoruz.

### Bellek-taşınabilirliği yazıları (Souza, Plurality Network, Synthreo, Piyush)
Bağımsız yazarlar ve küçük girişimler yıllardır AI belleğinin kullanıcıya ait bir cüzdan, dışa aktarılabilir ve satıcılar arasında taşınabilir olması gerektiğini savundular. Argüman pazarda çürütülmemiştir. Hiçbir büyük kurumsal satıcı bunu sevk etmemiştir. **Sahip olduğumuz boşluk budur.**

### Ajan-UI taksonomisi — Devin / Manus (delegasyon), Cursor (işbirliği), Lindy (iş akışı)
Üç canlı UI paradigması. Devin ve Manus ajana bir çalışma alanı verir ve eşzamansız çalışmasına izin verir (delegasyon). Cursor insanı ve ajanı aynı eserde eşleştirir (işbirliği). Lindy araçları bildirimsel iş akışları aracılığıyla zincirler. **Cockpitimiz** kasıtlı olarak işbirliğini (sol panel sohbeti) ve delegasyonu (merkez çalışma alanı) aynı ekranda harmanlar, böylece aynı bağlam her iki modu da yönlendirir.

### Farklılaşma ifadesi (tek paragraf)
Cedric, Amazon Q Business ve Microsoft 365 Copilot Memory, belleği işverene veya satıcıya ait olan akıllı sohbet botlarıdır; çalışan her iş değişikliğinde yeniden eğitilir. Devin ve Manus delegasyonda mükemmeldir ancak belleği oturum-yerel olarak ele alır. Lindy araçları zincirler ancak hiçbir kişisel grafik kavramı yoktur. Cognirise Kişisel Ajan, (a) belleğin taşınabilir bir çalışana-ait grafik olduğu, (b) her cevap ve her eylemin onu temellendiren tam grafik düğümleriyle canlı yüzeylendiği ve (c) aynı ajanın temiz bir gizlilik sınırı altında çalışanın hem işine hem de kişisel hayatına hizmet ettiği tek tasarımdır. Üç öldürücü açı, bir sohbet botunun üzerine katmanlanmış özellikler değildir; mimarinin kendisidir.

---

## 4. İş-sınıfı taksonomisi

Altı sınıf. Her satır: tipik PCG düğümleri · ilk-3 yapılacak iş · ele alınan en üst araçlar · tipik görev türü için özerklik tavanı.

### İK
- *İK İş Ortağı* — kişiler, politikalar, vakalar, duygular · teklif mektupları taslakları / vaka notları taslakları / politika sorularını yanıtlama · Workday, Greenhouse, ServiceNow HR, Slack · SSS / teklif mektubu taslağı için L3 (geri-alma-ile-otomatik); ücret kararları için L1 (öner).
- *Yetenek Edinme* — adaylar, talepler, işe alma yöneticileri, mülakat döngüleri · planlama döngüleri / dış erişim taslakları / alım notlarından kısa liste · Greenhouse, LinkedIn Recruiter, Gem, takvim · dış erişim taslakları ve planlama için L3; kısa liste kararları için L1.
- *İnsan Operasyonları / İK Ops* — politikalar, bordro vakaları, fayda kayıtları · politika sorularını yanıtlama / tek sayfa SSS oluşturma / bilet ayıklama · ServiceNow HR, Workday, Notion · SSS oluşturma için L3; bilet ayıklama için L2 (eyleme-onay).
- *Öğrenme & Gelişim* — yetkinlikler, programlar, kohortlar · müfredat taslakları / yöneticileri dürtükleme / 1:1 temalarını özetleme · LMS, takvim, Slack · dürtmeler ve özetler için L3.

### Finans
- *FP&A Analisti* — hesaplar, sürücüler, senaryolar, varyans yorumu · varyans yorumu / senaryo modelleme / ay sonu paket taslakları · NetSuite, Adaptive, Pigment · varyans yorumu için L3; senaryo yeniden çalıştırmaları için L2.
- *AR / Tahsilat* — müşteri yaşlandırması, kontaklar, önceki sözler · uyarı sıraları / tahsilat çağrı hazırlığı / anlaşmazlık ayıklama · NetSuite, Salesforce, e-posta · uyarı taslakları için L3; anlaşmazlıklar için L2.
- *Procure-to-Pay* — satıcılar, sözleşmeler, faturalar, anomaliler · fatura istisna ayıklama / satıcı master temizliği / sözleşme maddesi araması · Coupa, NetSuite, Ironclad · istisna yönlendirme için L2.

### Satış
- *Kıdemli AE* — hesaplar, kontaklar, fırsatlar, oyunlar, tercihler · takipler / toplantı öncesi brifingler / sonraki en iyi eylem · Salesforce, Outreach, Gong, takvim · takipler ve brifingler için L3; fiyatlandırma için L1.
- *SDR* — potansiyel müşteriler, sıralar, itirazlar, çağrılar · sıra taslakları / itiraz kütüphaneleri / cevap ayıklama · Outreach, Gong, Salesforce, LinkedIn · giden için L3; gelen ayıklama için L2.
- *Satış Mühendisi* — ürünler, yapılandırmalar, teknik itirazlar, müşteri mimarileri · teknik Q&A / RFP yanıtları / demo betikleri · Salesforce, Notion, Slack · Q&A taslakları için L3.
- *Müşteri Başarısı* — müşteriler, sağlık skorları, yenilemeler, genişleme · QBR taslakları / yenileme risk brifingleri / genişleme oyunları · Gainsight, Salesforce, takvim · QBR taslakları için L3.

### Tedarik
- *Kategori Yöneticisi* — kategoriler, tedarikçiler, sözleşmeler, pazar istihbaratı · tedarikçi kısa listeleri / RFQ taslakları / müzakere hazırlığı · Coupa, Ariba, pazar istihbarat akışları · RFQ taslakları için L2; karar verme için L1.
- *Kaynak Sağlama Analisti* — teklifler, tasarruf iddiaları, tedarikçi durum tespiti · teklif analizi / madde karşılaştırmaları / tasarruf takibi · Excel, Coupa, Ironclad · teklif analizi için L3.
- *Tedarikçi Yöneticisi* — tedarikçi ilişkileri, KPI'lar, risk olayları · QBR hazırlığı / tedarikçi puan kartları / risk takipleri · Salesforce, Coupa, haber akışları · QBR hazırlığı için L3.

### Ürün Yönetimi
- *Kıdemli PM* — özellikler, OKR'ler, müşteri geri bildirimi, rakip hareketleri · spec taslakları / müşteri araştırması sentezi / sürüm notları · Linear, Notion, Pendo, Slack · sürüm notları ve sentez için L3; spec taslakları için L2.
- *Teknik PM* — API'ler, bağımlılıklar, teknik borç öğeleri · yol haritası belgeleri / bağımlılık anlatıları / değişiklik günlüğü taslağı · Linear, GitHub, Notion · değişiklik günlükleri için L3.

### Pazarlama
- *Talep Üretimi Pazarlamacısı* — kampanyalar, segmentler, içerik, MQL hattı · kampanya brifingleri / e-posta taslakları / performans özetleri · Marketo, Salesforce, GA4 · taslaklar ve özetler için L3.
- *İçerik Pazarlamacısı* — içerik takvimi, brifingler, editoryal yönergeler, SEO · brifing taslağı / editoryal QA / yeniden kullanım · Notion, CMS, Ahrefs · yeniden kullanım için L3.
- *Ürün Pazarlamacısı* — lansmanlar, konumlandırma, satış etkinleştirme · lansman iletişimleri / satış etkinleştirme güncellemeleri / battle kart yenileme · Notion, Slack, Salesforce · etkinleştirme güncellemeleri için L3.

Bölüm 5'teki iki persona, yukarıdaki **Satış — Kıdemli AE** ve **İK — İK İş Ortağı** satırlarının genişletilmiş halidir.

---

## 5. İki persona derinlemesine

### Persona A — Satış · Mariam Al-Hashimi · ajan adı **Atlas**

- **İsim ve rol.** Mariam Al-Hashimi, Kıdemli Hesap Yöneticisi, Northwind Cloud (B2B SaaS, MENA bölgesi).
- **Yaşam-içinde bir gün.** Mariam, BAE, KSA ve Mısır genelinde 24 kurumsal hesabı yönetir. Sabahı toplantı hazırlığı ve takiplerdir; öğleden sonra çağrılardır; akşamı kızdığı yönetimdir — Salesforce hijyeni, sıra güncellemeleri, dahili güncellemeler. Atlas üçüncü kovayı emer.
- **İlk 5 yapılacak iş.**
  1. Her toplantıdan sonra önceki konuşmaya bağlanan kusursuz bir takip taslağı hazırlamak.
  2. Tam hesap bağlamıyla herhangi bir ilk veya ikinci toplantıdan önce iki paragrafta brifing vermek.
  3. Her sabah hesap defteri boyunca sonraki en iyi eylemi yüzeylemek.
  4. Adlandırılmış kontakları hakkında sinyal (LinkedIn gönderileri, haberler, Gong çağrı temaları) tespit etmek ve zamanında dış erişim önermek.
  5. Salesforce'a yazmak zorunda kalmadan Salesforce'u dürüst tutmak.
- **Önemli ilişkiler.** Maya Chen (Tedarik Başkan Yardımcısı, ACME — en büyük canlı fırsatı); Sara Park (ACME'de Tedarik Lideri, Maya'ya raporlar); Hassan Idris (Mariam'ın satış müdürü); Layla Al-Mazrouei (canlı hesaplarındaki Müşteri Başarısı muhatabı).
- **Örnek PCG şeması (temsili ~18 düğüm).** Rol düğümleri: Kıdemli AE, MENA kurumsal. Yetenekler: hesap planlaması, çoklu-iplik, bulut-yerli sunum. İlişkiler: Maya Chen, Sara Park, Hassan Idris, Layla Al-Mazrouei, artı 8 adlandırılmış kontak. Tercihler: 6 başarılı Maya toplantısından çıkarılan Salı öğle yemeği zaman dilimleri; vejetaryen; Maya'nın kızı futbol oynar. Kişisel: Mariam'ın kızı Layan; Layan'ın resitali Perşembe 18:00. Projeler: ACME AB lansmanı; ACME fiyatlandırma yeniden müzakeresi. Araçlar: Salesforce, Outreach, Gong, takvim. İletişim örüntüleri: Mariam kısa yazar, üç seçenek listeler, "M." imzalar.
- **Kişisel boyut.** Mariam'ın kızı Layan'ın Perşembe 18:00'da resitali var. Atlas biliyor çünkü Mariam bunu bir Gong çağrısında belirtti. Atlas takvimi 17–20 arası bloklar ve önceden üç yerel çiçekçi seçer (biri vegan seçeneklerle çünkü Mariam'ın kayınvalidesi geliyor).
- **3 dakikalık Cockpit hikayesi.** (1) Mariam Cockpit'i açar, üç bekleyen onay görür — en üstteki ACME takibi. (2) Onaylar; sohbet "Tamam — Maya'ya 15:42'de gönderildi. Cevabını izleyeceğim." onayını verir. PCG alıntılarıyla makbuz düşer. (3) Atlas proaktif olarak şöyle der: "ACME'deki Maya az önce yeni AB lansmanları hakkında LinkedIn'de paylaşım yaptı — geçen haftaki fiyatlandırma konuşmasına bağlanan bir tebrik notu taslağı hazırlamamı ister misiniz?" Bağlam-kullanılan şerit, hem LinkedIn gözlem düğümünü hem de fiyatlandırma-konuşma düğümünü göstererek aydınlanır. (4) Mariam evet der; taslak Düzenle / Onayla ile görünür. (5) Onaylar; kişisel dürtü resital hakkında görünür.
- **3 dakikalık Mind hikayesi.** (1) Mariam Mind'ı açar, kapsam=Her İkisi, zaman=Gün 1. Grafik seyrek — 6 düğüm, çoğunlukla Rol ve Araçlar. (2) Çubukları Yıl 1'e sürükler; düğümler İlişkiler, Tercihler, Kişisel takımyıldızlarına yelpazelenir. (3) Maya Chen düğümüne tıklar — nasıl büyüdüğünü görür (kullanım sayısı, projelere ve tercihlere kenarlar). (4) Kapsam=İş'i değiştirir — kişisel takımyıldız solar. (5) Grafiğimi dışa aktar'a tıklar — JSON-LD modal'ı görünür.

### Persona B — İK · Yusuf Demir · ajan adı **Ember**

- **İsim ve rol.** Yusuf Demir, İK İş Ortağı — Mühendislik organizasyonu, Northwind (200 mühendis organizasyonu).
- **Yaşam-içinde bir gün.** Yusuf, mühendislik liderleriyle planlanmış 1:1'ler, ad-hoc vakalar (vize, taşınma, çatışma, ücret) ve politika güncellemeleri arasında değişir. Ember, SSS yüzeyini, planlamayı, vaka notları taslaklarını ve vakalar arasındaki temaları izlemeyi yönetir.
- **İlk 5 yapılacak iş.**
  1. Gerçek politika belgesine dayanarak teklif mektupları ve çıkış iletişimleri taslağı hazırlamak.
  2. Bir soru ekipte tekrarlandığı anda tek sayfalık SSS oluşturmak.
  3. Slack ve 1:1'ler arasında temaları tespit etmek ("üç mühendis bu saatte sabbatical hakkında soru sordu").
  4. Açık vakaları (vize, taşınma, çatışma) izlemek ve takipleri dürtüklemek.
  5. 9-box, performans yorumları ve politika bantlarından ücret / terfi brifinglerini hazırlamak.
- **Önemli ilişkiler.** Priya Nair (Mühendislik Başkan Yardımcısı, Yusuf'un birincil ortağı); Ahmet Kaya (Yetenek Edinme Başkanı); Yusuf'un desteklediği 14 mühendislik lideri; açık vakaları olan mühendisler.
- **Örnek PCG şeması (temsili ~18 düğüm).** Rol: İKİO, Mühendislik. Yetenekler: vaka yönetimi, politika iletişimleri taslağı, duygu okuma. İlişkiler: Priya Nair, Ahmet Kaya, 14 mühendislik lideri. Tercihler: Priya toplantılar yerine eşzamansız yazılı brifingleri tercih eder; Ember SSS'leri en fazla 5 Soru-Cevap ile sade dilde yazar. Kişisel: Yusuf'un annesinin 70. yaş günü 3 hafta sonra; kız kardeşi aile grubunda sürpriz bir akşam yemeğinden bahsetti. Projeler: Ç4 işe alım planı (14 talep); sabbatical politika lansmanı. Araçlar: Workday, Greenhouse, ServiceNow HR, Slack. İletişim örüntüleri: Yusuf madde işaretli brifingleri tercih eder; "Y. — İKİO" imzalar.
- **Kişisel boyut.** Yusuf'un annesinin 70. yaş günü 3 hafta sonra. Kız kardeşi aile grubunda sürpriz bir akşam yemeğinden bahsetti. Ember, Yusuf'un geçmiş 1:1'lerde paylaştığı hikayelere dayanarak kısa bir tost taslağı hazırlamayı önerir.
- **3 dakikalık Cockpit hikayesi.** (1) Yusuf Cockpit'i açar, üç bekleyen onay görür — en üstteki yeni sabbatical politikası hakkında tek sayfalık bir SSS. (2) Ember açıklar: son saatte üç mühendis Slack'te bunu sordu; politika belgesinden SSS taslağını hazırladı ve yarın 14:00'te 15 dakikalık ofis-saatleri zaman dilimi planladı. (3) Yusuf onaylar; makbuz politika düğümünü, üç Slack gözlem düğümünü ve takvim düğümünü alıntılar. (4) Tost hakkında kişisel dürtü görünür. (5) Yusuf kişisel bir anekdot eklemek için Düzenle'ye tıklar — Ember sohbette onaylar.
- **3 dakikalık Mind hikayesi.** Mariam'ınkiyle aynı, ancak Yıl-1 grafiği Politikalar, Kişiler, Vakalar etrafında yoğun. Ay 3'te, 14 aday düğümüne kenarlarla bir Ç4 işe alım planı kümesi görünür. Kişisel'i değiştirmek küçük ama görünür bir kişisel takımyıldızı ortaya çıkarır.

---

## 6. Kişisel Bağlam Grafiği modeli

**Düğüm türleri.** Rol · Yetenek · İlişki · Tercih · Kişisel · Proje · Araç · İletişim örüntüsü · Alan bilgisi.

**Kenar türleri.** `knows`, `reports_to`, `works_on`, `prefers`, `owns`, `uses`, `remembers`, `attended`, `inferred_from`. Kenarlar güç (0–1) ve kaynak taşır.

**Kaynaklar.** Takvim, e-posta, sohbet, toplantı transkriptleri (Gong / Otter / Teams), belge düzenlemeleri (Notion / Google Docs), CRM / ATS / ERP salt-okunur akışları, çalışan düzeltmeleri, açık öğret-bana parçacıkları ("Atlas, Maya'nın vejetaryen olduğunu hatırla.").

**Güven puanlaması.** Her düğüm 0–1 güven taşır. Güven, doğrulama (anlaşan birden çok kaynak), çalışan onayı veya başarılı kullanımla yükselir ("Bu düğüme atıfla x taslağı hazırladım ve Mariam onayladı"). Çalışan düzeltmesi, çelişki veya bayatlamayla düşer.

**Zaman içinde çürüme.** Düğümler `lastUsedAt` taşır. Bir eşikten sonra (tercihler için varsayılan 90 gün, ilişkiler için 180, proje durumu için 30) güven doğrusal olarak 0.4'e çürür, burada ajan düğümü bayat olarak işaretler ve ona güvenmeden önce sorar.

**Çelişki yönetimi.** Mevcut yüksek güvenli bir düğümle çelişen yeni bir gözlem `pending-contradiction` olarak kuyruğa alınır. Ajan bunu bir sonraki sohbet sırasında çalışana yüzeyler ("Maya'nın Salı öğle yemeklerini tercih ettiğini kaydetmiştim, ancak bugünkü yeniden planlama aksini gösteriyor — güncellemeli miyim?"). Çalışan çözer; grafik küratörü değişikliği kaydeder.

**İş-vs-kişisel kapsam** her düğümdeki birinci sınıf bir alandır. `personal` etiketli bir düğüm, herhangi bir toplam görünümde işverene görünmez. Çalışan bir düğümü herhangi bir zamanda yeniden etiketleyebilir, grafiği dışa aktarmadan önce toplu yeniden etiketleme dahil.

**Taşınabilirlik modeli.** PCG, herhangi bir zamanda JSON-LD (`@context: https://cognirise.com/pcg/v1`) olarak dışa aktarılabilir. Dışa aktarılan yük, her düğüm, her kenar, tüm kaynaklar ve her düğümü yazan ajan sürümlerinin manifestosunu içerir. Cognirise lisanslayan yeni bir işveren yalnızca **iş-kapsamı alt kümesini** içe aktarabilir (çalışan neyi paylaşacağını seçer) ve grafik küratörü düğümleri yeni çalışanın PCG'sine tam kaynaklar korunarak birleştirir.

---

## 7. Öğrenme döngüsü

`Gözlemle → çıkar → öner → onayla → depola`.

- **Gözlemle.** Alt-ajanlar konnektörlere salt-okunur kapsamla dokunur. Takvim katılımı, e-posta cevapları, sohbet tepkileri, belge düzenlemeleri.
- **Çıkar.** Gözlem Çıkarıcı, güven puanlarıyla yeni düğümler ve kenarlar önerir.
- **Öner.** Grafik Küratörü önerileri inceler, mevcut düğümlere karşı tekilleştirir ve ya otomatik olarak depolar (güven > 0.9 ve çelişki yoksa) ya da onay için işaretler.
- **Onayla.** Düşük riskli onayların çoğu sessizce gerçekleşir (güven birden çok doğrulama arasında yükselir). Yüksek riskli veya çelişkili onaylar satır içi yüzeylenir ("Sara Park'ın Maya'ya rapor verdiğini kaydediyorum. Kaynak: bugünkü toplantı transkripti. Güven 0.82. Onaylar mısınız?").
- **Depola.** Grafik Küratörü PCG'nin tek yazıcısıdır.

**Soğuk başlangıç vs sabit durum.** Gün 1 kasıtlı olarak seyrek — teklif mektubundan ve ilk takvim senkronizasyonundan başlatılan 6 düğümlü bir Rol ve Araçlar takımyıldızı. İlk iki hafta **gölge modunda** çalışır: ajan gözlemler ve önerir ancak özerk hareket etmez. Çalışan ilk 25 düğümü onayladıktan sonra, ajan düşük riskli yetenekler için L1'e (öner) geçer. L2 / L3, çalışan veya politika sahibi izin verdikçe yetenek başına açılır.

---

## 8. Özerklik merdiveni

MIT 2025 AI Agent Index ve Anthropic'in "Measuring agent autonomy in practice" çalışmasından benimsenmiştir.

- **L0 — Bilgi amaçlı.** Ajan ne yapacağını açıklar, eylem almaz.
- **L1 — Öner.** Ajan taslak hazırlar; insan alır, düzenler, gönderir.
- **L2 — Eyleme onay.** Ajan tek tıkla Onayla ile tam bir eylem önerir (göndermeye hazır bir e-posta, rezervasyona hazır bir zaman dilimi).
- **L3 — Geri-alma-ile-otomatik.** Ajan hemen hareket eder; yapılandırılabilir bir pencere için tek tıkla Geri Al ile makbuz düşer (varsayılan 5 dakika).
- **L4 — Tamamen özerk.** Ajan eylem başına makbuz olmadan hareket eder; yalnızca toplam raporlama. Düşük riskli, yüksek hacimli, çalışan kontrollü yetenekler için ayrılmıştır.

**Yetenek başına tavanlar.** Her yetenek (örn. "takip e-postası taslağı", "takvim zaman dilimi rezervasyonu", "SSS yayınla", "teklif mektubu gönder") kendi tavanını taşır. **Çalışan**, tüm seviyelerde kişisel-kapsam tavanına sahiptir. **Yönetici / politika sahibi**, yetenek başına iş-kapsamı tavanına sahiptir. Varsayılanlar: takipler ve SSS'ler için L3; teklif mektupları ve müşterilere dokunan rezervasyonlar için L2; ücret kararları ve > $X değer dokunan herhangi bir yetenek için L1.

---

## 9. Çoklu-ajan orkestrasyonu

PCG, **paylaşılan substrattır**. Kişisel Planlayıcı (adlandırılmış ajan — Atlas, Ember) tek planlayıcıdır. Hepsi Grafik Küratörü aracılığıyla okuyup yazan uzmanlaşmış alt-ajanlara dağıtır:

- **Gözlem Çıkarıcı** — akışlara dokun, düğümler öner.
- **Grafik Küratörü** — PCG'nin tek yazıcısı; tekilleştirme, güven, çürüme, çelişkiler.
- **Bağlam Geri Çağırıcısı** — herhangi bir sohbet sırası veya özerk görev için, en küçük yeterli PCG düğüm alt kümesini seç (grafik gezinmesi + gömme eşleşmesi) ve planlayıcıya temellendirme paketi olarak teslim et.
- **Taslakçı** — pakete dayanarak personanın sesinde eseri (e-posta, SSS, teklif mektubu, brifing) yaz.
- **Takvim / E-posta / Seyahat / Hediye / Belge-yazma / Takip / Toplantı-hazırlığı / İşe alım / Bordro-sorgu / Gider / Araştırma** alt-ajanları — takılabilir. Her biri bir yeteneğe sahiptir.
- **Özerklik Kapısı** — yetenek başına özerklik tavanını uygular ve otomatik-yürüt, geri-alma-ile-öner veya önce-insana-sor'a yönlendirir.
- **Makbuz Tutucu** — her özerk eylem için cam-kutu makbuzunu yazar.

Takılabilir alt-ajan modeli, tek-sohbet-botu ürünlerine karşı kasıtlı bir farklılaştırıcıdır: planlayıcı küçük kalır, yetenekler bağımsız olarak ölçeklenir ve organizasyon (örneğin) Seyahat alt-ajanını PCG şemasına dokunmadan değiştirebilir.

---

## 10. Güven, güvenlik, gizlilik duruşu

Birinci sınıf tasarım kısıtlamaları, özellik geçişleri değil:

- **İş-vs-kişisel kapsam**, her düğüm ve her kenardaki bir etikettir; işveren kişisel dilimi asla göremez.
- **Tüm özerklik seviyelerinde çalışan kontrollü kişisel kapsam** — bir L4 otomasyonu bile, açık politika olmadan kişisel-kapsam eylemi tetiklenecekse durur.
- Her özerk eylem için **tam denetim günlüğü**. Her eylem yapılandırılabilir bir pencere için bir geri alma kolu taşır.
- **Şifreleme** aktarımda (TLS 1.3) ve dinlenmede (iş kapsamı için müşterinin KMS'inde çalışan başına anahtar; kişisel kapsam için çalışan başına kişisel anahtar).
- **Dışa aktarma hakkı.** Çalışan PCG'sini herhangi bir zamanda, ücretsiz, JSON-LD'de dışa aktarabilir.
- **Unutma hakkı.** Çalışan herhangi bir düğümü veya kenarı veya tüm grafiği herhangi bir zamanda silebilir.
- **Yönetici gözlemlenebilirliği** yalnızca toplam iş-kapsamı sonuçlarıdır — kazandırılan saatler, otomatikleştirilen görev türleri, memnuniyet. Asla ham gözlemler veya sohbet içeriği değil.
- Halüsinasyonu azaltmak için **temellendirme**. Bağlam Geri Çağırıcısının paketi her sohbet sırasında alıntılanır; temellendirme bir eşiğin altına düşerse sohbet cevap vermeyi reddeder.
- Yüksek riskli eylemler için **reddetme örüntüleri**: para, baş sayısı veya müşteri taahhütlerine dokunan L2 üstündeki herhangi bir yetenek, politikadan bağımsız olarak açık bir insan kontrol noktasından geçer.
- **Cam-kutu ilkesi.** Güven bir dipnot değil, bir ürün yüzeyidir. Her cevap alıntılar; her eylem makbuz verir.

---

## 11. Mimari taslağı

Metinde tarif edilen tek sayfalık bir diyagram (oluşturucu Demo 1'in "Bu nasıl çalışır?" modal'ında):

- **Konnektörler.** Takvime, e-postaya, sohbete, transkriptlere, belgelere, CRM/ATS/ERP'ye salt-okunur OAuth. Akış + yoklama.
- **Alım & çıkarım katmanı.** Gözlem Çıkarıcı, normalleştirici, PII-farkında redaktör, kapsam etiketleyici.
- **PCG deposu.** Çalışan başına grafik DB'si (Neo4j veya AWS Neptune). Çalışan başına anahtar. Kişisel-kapsam bölümlendirilmiş ve ayrı şifrelenmiş.
- **Geri çağırma katmanı.** Hibrit: bilinen ilişkiler için grafik gezinmesi, "TechCorp'ta tanıdığım var mı" gibi bulanık sorgular için gömme araması.
- **Ajan çalışma zamanı.** Planlayıcı (persona başına adlandırılmış) artı takılabilir alt-ajanlar. Her alt-ajan yeteneğini, özerklik tavanını, araç kataloğunu ve denetim alanlarını bildirir.
- **UI katmanı.** Cockpit (sohbet + çalışma alanı + cam-kutu şeridi). Mind (PCG görselleştirmesi). Yönetici (özerklik politikaları, kapsam politikaları, dışa aktarma).
- **Denetim & makbuz katmanı.** Yalnızca-ekleme günlüğü, geri alma kolları, yönetici gözlemlenebilirliği için toplam-toplama.
- **Kimlik & politika.** Çalışan başına kimlik (çalışan sahip). İşveren başına politika (özerklik tavanları, konnektör kapsamı, saklama).

---

## 12. Org-düzeyi zekâ (kısaca)

Anonimleştirilmiş "benzer rollerdeki benzer kişiler için ne işe yaradı" oyun kitapları öneri olarak akar — *"Bu şablonu kullanan MENA'daki Kıdemli AE'ler %23 daha yüksek cevap oranı görüyor"* — çalışanın açık katılımıyla müşteri tabanı boyunca k-anonim toplamalardan türetilir. Asla belirli bir kişiyi tanımlamaz.

---

## 13. Yönetici gözlemlenebilirliği (kısaca)

Yönetici görür: ekipte kazandırılan saatler, en üst otomatikleştirilen görev türleri, çalışanın bildirdiği memnuniyet, geri alma oranı (kalite sinyali), yetenek benimseme eğrisi. Yönetici asla görmez: belirli bir kişisel gözlem, bir ham sohbet sırası, belirli bir takvim öğesi, belirli bir e-posta gövdesi. Hangi toplamaların hesaplandığının denetim izi kendisi gözlemlenebilirdir.

---

## 14. Ses ve çoklu modal (kısaca, demo kapsamı dışında)

Ses yakalama (her zaman açık dinleyici, çalışan geçişi), toplantı içi yakalama (Teams / Zoom eklentileri), ekran-bağlam uzantısı (sayfa meta verilerini akıtan tarayıcı eklentisi, çalışan geçişi). Tüm yollar iş / kişisel kapsamına, tavana ve makbuz modeline uyar. Demo kapsamı dışında ancak mimaride.

---

## 15. Risk kaydı

- **Gizlilik ihlali.** Grafik kişisel yaşam içerir. Azaltma: kapsam başına şifreleme, çalışan başına anahtar, işveren kişisel düğümleri asla görmez, unutma hakkı.
- **Halüsinasyon.** Azaltma: açık alıntılarla temellendirilmiş cevaplar; reddetme eşiği; risk taşıyan eylemler için L2 üstünde insan kontrol noktası.
- **Yanlış özerk eylem.** Azaltma: her L3 eyleminde geri alma kolu; herhangi bir yeni yetenek için varsayılan L1/L2; yetenek başına özerklik tavanı; para / baş sayısı / müşteri taahhütleri için reddetme örüntüleri.
- **Bağımlılık, atrofi, beceri kaybı.** Azaltma: açık "duraklat ve denememe izin ver" geçişi; periyodik "ajanın taslağı yazacağınızla eşleşti mi?" istemleri; çalışana yüzeylenen yetenek benimseme metrikleri, yöneticiye değil.
- **İki-kademeli verimlilik.** Azaltma: Kişisel Ajan, yalnızca kıdemli personele değil, her çalışana sunulan koltuk başına bir üründür; fiyatlandırma kademeleri temel yetenekleri kapatmaz.
- **Gözetim algısı.** Benimsemeye en büyük tehdit. Azaltma: birinci sınıf tasarım kısıtlaması olarak cam-kutu güveni; yönetici gözlemlenebilirliği yalnızca toplamdır ve kendisi denetlenir; pazarlama duruşu "sizin belleğiniz, onlarınki değil" ile başlar.

---

## 16. Bu ne DEĞİLDİR

- **Bir gözetim aracı değildir.** Kişisel kapsam işverene görünmez.
- **Çalışanın yerine geçmez.** Çalışan yüksek riskli işi imzalar; ajan rutin işi yapar.
- **Tek bir sohbet botu değildir.** Kişisel Planlayıcı, takılabilir alt-ajanlar ve bir grafik tarafından desteklenen tek bir adlandırılmış ajandır.
- **Bir bellek silosu değildir.** PCG taşınabilir, dışa aktarılabilir, çalışana aittir.

---

## 17. Aşamalı dağıtım

- **Aşama 1 — Pilot.** Tek ekip (örn. 12 satış AE'si veya 6 İKİO), yalnızca L0–L1, 8 hafta, başarı kriterleri: pilot başına ≥ 4 saat / hafta tasarruf, ≥ %80 çalışan memnuniyeti, < %5 geri alma oranı.
- **Aşama 2 — Genişleme.** Tüm departman (örn. 200 kişilik satış organizasyonu veya 40 kişilik İK organizasyonu), yetenek başına L0–L2 açık, 12 hafta, başarı kriterleri: çalışan başına ≥ 6 saat / hafta tasarruf, ≥ %75 çalışan benimsemesi.
- **Aşama 3 — Org-genelinde.** Çalışan kontrollü L4 kişisel kapsamla L0–L3; yönetici gözlemlenebilirliği panoları canlı; taşınabilirlik dışa aktarması mevcut; 24 hafta; başarı kriterleri: organizasyon ortancası ≥ 8 saat / hafta tasarruf, ≥ %90 benimseme, düzenleyici sınıfı denetim paketi.

---

## 18. Fiyatlandırma & paketleme

- **Koltuk başına kurumsal lisans**, iş kapsamı. Özerklik tavanı ve konnektör sayısına göre kademeler.
- **Kişisel kapsam çalışan için sonsuza dek ücretsizdir.** Çalışan, işvereni terk etse bile Kişisel Ajan'ı kişisel yaşam için kullanabilir; kişisel kapsam, kişisel-anahtar şifreleme ve dışa aktarma hakkı iş değişikliğinde hayatta kalır.
- **PCG dışa aktarması her zaman ücretsizdir.** Çalışan hakkı.
- **Eklentiler.** Ses yakalama, toplantı içi yakalama, yönetici-gözlemlenebilirliği panosu, düzenleyici sınıfı denetim paketi.

---

## 19. Demo eşleme eki

Bu belgedeki her karar bir seed-veri satırına eşlenir, böylece demolar konsepte karşı denetlenebilir.

| Konsept kararı | Demo yüzeyi | Seed veri satırı |
|---|---|---|
| Üç öldürücü açı belgenin başını çeker | Marketplace detay "Bunu neden bu şekilde inşa ettik" şeridi | `MarketplaceDetail.tsx` şeridi + `tool.longDescription` |
| Persona başına ajan adı (Atlas / Ember) | Cockpit üst çubuğu; birlikte-mevcudiyet rozeti | `personal-agent-seed.ts` içindeki `personas[].agentName` |
| PCG düğüm kategorileri | Mind takımyıldızı renkleri | `personas[].pcg.nodes[].category` |
| Zaman çubuğu kilometre taşları (Gün 1 / Hafta 1 / Ay 1 / Ay 6 / Yıl 1) | Mind alt yuvası | `personal-agent-seed.ts` içindeki `MILESTONES` dizisi |
| Düğüm etrafında güven halkası | Mind düğüm SVG render'ı | `node.confidence` |
| Kullanım sayısı düğümü büyütür | Mind düğüm boyutlandırma | `node.useCount` |
| Gizlilik kapsam filtresi | Mind üst çubuğu İş / Kişisel / Her İkisi geçişi | `node.scope` |
| PCG alıntılarıyla cam-kutu makbuz | Cockpit çalışma alanı "Bugün ne yaptım" | `cockpit.completed[].citedNodeIds` |
| Yaşam-ötesi an — Mariam'ın kızı Layan'ın resitali | Cockpit kişisel dürtü | `personas.sales.cockpit.nudge` |
| Yaşam-ötesi an — Yusuf'un annesinin 70. tostu | Cockpit kişisel dürtü | `personas.hr.cockpit.nudge` |
| Çapraz kaynak sentez sihirli anı (Satış) | Cockpit sohbet-başlatılan öneri + Bağlam-kullanılan şerit | `personas.sales.cockpit.proactive` |
| Örüntü-tespit sihirli anı (İK) | Cockpit üç Slack alıntısıyla bekleyen kart | `personas.hr.cockpit.pending[0]` |
| Tek-tıkla geri alma ile L3 yeteneği | Cockpit Onayla akışı | `pending[].autonomyLevel: "L3"` + `receipt.undoableUntil` |
| Unutma hakkı | Mind düğüm detay paneli "Bunu unut" düğmesi | `MindNodePanel` eylemi |
| Taşınabilir PCG dışa aktarması (JSON-LD) | Mind üst çubuğu "Grafiğimi dışa aktar" modal'ı | `personas[].exportPayload` |
| Çalışana ait, sonsuza dek ücretsiz kişisel kapsam | Marketplace detay konsept belgesi ve fiyatlandırma şeridi | yukarıdaki bölüm 18 |
| Yönetici gözlemlenebilirliği yalnızca toplam | Konsept belgesi; demoda inşa edilmedi (kapsam dışı) | yukarıdaki bölüm 13 |
| Cam-kutu ilkesi | Cockpit Bağlam-kullanılan şeridi + her makbuz | `Cockpit.tsx` şerit oluşturma |
| Beş alt-ajan kadroda adlandırılır | Marketplace detay "Bu nasıl çalışır?" modal'ı | `agentCasts.ts → maven-personal-agent` |
| Konsept belgesi sözleşmedir | Marketplace detay "Konsept & araştırma" bağlantısı | `/personal-agent/concept` rotası |
