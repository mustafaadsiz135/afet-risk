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

Her tehlike 0–100 puanlanır: 0–19 çok düşük, 20–39 düşük, 40–59 orta, 60–79 yüksek, 80–100 çok yüksek.
Konum güvenlik puanı = 100 − (0,65 × en yüksek tehlike + 0,35 × ortalama tehlike).

## Veri kaynakları
- Aktif faylar: GEM Global Active Faults Database (CC BY-SA 4.0) — uygulamaya gömülü
- Deprem kayıtları: USGS ANSS ComCat (yedek: EMSC)
- Yükseklik/eğim: Copernicus DEM GLO-90 (Open-Meteo)
- Yağış ve kar: ERA5 (Open-Meteo Historical Weather)
- Akarsu, kıyı, konum arama ve harita: © OpenStreetMap katkıcıları (Overpass, Nominatim)
- Ülke/il/ilçe listesi: countries-states-cities veri seti (ODbL)

## Tarafsızlık
Rapor yalnızca açık bilimsel verilerden hesaplanan **bölgesel doğal tehlike göstergelerini** içerir; hiçbir otel, bina, kurum, şirket veya kişi hakkında değerlendirme ya da yargı içermez. Depremlerin zamanı önceden bilinemez; gösterilen olasılıklar istatistiksel değerlerdir.

## Derleme
`main` dalına her gönderimde GitHub Actions APK'yı derler ve **Releases → latest** altına `AfetRiskRehberi.apk` olarak yükler.

Gömülü verileri yeniden üretmek için: `python3 tools/build_data.py <gem_active_faults_harmonized.geojson> <country-state-city/src/assets> app/src/main/assets/www/data`
