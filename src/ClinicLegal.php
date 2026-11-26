<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Klinik yasal metinleri (KVKK aydınlatma, açık rıza/iletişim izni, gizlilik, çerez, kullanım koşulları).
 *
 * Veri yükü yok denecek kadar azdır:
 * - Metinlerin tek ortak şablonu yönetim panelinde (SiteLegal, "klinik-" ön ekli) tutulur.
 * - Her klinik için yalnız küçük bir profil satırı (şirket bilgileri, logo, herkese açık anahtar) bulunur.
 * - Klinik metni yalnız bayi yöneticisi değiştirirse o metin için ayrı satır yazılır; değiştirmezse ortak şablon kullanılır.
 * - Yayımlanan sayfa her açılışta şablon + şirket bilgilerinden üretilir; "Son değişiklik" en yeni şablon/profil/metin zamanıdır.
 * Metinlerin içeriğinden ve uygulanmasından klinik (veri sorumlusu) sorumludur; VetZimo yalnız altyapı sağlar.
 */
final class ClinicLegal
{
    public const DOCS = [
        'kvkk-aydinlatma' => 'KVKK Aydınlatma',
        'acik-riza' => 'Açık Rıza ve İletişim İzni',
        'gizlilik-politikasi' => 'Gizlilik Politikası',
        'cerez-politikasi' => 'Çerez Politikası',
        'kullanim-kosullari' => 'Kullanım Koşulları',
    ];
    public const FIELDS = [
        'klinik' => ['Klinik adı', 160], 'unvan' => ['Ticari unvan / işletme sahibi', 200], 'adres' => ['Açık adres', 300],
        'telefon' => ['Telefon', 40], 'eposta' => ['E-posta', 160], 'kvkk_eposta' => ['KVKK başvuru e-postası', 160],
        'vergi' => ['Vergi dairesi ve numarası', 120], 'mersis' => ['MERSİS numarası', 40], 'kep' => ['KEP adresi', 160], 'web' => ['İnternet sitesi', 160],
    ];
    public const SAMPLE = [
        'klinik' => 'Örnek Veteriner Kliniği', 'unvan' => 'Örnek Veteriner Hizmetleri Ltd. Şti.', 'adres' => 'Atatürk Cad. No:1, Odunpazarı / Eskişehir',
        'telefon' => '0222 000 00 00', 'eposta' => 'iletisim@ornekklinik.com', 'kvkk_eposta' => 'kvkk@ornekklinik.com', 'vergi' => 'Odunpazarı VD · 1234567890',
        'mersis' => '', 'kep' => '', 'web' => 'www.ornekklinik.com',
    ];
    private const LOGO_BYTES = 400000;
    private static bool $ready = false;

    public function __construct(private readonly PDO $db, private readonly string $origin = '') {}

