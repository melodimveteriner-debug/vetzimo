# VeTNeT R6 · Demo İstek-Değerlendirme

Mevcut R5 kurulumunu güncellemeden önce dosya ve veritabanı yedeği alın.
phpMyAdmin'de 014-lead-review.sql dosyasını çalıştırın. R3 veya daha
eski sürümden geliyorsanız önce 013-center-management.sql dosyasını çalıştırın.
vetnet/src ve vetnet/public içeriklerini mevcut klasörlerine yükleyin.
public/index.php dosyasını en son yükleyin. config.php dosyanızı ve özel
.htaccess kurallarınızı koruyun. install.php dosyasını yeniden yüklemeyin.
Yeni boş veritabanı kurulumu için KURULUM.md dosyasını izleyin.

Demo ekranı son 200 başvuruyu gösterir. Durum, tür ve kullanılan program
filtrelenebilir. Ayrıntıda iç not, işlem zamanı ve yönetici geçmişi tutulur.
Değerlendirilen demo/deneme başvurusu için, başvuru telefonuyla eşleşen
etkin bayi yöneticisine 1–90 günlük paket dönemi açılabilir. Başvuru
kararı ile abonelik dönemi aynı işlemde kaydedilir. Çakışan dönem ve
tekrarlanan açılış engellenir. Eşzamanlı değerlendirmede eski form reddedilir.

Başvurudan yeni bayi oluşturma ve demo onay e-postaları eski sürümden
aktarılmadı. Diğer yönetim bölümleri için MERKEZ-R5.md kapsamına bakın.
