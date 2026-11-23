# VeTNeT VeBot AI

Bu güncelleme, Ollama üzerinden yerel modelle sohbet, çeviri, içerik, laboratuvar
metni değerlendirmesi ve uygun görsel modelle fotoğraf analizi sağlar. Bilimsel
araştırma modunda arama terimleri Europe PMC'ye gönderilir. Sonuçlar ilk sekiz
kayıtla sınırlıdır, tam metin yerine bibliyografik kayıt ve özetleri kullanır.
Arama kutusuna hasta adı, telefon veya diğer kişisel bilgileri girmeyin.

## cPanel

1. VeTNeT MySQL veritabanına database/020-vebot.sql dosyasını uygulayın.
2. ZIP içindeki public ve src dosyalarını aynı dizinlere aktarın.
3. Ollama'yı kaynakları uygun bir Linux sunucusunda kurun. İnternet üzerinden
   erişilecekse Ollama portunu doğrudan açmayın. TLS ve Bearer doğrulamalı
   bir ters vekil kullanın. Yerel modelleri önceden indirin, Ollama bulut
   özelliklerini devre dışı bırakın. Satışa sunmadan önce seçtiğiniz modelin
   lisans koşullarını kontrol edin.
4. Mevcut config.php dizisine şu örneği kendi değerlerinizle ekleyin.

```php
'vebot' => [
    'enabled' => true,
    'url' => 'http://127.0.0.1:11434',
    'model' => 'qwen2.5:7b',
    'visionModel' => '', // Görsel giriş destekli kurulu Ollama model etiketi
    'token' => '', // Uzak HTTPS geçidi için en az 24 karakter
    'pdfToText' => '/usr/bin/pdftotext', // İsteğe bağlı
],
```

5. Yönetim → VeBot AI bölümünde etkin abonelik paketleri için izinli
   modları, rolleri ve günlük mesaj sınırını belirleyin. Üyelik kimliği listesi
   doldurulursa yalnızca listedeki kullanıcılar seçilen rollerle erişebilir.
   Klinik ekranında VeBot açılır. Doğrudan yol /klinik#vebot.

PHP cURL gereklidir. DOCX ve XLSX için ZIP ve DOM uzantıları gerekir.
PDF desteği ilk 15 sayfadaki mevcut metin katmanını okur. OCR içermez.
DOCX ana belgeyi ve XLSX ilk beş standart çalışma sayfasını okur.
Her dosya en fazla 3 MB, modele geçirilen belge metni en fazla 47 KB.
Görsel ve belge yalnızca gönderildiği isteğe eklenir. Sohbet metni ve model
yanıtı kullanıcı üyeliğine bağlı olarak MySQL'de saklanır. Yanıta belge içeriği
yansıyabileceği için sohbet kayıtlarına kurumunuzun veri saklama kuralları
uygulanmalıdır. Yeni sohbet eski kaydı silmez. Model en son beş soru ve yanıtı
bağlam olarak alır.

Ücretli API veya kullanım kredisi yoktur. Model donanımı ve barındırma
gerekir. Görsel üretim/düzenleme, genel web tarama ve görsel üretim kotası
bu pakette uygulanmamıştır.
