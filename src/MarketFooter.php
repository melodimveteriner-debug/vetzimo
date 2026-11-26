<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

/**
 * Satış sitesinin alt bölümü: kapanış çağrısı, ürün / kurumsal / yasal bağlantı sütunları, şirket iletişim bilgileri
 * (Yasal Metinler › Şirket bilgileri'nden) ve güven rozetleri. Sunucuda tüm satış sayfalarının eski alt bölümünün
 * yerine yazılır; ayrı sayfa dosyalarını tek tek düzenlemek gerekmez. Betik kullanmaz.
 */
final class MarketFooter
{
    public static function apply(string $html, array $company, int $now): string
    {
        if (!str_contains($html, '<footer')) return $html;
        $footer = self::render($company, $now);
        $html = preg_replace_callback('~<footer\b[^>]*>.*?</footer>~s', static fn() => $footer, $html, 1) ?? $html;
        if (!str_contains($html, '/market-footer.css')) $html = str_replace('</head>', '<link rel="stylesheet" href="/market-footer.css?v=2"></head>', $html);
        return $html;
    }

    private static function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

    private static function links(string $title, array $items): string
    {
        $out = '<div class="mf-col"><h2 class="mf-head">'.self::e($title).'</h2><ul>';
        foreach ($items as [$label, $href, $attr]) $out .= '<li><a href="'.self::e($href).'"'.$attr.'>'.self::e($label).'</a></li>';
        return $out.'</ul></div>';
    }

    public static function render(array $c, int $now): string
    {
        $phone = trim((string)($c['telefon'] ?? ''));
        $mail = trim((string)($c['destek_eposta'] ?? ''));
        $tel = preg_replace('/[^0-9+]/', '', $phone) ?? '';
        $contact = '';
        if ($phone !== '') $contact .= '<li><span class="mf-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.3 15.3 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg></span><a href="tel:'.self::e($tel).'">'.self::e($phone).'</a></li>';
        if ($mail !== '') $contact .= '<li><span class="mf-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm8 7.2L4.4 7.5v.1L12 13l7.6-5.4v-.1z"/></svg></span><a href="mailto:'.self::e($mail).'">'.self::e($mail).'</a></li>';
        if (trim((string)($c['adres'] ?? '')) !== '') $contact .= '<li><span class="mf-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7zm0 9.5A2.5 2.5 0 1 0 12 6.5a2.5 2.5 0 0 0 0 5z"/></svg></span><span>'.self::e((string)$c['adres']).'</span></li>';
        $year = gmdate('Y', $now);
        return '<footer class="mk-footer">'
            .'<div class="mf-wrap mf-cta"><div><p class="mf-eyebrow">VetZimo ile tanışın</p><h2>Kliniğinizi bugün dijitale taşıyın</h2>'
            .'<p>Hasta kayıtları, randevular, aşı takibi, satış ve web siteniz tek panelde. Kurulum gerektirmez; telefon, tablet ve bilgisayarda çalışır.</p></div>'
            .'<div class="mf-cta-actions"><a class="mf-btn mf-btn-primary" href="/platform/deneme" data-ui-text="demo">Ücretsiz Demo</a><a class="mf-btn mf-btn-ghost" href="/platform/iletisim" data-ui-text="contact">İletişim</a></div></div>'
            .'<div class="mf-wrap mf-main">'
            .'<div class="mf-brand"><a class="mf-logo" href="/platform"><img src="/vetzimo-logo.webp" alt="VetZimo" width="156" height="44" loading="lazy"></a>'
            .'<p data-ui-text="platform">Veteriner klinik yönetim platformu</p><ul class="mf-contact">'.$contact.'</ul></div>'
            .self::links('Ürün', [['Özellikler', '/platform/ozellikler', ' data-ui-text="features"'], ['Çözümler', '/platform/cozumler', ' data-ui-text="solutions"'],
                ['Entegrasyonlar', '/platform/entegrasyonlar', ' data-ui-text="integrations"'], ['Paketler ve fiyatlar', '/platform/paketler', ' data-ui-text="pricing"'],
                ['Uygulama indir', '/platform/uygulama-indir', ' data-dl-nav']])
            .self::links('Kurumsal', [['Hakkımızda', '/platform/hakkimizda', ' data-ui-text="about"'], ['İletişim', '/platform/iletisim', ' data-ui-text="contact"'],
                ['Sık sorulanlar', '/platform/sss', ' data-ui-text="faq"'], ['Demo talebi', '/platform/demo', ''], ['Klinik girişi', '/app', ' data-ui-text="clinic"']])
            .self::links('Yasal', [['KVKK Aydınlatma', '/platform/yasal/kvkk-aydinlatma', ''], ['Gizlilik Politikası', '/platform/yasal/gizlilik-politikasi', ''],
                ['Kullanım Şartları', '/platform/yasal/kullanim-sartlari', ''], ['Çerez Politikası', '/platform/yasal/cerez-politikasi', ''],
                ['Başvuru bilgilendirmesi', '/platform/gizlilik', ' data-notice-open']])
            .'</div>'
            .'<div class="mf-wrap mf-trust" aria-label="Güvence"><span><b aria-hidden="true">🔒</b> SSL ile şifreli bağlantı</span><span><b aria-hidden="true">🛡️</b> KVKK aydınlatma ve açık rıza</span>'
            .'<span><b aria-hidden="true">📱</b> Telefon, tablet ve bilgisayarda</span><span><b aria-hidden="true">🇹🇷</b> Türkiye’de geliştirildi</span></div>'
            .'<div class="mf-wrap mf-bottom"><p><!-- vz-legal-foot -->© '.$year.' '.self::e((string)($c['marka'] ?? 'VetZimo')).'<!-- /vz-legal-foot --></p></div>'
            .'</footer>';
    }
}
