# Afet Risk Rehberi / Disaster Risk Guide

Yerli ve yabancı turistlerin konaklayacakları otelin ya da bölgenin **deprem, sel/taşkın, heyelan ve çığ** açısından bölgesel tehlike düzeyini puanlayan ve kısa bir rapor sunan Android uygulaması. Türkçe ve İngilizce.

## Kullanım
1. Ülke → il → ilçe seçin.
2. İsterseniz otel adı veya adres yazıp **Konumu bul**'a basın, çıkan listeden doğru yeri seçin. (Yazmazsanız **Seçili bölgeyi değerlendir** ilçe/il merkezini değerlendirir.)
3. Rapor: konum güvenlik puanı (0–100), her tehlike için düzey ve puanı etkileyen kriterler, fay haritası, bölgedeki en büyük depremler, istatistiksel deprem olasılığı ve öneriler. **Raporu paylaş** ile metin olarak paylaşılabilir.

## Puanlama kriterleri
| Tehlike | Kriterler |
|---|---|
| Deprem | En yakın aktif faya uzaklık ve fayın kayma hızı · 150 km içindeki en büyük kayıtlı deprem · 1900'den beri 100 km içindeki M5+ deprem sayısı · 50 yılda M6+ deprem olasılığı (Gutenberg–Richter, istatistiksel) |
| Sel / taşkın | Nehir/dere/göle uzaklık · çevresine göre alçakta olma (çukur/vadi tabanı) · düzlük · kıyıya yakın ve alçak olma · 20 yılın en yüksek günlük yağışı |
| Heyelan | Konumdaki eğim · 2 km'lik alandaki yükseklik farkı · yıllık ve aşırı yağış · deprem tehlikesi |
| Çığ | Yıllık kar yağışı · 28°–50° eğimli alan oranı · yükseklik |

### Suç ve kişisel güvenlik (ülke geneli, puanlı)
- Dünya Bankası / UNODC kasten öldürme oranı (100.000 kişide), dünya ortalamasıyla karşılaştırmalı. Oran dünya ortalamasının 0,5 katından az: çok düşük · 1 katından az: düşük · 1,5 katından az: orta · 1,5–3 kat: **yüksek** · 3 kat ve üzeri: çok yüksek.
- Birleşik Krallık Dışişleri (FCDO) resmi seyahat bilgisinin "Crime" bölümü (yan kesicilik, dolandırıcılık, taksi güvenliği vb.), İngilizce ve değiştirilmeden.
- **Konum çevresi resmi kayıtları (öncelikli):** Sokak düzeyinde açık resmi suç kaydı bulunan yerlerde (İngiltere ve Galler — data.police.uk; Chicago ve San Francisco açık veri portalları) konumun 1 km çevresindeki kayıt sayısı, aynı şehirde 3 km uzaktaki 4 bölgenin (K, D, G, B) ortancasıyla karşılaştırılır. Aynı eşikler geçerlidir: 1,5 kat ve üzeri **yüksek**. Yankesicilik ayrı gösterilir; sokak adı veya tekil olay gösterilmez.
- Bu tür verinin olmadığı yerlerde (Türkiye dahil) ülke geneli gösterge kullanılır. Suç göstergesi konum güvenlik puanına katılmaz.

Her tehlike 0–100 puanlanır: 0–19 çok düşük, 20–39 düşük, 40–59 orta, 60–79 yüksek, 80–100 çok yüksek.
Konum güvenlik puanı = 100 − (0,65 × en yüksek tehlike + 0,35 × ortalama tehlike).

### Seyahat rehberi
| Bölüm | Göstergeler |
|---|---|
| Suç ve kişisel güvenlik | Yukarıdaki suç değerlendirmesi (konum çevresi kayıtları veya ülke geneli) · FCDO "Crime" bölümü · öneriler |
| Ulaşım ve iletişim | Trafik kazası ölüm oranı (DSÖ) × 1,5 (en fazla 50) + (100 − internet kullanımı %) × 0,35 (en fazla 35) → **0–29 kolay · 30–59 orta · 60+ zor** · trafiğin aktığı yön · FCDO "Transport risks" bölümü |
| Dil | Resmi diller, İngilizcenin resmi dil olup olmadığı (puanlanmaz) |

Önceki değerlendirmeler cihazda saklanır (en fazla 15), internetsiz de açılabilir ve "Güncelle" ile yenilenebilir. **Karşılaştır** ile en fazla 3 kayıt yan yana görülür: konum güvenlik puanı, deprem, sel, heyelan, çığ, suç ve ulaşım; her satırda en iyi değer işaretlenir.

## Veri kaynakları
- Aktif faylar: GEM Global Active Faults Database (CC BY-SA 4.0) — uygulamaya gömülü
- Deprem kayıtları: USGS ANSS ComCat (yedek: EMSC)
- Yükseklik/eğim: Copernicus DEM GLO-90 (Open-Meteo)
- Yağış ve kar: ERA5 (Open-Meteo Historical Weather)
- Akarsu, kıyı, konum arama ve harita: © OpenStreetMap katkıcıları (Overpass, Nominatim)
- Ülke göstergeleri: Dünya Bankası Açık Veri — UNODC, DSÖ, ITU kaynaklı (CC BY 4.0)
- Resmi diller: mledoze/countries (ODbL)
- Yerel suç kayıtları: data.police.uk (Open Government Licence), City of Chicago ve DataSF açık veri portalları
- Resmi seyahat bilgisi: GOV.UK Foreign travel advice (Open Government Licence v3.0)
- Ülke/il/ilçe listesi: countries-states-cities veri seti (ODbL)

## Tarafsızlık
Rapor yalnızca açık bilimsel verilerden hesaplanan **bölgesel doğal tehlike göstergelerini** içerir; hiçbir otel, bina, kurum, şirket veya kişi hakkında değerlendirme ya da yargı içermez. Depremlerin zamanı önceden bilinemez; gösterilen olasılıklar istatistiksel değerlerdir.

## Derleme
`main` dalına her gönderimde GitHub Actions APK'yı derler ve **Releases → latest** altına `AfetRiskRehberi.apk` olarak yükler.

Gömülü verileri yeniden üretmek için: `python3 tools/build_data.py <gem_active_faults_harmonized.geojson> <country-state-city/src/assets> app/src/main/assets/www/data`