    private function ensure(): void
    {
        if (self::$ready) return;
        $this->db->exec("CREATE TABLE IF NOT EXISTS clinic_legal_profile (
            partner_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
            public_key CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            data TEXT NULL, logo MEDIUMBLOB NULL, logo_type VARCHAR(20) NULL,
            updated_at BIGINT NOT NULL DEFAULT 0, updated_by VARCHAR(160) NULL,
            UNIQUE KEY clinic_legal_key (public_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $this->db->exec("CREATE TABLE IF NOT EXISTS clinic_legal_doc (
            partner_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            slug VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            title VARCHAR(160) NOT NULL, body MEDIUMTEXT NOT NULL,
            updated_at BIGINT NOT NULL, updated_by VARCHAR(160) NULL,
            PRIMARY KEY (partner_id, slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        self::$ready = true;
    }

    public static function validSlug(mixed $slug): bool { return is_string($slug) && isset(self::DOCS[$slug]); }
    private static function e(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

    // ───────────────────────────── profil (şirket bilgileri) ─────────────────────────────
    private function row(string $partner): ?array
    {
        $this->ensure();
        $q = $this->db->prepare('SELECT partner_id,public_key,data,logo_type,updated_at,updated_by,logo IS NOT NULL AS has_logo FROM clinic_legal_profile WHERE partner_id=?');
        $q->execute([$partner]);
        return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /** Herkese açık kısa anahtar (bağlantı için); ilk ihtiyaçta bir kez oluşturulur. */
    public function key(string $partner): string
    {
        $row = $this->row($partner);
        if ($row) return $row['public_key'];
        $alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
        for ($try = 0; $try < 5; $try++) {
            $key = '';
            for ($i = 0; $i < 12; $i++) $key .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            try {
                $this->db->prepare('INSERT INTO clinic_legal_profile (partner_id,public_key,updated_at) VALUES (?,?,0)')->execute([$partner, $key]);
                return $key;
            } catch (\PDOException) {
                $row = $this->row($partner);
                if ($row) return $row['public_key'];
            }
        }
        throw new RuntimeException('Yasal metin bağlantısı oluşturulamadı.', 503);
    }

    public function url(string $partner, ?string $slug = null): string
    {
        return rtrim($this->origin, '/').'/yasal/'.$this->key($partner).($slug ? '/'.$slug : '');
    }

    private function partnerName(string $partner): string
    {
        try {
            $q = $this->db->prepare('SELECT name FROM partner_account WHERE id=?');
            $q->execute([$partner]);
            return (string)($q->fetchColumn() ?: '');
        } catch (\PDOException) { return ''; }
    }

    /** Metinlere yerleşecek şirket bilgileri; girilmeyen alan boş kalır (o satır metinde gösterilmez). */
    public function fields(string $partner, ?array $row = null): array
    {
        $row ??= $this->row($partner);
        $data = array_fill_keys(array_keys(self::FIELDS), '');
        $saved = $row && $row['data'] ? json_decode((string)$row['data'], true) : null;
        if (is_array($saved)) foreach (self::FIELDS as $k => $_) if (is_string($saved[$k] ?? null)) $data[$k] = $saved[$k];
        if ($data['klinik'] === '') $data['klinik'] = $this->partnerName($partner) ?: 'Kliniğimiz';
        return $data;
    }

    // ───────────────────────────── metinler ─────────────────────────────
    private static function ts(string $value): int
    {
        $t = strtotime($value.' UTC');
        return $t === false ? 0 : $t;
    }

    /** Kliniğin geçerli metni: kendi düzenlemesi > eski onay formu metni (yalnız KVKK) > ortak şablon. */
    public function doc(string $partner, string $slug, ?array $row = null): array
    {
        if (!self::validSlug($slug)) throw new RuntimeException('Yasal metin bulunamadı.', 404);
        $this->ensure();
        $template = (new SiteLegal($this->db))->doc('klinik-'.$slug);
        $templateTs = self::ts((string)$template['updated_at']);
        $q = $this->db->prepare('SELECT title,body,updated_at,updated_by FROM clinic_legal_doc WHERE partner_id=? AND slug=?');
        $q->execute([$partner, $slug]);
        $own = $q->fetch(PDO::FETCH_ASSOC);
        $out = ['slug' => $slug, 'title' => $template['title'], 'summary' => $template['summary'], 'body' => $template['body'], 'custom' => false,
            'templateBody' => $template['body'], 'templateTitle' => $template['title'], 'templateVersion' => (int)$template['version'], 'docTs' => $templateTs, 'by' => ''];
        if ($own) {
            $out = ['title' => $own['title'], 'body' => $own['body'], 'custom' => true, 'docTs' => (int)$own['updated_at'], 'by' => (string)$own['updated_by']] + $out;
        } elseif ($slug === 'kvkk-aydinlatma') {
            try {
                $legacy = $this->db->prepare('SELECT notice,updated_at FROM clinic_permit_setting WHERE partner_id=?');
                $legacy->execute([$partner]);
                $old = $legacy->fetch(PDO::FETCH_ASSOC);
                if ($old) $out = ['body' => (string)$old['notice'], 'custom' => true, 'docTs' => (int)$old['updated_at']] + $out;
            } catch (\PDOException) {}
        }
        $row ??= $this->row($partner);
        $out['changedAt'] = max($out['docTs'], (int)($row['updated_at'] ?? 0), $out['custom'] ? 0 : $templateTs);
        return $out;
    }

    /** Yer tutucuları şirket bilgileriyle doldurur; boş alan içeren satırları çıkarır (SiteLegal::render ile aynı kural). */
    public static function fill(string $markdown, array $fields): string
    {
        $out = [];
        foreach (preg_split('/\R/', $markdown) ?: [] as $line) {
            $missing = false;
            $line = preg_replace_callback('/\{([a-z_]+)\}/', static function ($m) use ($fields, &$missing) {
                if (!array_key_exists($m[1], $fields)) return $m[0];
                if ($fields[$m[1]] === '') { $missing = true; return ''; }
                return $fields[$m[1]];
            }, $line) ?? $line;
            if (!$missing) $out[] = $line;
        }
        return implode("\n", $out);
    }

    /** Onay formuna (ClientPermit) giren, doldurulmuş KVKK aydınlatma metni. */
    public function noticeText(string $partner): string
    {
        $doc = $this->doc($partner, 'kvkk-aydinlatma');
        return self::fill($doc['body'], $this->fields($partner));
    }

    // ───────────────────────────── klinik paneli ─────────────────────────────
    private static function guard(array $actor, bool $write): void
    {
        if (!in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true)) throw new RuntimeException('Klinik hesabı gerekli.', 403);
        if ($write && ($actor['role'] ?? '') !== 'dealer') throw new RuntimeException('Yasal metinleri ve şirket bilgilerini yalnız bayi yöneticisi (satın alan hesap) değiştirebilir.', 403);
    }

    public function overview(array $actor): array
    {
        self::guard($actor, false);
        $partner = (string)$actor['partner_id'];
        $key = $this->key($partner);
        $row = $this->row($partner);
        $saved = $row && $row['data'] ? json_decode((string)$row['data'], true) : null;
        $docs = [];
        foreach (self::DOCS as $slug => $label) {
            $d = $this->doc($partner, $slug, $row);
            $docs[] = ['slug' => $slug, 'label' => $label, 'title' => $d['title'], 'body' => $d['body'], 'custom' => $d['custom'], 'changedAt' => $d['changedAt'],
                'templateTitle' => $d['templateTitle'], 'templateBody' => $d['templateBody'], 'url' => rtrim($this->origin, '/').'/yasal/'.$key.'/'.$slug];
        }
        $fields = [];
        foreach (self::FIELDS as $k => [$label, $max]) $fields[] = ['key' => $k, 'label' => $label, 'max' => $max];
        return ['canEdit' => ($actor['role'] ?? '') === 'dealer', 'url' => rtrim($this->origin, '/').'/yasal/'.$key, 'filled' => is_array($saved),
            'company' => $this->fields($partner, $row), 'fields' => $fields, 'logo' => !empty($row['has_logo']) ? '/yasal/'.$key.'/logo?v='.(int)$row['updated_at'] : null,
            'updatedAt' => (int)($row['updated_at'] ?? 0), 'updatedBy' => (string)($row['updated_by'] ?? ''), 'docs' => $docs];
    }

    public function saveProfile(array $actor, object $input, int $now): array
    {
        self::guard($actor, true);
        $partner = (string)$actor['partner_id'];
        $this->key($partner);
        $data = [];
        foreach (self::FIELDS as $k => [$label, $max]) {
            $v = $input->company->$k ?? '';
            if (!is_string($v)) throw new RuntimeException($label.' geçersiz.', 422);
            $v = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v) ?? '');
            if (mb_strlen($v) > $max) throw new RuntimeException($label.' en fazla '.$max.' karakter olabilir.', 422);
            $data[$k] = $v;
        }
        foreach (['klinik', 'adres', 'telefon'] as $req) if ($data[$req] === '') throw new RuntimeException(self::FIELDS[$req][0].' boş bırakılamaz.', 422);
        foreach (['eposta', 'kvkk_eposta', 'kep'] as $mail) if ($data[$mail] !== '' && !filter_var($data[$mail], FILTER_VALIDATE_EMAIL)) throw new RuntimeException(self::FIELDS[$mail][0].' geçerli bir e-posta olmalı.', 422);
        $by = mb_substr((string)($actor['name'] ?? ''), 0, 160);
        $this->db->prepare('UPDATE clinic_legal_profile SET data=?,updated_at=?,updated_by=? WHERE partner_id=?')
            ->execute([json_encode($data, JSON_UNESCAPED_UNICODE), $now, $by, $partner]);
        $logo = $input->logo ?? null;
        if ($logo === false || $logo === '') {
            $this->db->prepare('UPDATE clinic_legal_profile SET logo=NULL,logo_type=NULL WHERE partner_id=?')->execute([$partner]);
        } elseif (is_string($logo)) {
            if (strlen($logo) > self::LOGO_BYTES * 1.4 || !preg_match('~\Adata:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)\z~D', $logo, $m)) throw new RuntimeException('Logo PNG, JPG veya WebP olmalı ve 400 KB\'ı aşmamalı.', 422);
            $bytes = base64_decode($m[2], true);
            $info = $bytes === false ? false : @getimagesizefromstring($bytes);
            if (!$info || !in_array($info['mime'], ['image/png', 'image/jpeg', 'image/webp'], true) || strlen($bytes) > self::LOGO_BYTES || $info[0] < 32 || $info[1] < 32 || $info[0] > 4000 || $info[1] > 4000) {
                throw new RuntimeException('Logo görseli geçersiz (32–4000 piksel, en fazla 400 KB).', 422);
            }
            $this->db->prepare('UPDATE clinic_legal_profile SET logo=?,logo_type=? WHERE partner_id=?')->execute([$bytes, $info['mime'], $partner]);
        }
        return $this->overview($actor);
    }

    public function saveDoc(array $actor, object $input, int $now): array
    {
        self::guard($actor, true);
        $slug = $input->slug ?? null;
        if (!self::validSlug($slug)) throw new RuntimeException('Yasal metin seçin.', 422);
        $partner = (string)$actor['partner_id'];
        $this->key($partner);
        if (($input->reset ?? false) === true) {
            $this->db->prepare('DELETE FROM clinic_legal_doc WHERE partner_id=? AND slug=?')->execute([$partner, $slug]);
            if ($slug === 'kvkk-aydinlatma') {
                try { $this->db->prepare('DELETE FROM clinic_permit_setting WHERE partner_id=?')->execute([$partner]); } catch (\PDOException) {}
            }
            // Ortak şablona dönüş de bir değişikliktir: son değişiklik tarihi güncellenir.
            $this->db->prepare('UPDATE clinic_legal_profile SET updated_at=GREATEST(updated_at,?) WHERE partner_id=?')->execute([$now, $partner]);
            return $this->overview($actor);
        }
        $title = is_string($input->title ?? null) ? trim($input->title) : '';
        $body = is_string($input->body ?? null) ? trim(str_replace("\r\n", "\n", $input->body))."\n" : '';
        if ($title === '' || mb_strlen($title) > 160) throw new RuntimeException('Başlık 1-160 karakter olmalı.', 422);
        if (mb_strlen(trim($body)) < 200 || strlen($body) > 100000) throw new RuntimeException('Metin 200 karakterden kısa olamaz ve 100 KB\'ı aşamaz.', 422);
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $title.$body)) throw new RuntimeException('Metinde geçersiz karakter var.', 422);
        $by = mb_substr((string)($actor['name'] ?? ''), 0, 160);
        $this->db->prepare('INSERT INTO clinic_legal_doc (partner_id,slug,title,body,updated_at,updated_by) VALUES (?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE title=VALUES(title),body=VALUES(body),updated_at=VALUES(updated_at),updated_by=VALUES(updated_by)')
            ->execute([$partner, $slug, $title, $body, $now, $by]);
        if ($slug === 'kvkk-aydinlatma') {
            try { $this->db->prepare('DELETE FROM clinic_permit_setting WHERE partner_id=?')->execute([$partner]); } catch (\PDOException) {}
        }
        return $this->overview($actor);
    }

    // ───────────────────────────── herkese açık sayfa ─────────────────────────────
    private function byKey(string $key): ?array
    {
        if (!preg_match('/\A[a-z0-9]{12}\z/', $key)) return null;
        $this->ensure();
        $q = $this->db->prepare('SELECT partner_id,public_key,data,logo_type,updated_at,updated_by,logo IS NOT NULL AS has_logo FROM clinic_legal_profile WHERE public_key=?');
        $q->execute([$key]);
        return $q->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function logo(string $key): never
    {
        $row = $this->byKey($key);
        if (!$row || empty($row['has_logo'])) throw new RuntimeException('Logo bulunamadı.', 404);
        $q = $this->db->prepare('SELECT logo,logo_type FROM clinic_legal_profile WHERE public_key=?');
        $q->execute([$key]);
        $l = $q->fetch(PDO::FETCH_ASSOC);
        header('Content-Type: '.$l['logo_type']);
        header('Cache-Control: public, max-age=86400');
        header('X-Content-Type-Options: nosniff');
        echo $l['logo'];
        exit;
    }

    private static function stamp(int $ts): string
    {
        $months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        $d = (new \DateTimeImmutable('@'.max(0, $ts)))->setTimezone(new \DateTimeZone('Europe/Istanbul'));
        return (int)$d->format('j').' '.$months[(int)$d->format('n') - 1].' '.$d->format('Y').', saat '.$d->format('H:i');
    }

    /** Yasal metinler sayfası (tek sayfa, sekmeli). embed=true: VetZimo panelinin içinde, kendi üst alanı sade. */
    public function page(string $key, ?string $slug, bool $embed = false): string
    {
        $row = $this->byKey($key);
        if (!$row) throw new RuntimeException('Sayfa bulunamadı.', 404);
        if ($slug !== null && !self::validSlug($slug)) throw new RuntimeException('Sayfa bulunamadı.', 404);
        $partner = (string)$row['partner_id'];
        $fields = $this->fields($partner, $row);
        $slug ??= 'kvkk-aydinlatma';
        $doc = $this->doc($partner, $slug, $row);
        $latest = 0;
        foreach (array_keys(self::DOCS) as $s) $latest = max($latest, $this->doc($partner, $s, $row)['changedAt']);
        $render = SiteLegal::render($doc['body'], $fields);
        $summary = $doc['summary'] !== '' && !$doc['custom'] ? SiteLegal::render(self::fill($doc['summary'], $fields), [])['html'] : '';
        $nav = '';
        foreach (self::DOCS as $s => $label) $nav .= '<a href="/yasal/'.$key.'/'.$s.($embed ? '?panel=1' : '').'"'.($s === $slug ? ' aria-current="page"' : '').'>'.self::e($label).'</a>';
        $toc = '';
        foreach ($render['toc'] as $item) $toc .= '<li><a href="#'.$item['id'].'">'.self::e($item['text']).'</a></li>';
        $logo = !empty($row['has_logo']) ? '<img class="cl-logo" src="/yasal/'.$key.'/logo?v='.(int)$row['updated_at'].'" alt="'.self::e($fields['klinik']).' logosu" width="64" height="64">' : '<span class="cl-logo cl-logo-text" aria-hidden="true">'.self::e(mb_strtoupper(mb_substr($fields['klinik'], 0, 1))).'</span>';
        $contact = '';
        foreach (['adres' => 'Adres', 'telefon' => 'Telefon', 'eposta' => 'E-posta', 'kvkk_eposta' => 'KVKK başvuru', 'web' => 'İnternet sitesi'] as $k => $label) {
            if ($fields[$k] !== '') $contact .= '<li><span>'.self::e($label).'</span><b>'.self::e($fields[$k]).'</b></li>';
        }
        $title = self::e($doc['title']).' · '.self::e($fields['klinik']);
        $html = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            .'<title>'.$title.'</title><meta name="description" content="'.self::e($fields['klinik'].' yasal metinleri: KVKK aydınlatma, açık rıza ve iletişim izni, gizlilik, çerez ve kullanım koşulları.').'">'
            .'<link rel="icon" href="/favicon.ico?v=51" type="image/x-icon"><link rel="stylesheet" href="/clinic-legal-page.css?v=1"></head>'
            .'<body class="'.($embed ? 'cl-embed' : '').'"><main class="cl">'
            .'<header class="cl-head">'.$logo.'<div><span class="cl-eyebrow">Yasal Metinler</span><h1>'.self::e($fields['klinik']).'</h1>'
            .($fields['unvan'] !== '' && $fields['unvan'] !== $fields['klinik'] ? '<p>'.self::e($fields['unvan']).'</p>' : '').'</div></header>'
            .'<p class="cl-stamp"><b>Son değişiklik:</b> <time datetime="'.gmdate('c', $doc['changedAt']).'">'.self::e(self::stamp($doc['changedAt'])).'</time>'
            .($latest > $doc['changedAt'] ? '<span>Tüm metinlerde en son değişiklik: '.self::e(self::stamp($latest)).'</span>' : '').'</p>'
            .'<nav class="cl-tabs" aria-label="Yasal metinler">'.$nav.'</nav>'
            .'<div class="cl-layout"><article class="cl-doc"><h2 class="cl-title">'.self::e($doc['title']).'</h2>'.($summary !== '' ? '<div class="cl-summary">'.$summary.'</div>' : '').$render['html'].'</article>'
            .'<aside class="cl-side">'.($toc !== '' ? '<details class="cl-toc" open><summary>Bu metinde</summary><ol>'.$toc.'</ol></details>' : '')
            .'<section class="cl-card"><h3>Veri sorumlusu</h3><p><b>'.self::e($fields['klinik']).'</b></p><ul class="cl-contact">'.$contact.'</ul></section>'
            .'<section class="cl-card cl-resp"><h3>Sorumluluk</h3><p>Bu sayfadaki metinler <b>'.self::e($fields['klinik']).'</b> tarafından yayımlanmıştır. Klinik hizmetleri, size gönderilen SMS, WhatsApp ve e-posta iletileri ile kişisel verilerinizin işlenmesinden klinik sorumludur. Talep ve şikâyetleriniz için lütfen doğrudan klinikle iletişime geçiniz.</p>'
            .'<p class="cl-muted">VetZimo, kliniğe yalnızca yazılım ve barındırma altyapısı sağlayan veri işleyendir; kliniğin hizmetlerinden ve iletilerinden sorumlu değildir.</p></section></aside></div>'
            .'<footer class="cl-foot">© '.gmdate('Y').' '.self::e($fields['klinik']).' · Altyapı: VetZimo</footer></main></body></html>';
        return $html;
    }

    public function etag(string $key, ?string $slug): string
    {
        $row = $this->byKey($key);
        if (!$row) return '';
        $parts = [(string)$row['updated_at'], (string)$slug];
        foreach (array_keys(self::DOCS) as $s) $parts[] = (string)$this->doc((string)$row['partner_id'], $s, $row)['changedAt'];
        return '"'.substr(hash('sha256', implode('|', $parts)), 0, 20).'"';
    }
}
