<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

/**
 * Satış sitesi İletişim sayfası: eski başvuru formunun yerine güvenlik sorulu iletişim formu ve şirketin iletişim kartları.
 * Form /api/site-contact adresine gönderilir (public/site-contact.js); mesaj yönetim panelindeki İletişim Mesajları'na düşer.
 */
final class MarketContactPage
{
    private const SUBJECTS = ['Paketler ve fiyatlar', 'Demo ve kurulum', 'Veri aktarımı (başka yazılımdan geçiş)', 'Entegrasyonlar (cihaz, ÖKC, e-Fatura)',
        'Teknik destek', 'Bayilik ve iş birliği', 'Diğer'];

    private static function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

    public static function apply(string $html, array $c): string
    {
        $options = '<option value="">Konu seçin</option>';
        foreach (self::SUBJECTS as $s) $options .= '<option>'.self::e($s).'</option>';
        $form = '<form class="card vzc-form" data-site-contact novalidate>'
            .'<h2 class="vzc-title">Bize yazın</h2><p class="vzc-lead">Mesajınız doğrudan ekibimize ulaşır; yanıtımız e-posta adresinize gelir.</p>'
            .'<div class="vzc-grid">'
            .'<label>Ad soyad <b aria-hidden="true">*</b><input name="name" maxlength="120" autocomplete="name" required></label>'
            .'<label>E-posta <b aria-hidden="true">*</b><input name="email" type="email" maxlength="254" autocomplete="email" required></label>'
            .'<label>Telefon <small>(isteğe bağlı)</small><input name="phone" type="tel" maxlength="24" autocomplete="tel" inputmode="tel" placeholder="05xx xxx xx xx"></label>'
            .'<label>Klinik veya işletme <small>(isteğe bağlı)</small><input name="company" maxlength="160" autocomplete="organization"></label>'
            .'<label class="vzc-wide">Konu <b aria-hidden="true">*</b><select name="subject" required>'.$options.'</select></label>'
            .'<label class="vzc-wide">Mesajınız <b aria-hidden="true">*</b><textarea name="message" rows="6" minlength="10" maxlength="4000" required placeholder="Size nasıl yardımcı olabiliriz?"></textarea><small class="vzc-count" data-count>0 / 4000</small></label>'
            .'</div>'
            .'<div class="vzc-hp" aria-hidden="true"><label>Web sitesi<input name="website" tabindex="-1" autocomplete="off"></label></div>'
            .'<div class="vzc-captcha"><label for="vzc-answer"><span class="vzc-shield" aria-hidden="true">🛡️</span> Güvenlik sorusu: <strong data-question>…</strong></label>'
            .'<div class="vzc-captcha-row"><input id="vzc-answer" name="answer" inputmode="numeric" pattern="-?[0-9]*" maxlength="4" autocomplete="off" required aria-describedby="vzc-captcha-help">'
            .'<button type="button" class="vzc-refresh" data-refresh aria-label="Yeni soru">↻</button></div>'
            .'<small id="vzc-captcha-help">Robotları engellemek için basit bir işlem; sonucu rakamla yazın.</small></div>'
            .'<label class="vzc-consent"><input type="checkbox" name="consent" required> <span><a href="/platform/yasal/kvkk-aydinlatma" target="_blank" rel="noopener">KVKK Aydınlatma Metni</a>’ni okudum; mesajımı yanıtlamak için bilgilerimin işlenmesini kabul ediyorum.</span></label>'
            .'<button class="button primary vzc-submit" type="submit">Mesajı gönder</button>'
            .'<p class="vzc-feedback" role="status" aria-live="polite"></p></form>'
            .'<div class="card vzc-done" hidden><div class="vzc-done-icon" aria-hidden="true">✓</div><h2>Mesajınız bize ulaştı</h2><p>Teşekkür ederiz. Ekibimiz en kısa sürede e-posta adresinize yanıt verecek.</p><button type="button" class="button" data-again>Yeni mesaj yaz</button></div>';
        $html = preg_replace_callback('~<form\b[^>]*data-application[^>]*>.*?</form>~s', static fn() => $form, $html, 1) ?? $html;
        $phone = trim((string)($c['telefon'] ?? ''));
        $mail = trim((string)($c['destek_eposta'] ?? ''));
        $cards = '<ul class="vzc-info">';
        if ($phone !== '') $cards .= '<li><span aria-hidden="true">📞</span><div><small>Telefon</small><a href="tel:'.self::e(preg_replace('/[^0-9+]/', '', $phone) ?? '').'">'.self::e($phone).'</a></div></li>';
        if ($mail !== '') $cards .= '<li><span aria-hidden="true">✉️</span><div><small>E-posta</small><a href="mailto:'.self::e($mail).'">'.self::e($mail).'</a></div></li>';
        if (trim((string)($c['adres'] ?? '')) !== '') $cards .= '<li><span aria-hidden="true">📍</span><div><small>Adres</small><b>'.self::e((string)$c['adres']).'</b></div></li>';
        $cards .= '<li><span aria-hidden="true">⏱️</span><div><small>Yanıt süresi</small><b>Mesajlarınız iş günlerinde e-posta ile yanıtlanır.</b></div></li></ul>';
        $html = preg_replace('~(<header class="intro">.*?</header>)~s', '$1'.str_replace(['\\', '$'], ['\\\\', '\\$'], $cards), $html, 1) ?? $html;
        $html = str_replace('</head>', '<script src="/site-contact.js?v=1" type="module"></script></head>', $html);
        return $html;
    }
}
