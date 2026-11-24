<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/** Satış sitesindeki yasal metinler: KVKK, gizlilik, kullanım şartları, çerez. Sürüm geçmişiyle saklanır. */
final class SiteLegal
{
    public const DOCS = [
        'kvkk-aydinlatma' => 'KVKK Aydınlatma Metni',
        'gizlilik-politikasi' => 'Gizlilik Politikası',
        'kullanim-sartlari' => 'Kullanım Şartları',
        'cerez-politikasi' => 'Çerez Politikası',
    ];
    public const SHORT = [
        'kvkk-aydinlatma' => 'KVKK Aydınlatma',
        'gizlilik-politikasi' => 'Gizlilik Politikası',
        'kullanim-sartlari' => 'Kullanım Şartları',
        'cerez-politikasi' => 'Çerez Politikası',
    ];
    public const COMPANY_FIELDS = [
        'marka' => ['Marka', 120], 'unvan' => ['Ticaret unvanı', 200], 'adres' => ['Adres', 300],
        'mersis' => ['MERSİS numarası', 40], 'vergi' => ['Vergi dairesi ve numarası', 120], 'kep' => ['KEP adresi', 160],
        'kvkk_eposta' => ['KVKK başvuru e-postası', 160], 'destek_eposta' => ['Destek e-postası', 160],
        'telefon' => ['Telefon', 40], 'web' => ['İnternet sitesi', 120],
    ];
    public const COMPANY_DEFAULTS = [
        'marka' => 'Vetzimo.com', 'unvan' => 'Zimo Soft Yazılım Tasarım İthalat İhracat A.Ş.', 'adres' => 'Odunpazarı / Eskişehir',
        'mersis' => '', 'vergi' => '', 'kep' => '', 'kvkk_eposta' => 'kvkk@vetzimo.com', 'destek_eposta' => 'destek@vetzimo.com',
        'telefon' => '', 'web' => 'www.vetzimo.com',
    ];
    public const DEFAULT_DATE = '2026-11-24';
    private const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

    public function __construct(private PDO $db) {}

    public static function validSlug(mixed $slug): bool
    {
        return is_string($slug) && isset(self::DOCS[$slug]);
    }

    public function company(): array
    {
        $data = self::COMPANY_DEFAULTS;
        try {
            $raw = $this->db->query('SELECT data FROM site_legal_company WHERE id=1')->fetchColumn();
        } catch (\PDOException) { $raw = false; }
        if (is_string($raw)) {
            $saved = json_decode($raw, true);
            if (is_array($saved)) foreach (self::COMPANY_FIELDS as $key => $_) if (isset($saved[$key]) && is_string($saved[$key])) $data[$key] = $saved[$key];
        }
        return $data;
    }

    public function saveCompany(mixed $input, int $now): array
    {
        if (!is_object($input) && !is_array($input)) throw new RuntimeException('Şirket bilgileri geçersiz.', 422);
        $input = (array)$input;
        $data = [];
        foreach (self::COMPANY_FIELDS as $key => [$label, $max]) {
            $value = $input[$key] ?? '';
            if (!is_string($value)) throw new RuntimeException($label.' geçersiz.', 422);
            $value = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) ?? '');
            if (mb_strlen($value) > $max) throw new RuntimeException($label.' en fazla '.$max.' karakter olabilir.', 422);
            $data[$key] = $value;
        }
        foreach (['marka', 'unvan', 'adres'] as $required) if ($data[$required] === '') throw new RuntimeException(self::COMPANY_FIELDS[$required][0].' boş bırakılamaz.', 422);
        foreach (['kvkk_eposta', 'destek_eposta'] as $mail) if ($data[$mail] !== '' && !filter_var($data[$mail], FILTER_VALIDATE_EMAIL)) throw new RuntimeException(self::COMPANY_FIELDS[$mail][0].' geçerli bir e-posta olmalı.', 422);
        $this->db->prepare('INSERT INTO site_legal_company (id,data,updated_at) VALUES (1,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updated_at=VALUES(updated_at)')
            ->execute([json_encode($data, JSON_UNESCAPED_UNICODE), gmdate('Y-m-d H:i:s', $now)]);
        return $data;
    }

    /** Varsayılan metni dosyadan okur: ilk satır "# Başlık", ardından "> özet", geri kalanı gövde. */
    public static function defaults(string $slug): array
    {
        $raw = (string)@file_get_contents(__DIR__.'/legal-defaults/'.$slug.'.md');
        $lines = preg_split('/\R/', $raw) ?: [];
        $title = self::DOCS[$slug];
        $summary = '';
        if ($lines && str_starts_with($lines[0], '# ')) $title = trim(substr(array_shift($lines), 2));
        while ($lines && trim($lines[0]) === '') array_shift($lines);
        if ($lines && str_starts_with($lines[0], '> ')) $summary = trim(substr(array_shift($lines), 2));
        return ['slug' => $slug, 'title' => $title, 'summary' => $summary, 'body' => trim(implode("\n", $lines))."\n",
            'version' => 1, 'effective_on' => self::DEFAULT_DATE, 'updated_at' => self::DEFAULT_DATE.' 00:00:00', 'updated_by' => '', 'stored' => false];
    }

    public function doc(string $slug): array
    {
        if (!self::validSlug($slug)) throw new RuntimeException('Yasal metin bulunamadı.', 404);
        try {
            $q = $this->db->prepare('SELECT slug,title,summary,body,version,effective_on,updated_at,updated_by FROM site_legal_doc WHERE slug=?');
            $q->execute([$slug]);
            $row = $q->fetch(PDO::FETCH_ASSOC);
        } catch (\PDOException) { $row = false; }
        if (!$row) return self::defaults($slug);
        $row['version'] = (int)$row['version'];
        $row['stored'] = true;
        return $row;
    }

    public function revisions(string $slug, bool $withBody = false): array
    {
        try {
            $q = $this->db->prepare('SELECT version,title,effective_on,note,created_at,created_by'.($withBody ? ',summary,body' : '').' FROM site_legal_revision WHERE slug=? ORDER BY version DESC LIMIT 50');
            $q->execute([$slug]);
            $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException) { $rows = []; }
        foreach ($rows as &$row) $row['version'] = (int)$row['version'];
        return $rows;
    }

    public function admin(): array
    {
        $docs = [];
        foreach (array_keys(self::DOCS) as $slug) {
            $doc = $this->doc($slug);
            $doc['url'] = '/platform/yasal/'.$slug;
            $doc['revisions'] = $this->revisions($slug);
            $docs[] = $doc;
        }
        $fields = [];
        foreach (self::COMPANY_FIELDS as $key => [$label, $max]) $fields[] = ['key' => $key, 'label' => $label, 'max' => $max];
        return ['docs' => $docs, 'company' => $this->company(), 'companyFields' => $fields];
    }

    public function save(mixed $input, string $editor, int $now): array
    {
        if (!is_object($input)) throw new RuntimeException('İstek geçersiz.', 422);
        $slug = $input->slug ?? null;
        if (!self::validSlug($slug)) throw new RuntimeException('Yasal metin seçin.', 422);
        $title = is_string($input->title ?? null) ? trim($input->title) : '';
        $summary = is_string($input->summary ?? null) ? trim($input->summary) : '';
        $body = is_string($input->body ?? null) ? str_replace("\r\n", "\n", $input->body) : '';
        $note = is_string($input->note ?? null) ? trim($input->note) : '';
        $date = $input->effectiveOn ?? '';
        if ($title === '' || mb_strlen($title) > 160) throw new RuntimeException('Başlık 1-160 karakter olmalı.', 422);
        if (mb_strlen($summary) > 400) throw new RuntimeException('Özet en fazla 400 karakter olabilir.', 422);
        if (trim($body) === '' || strlen($body) > 200000) throw new RuntimeException('Metin boş olamaz ve 200 KB sınırını aşamaz.', 422);
        if (mb_strlen($note) > 300) throw new RuntimeException('Değişiklik notu en fazla 300 karakter olabilir.', 422);
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $title.$summary.$body.$note)) throw new RuntimeException('Metinde geçersiz karakter var.', 422);
        $today = gmdate('Y-m-d', $now + 3 * 3600);
        if ($date === '' || $date === null) $date = $today;
        if (!is_string($date) || !preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $date) || !checkdate((int)substr($date, 5, 2), (int)substr($date, 8, 2), (int)substr($date, 0, 4))) throw new RuntimeException('Düzenlenme tarihi geçersiz.', 422);
        if ($date > gmdate('Y-m-d', $now + 3 * 3600 + 366 * 86400)) throw new RuntimeException('Düzenlenme tarihi en fazla bir yıl ileri olabilir.', 422);
        $editor = mb_substr($editor, 0, 160);
        $stamp = gmdate('Y-m-d H:i:s', $now);
        $this->db->beginTransaction();
        try {
            $q = $this->db->prepare('SELECT version FROM site_legal_doc WHERE slug=? FOR UPDATE');
            $q->execute([$slug]);
            $current = $q->fetchColumn();
            if ($current === false) {
                // İlk kayıtta varsayılan metni 1. sürüm olarak geçmişe yazar; böylece yayımlanmış ilk metin kaybolmaz.
                $base = self::defaults($slug);
                $this->db->prepare('INSERT INTO site_legal_revision (slug,version,title,summary,body,effective_on,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([$slug, 1, $base['title'], $base['summary'], $base['body'], $base['effective_on'], 'İlk yayın', $stamp, 'Sistem']);
                $current = 1;
            }
            $expected = $input->version ?? null;
            if ($expected !== null && (int)$expected !== (int)$current) throw new RuntimeException('Bu metin siz düzenlerken başka biri tarafından güncellendi. Sayfayı yenileyip tekrar deneyin.', 409);
            $version = (int)$current + 1;
            $this->db->prepare('INSERT INTO site_legal_revision (slug,version,title,summary,body,effective_on,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$slug, $version, $title, $summary, $body, $date, $note, $stamp, $editor]);
            $this->db->prepare('INSERT INTO site_legal_doc (slug,title,summary,body,version,effective_on,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE title=VALUES(title),summary=VALUES(summary),body=VALUES(body),version=VALUES(version),effective_on=VALUES(effective_on),updated_at=VALUES(updated_at),updated_by=VALUES(updated_by)')
                ->execute([$slug, $title, $summary, $body, $version, $date, $stamp, $editor]);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
        return $this->doc($slug);
    }

    /** Alt alandaki telif ve şirket satırı (yönetim panelindeki şirket bilgilerinden). */
    public function footerLine(int $now): string
    {
        $c = $this->company();
        return '© '.gmdate('Y', $now).' '.self::e($c['marka']).' · '.self::e($c['unvan']).' · '.self::e($c['adres']);
    }

    public function applyFooter(string $html, int $now): string
    {
        $line = $this->footerLine($now);
        return preg_replace_callback('~<!-- vz-legal-foot -->.*?<!-- /vz-legal-foot -->~s', static fn() => '<!-- vz-legal-foot -->'.$line.'<!-- /vz-legal-foot -->', $html) ?? $html;
    }

    public static function longDate(string $date): string
    {
        $t = strtotime(substr($date, 0, 10).' 00:00:00 UTC');
        if ($t === false) return $date;
        return (int)gmdate('j', $t).' '.self::MONTHS[(int)gmdate('n', $t) - 1].' '.gmdate('Y', $t);
    }

    private static function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
    }

    private static function inline(string $text, array $company): ?string
    {
        $missing = false;
        $out = preg_replace_callback('/\{([a-z_]+)\}/', static function ($m) use ($company, &$missing) {
            if (!array_key_exists($m[1], $company)) return $m[0];
            if ($company[$m[1]] === '') { $missing = true; return ''; }
            return "\x01".$m[1]."\x02";
        }, $text) ?? $text;
        if ($missing) return null;
        $html = self::e($out);
        $html = preg_replace('/\*\*(.+?)\*\*/u', '<strong>$1</strong>', $html) ?? $html;
        return preg_replace_callback('/\x01([a-z_]+)\x02/', static function ($m) use ($company) {
            $value = self::e($company[$m[1]]);
            if (in_array($m[1], ['kvkk_eposta', 'destek_eposta', 'kep'], true) && filter_var($company[$m[1]], FILTER_VALIDATE_EMAIL)) return '<a href="mailto:'.$value.'">'.$value.'</a>';
            return $value;
        }, $html) ?? $html;
    }

    public static function anchor(string $text): string
    {
        $map = ['ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'İ' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u', 'Ç' => 'c', 'Ğ' => 'g', 'Ö' => 'o', 'Ş' => 's', 'Ü' => 'u'];
        $slug = strtolower(strtr($text, $map));
        $slug = trim(preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '', '-');
        return $slug !== '' ? substr($slug, 0, 60) : 'bolum';
    }

    /** Sade biçimlendirmeyi güvenli HTML'e çevirir: ## başlık, ### alt başlık, - madde, > not, **kalın**, {alan}. */
    public static function render(string $body, array $company): array
    {
        $html = '';
        $toc = [];
        $list = false;
        $used = [];
        foreach (preg_split('/\R/', $body) ?: [] as $line) {
            $line = rtrim($line);
            $kind = 'p';
            $text = $line;
            if (str_starts_with($line, '### ')) { $kind = 'h3'; $text = substr($line, 4); }
            elseif (str_starts_with($line, '## ')) { $kind = 'h2'; $text = substr($line, 3); }
            elseif (str_starts_with($line, '- ')) { $kind = 'li'; $text = substr($line, 2); }
            elseif (str_starts_with($line, '> ')) { $kind = 'note'; $text = substr($line, 2); }
            if ($kind !== 'li' && $list) { $html .= '</ul>'; $list = false; }
            if (trim($text) === '') continue;
            $inner = self::inline(trim($text), $company);
            if ($inner === null) continue;
            if ($kind === 'h2' || $kind === 'h3') {
                $id = self::anchor(strip_tags($inner));
                $base = $id; $n = 2;
                while (isset($used[$id])) $id = $base.'-'.$n++;
                $used[$id] = true;
                if ($kind === 'h2') $toc[] = ['id' => $id, 'text' => html_entity_decode(strip_tags($inner), ENT_QUOTES, 'UTF-8')];
                $html .= '<'.$kind.' id="'.$id.'">'.$inner.'</'.$kind.'>';
            } elseif ($kind === 'li') {
                if (!$list) { $html .= '<ul>'; $list = true; }
                $html .= '<li>'.$inner.'</li>';
            } elseif ($kind === 'note') {
                $html .= '<p class="lg-note">'.$inner.'</p>';
            } else {
                $html .= '<p>'.$inner.'</p>';
            }
        }
        if ($list) $html .= '</ul>';
        return ['html' => $html, 'toc' => $toc];
    }

    public function mainHtml(?string $slug): array
    {
        $company = $this->company();
        $nav = '';
        foreach (self::DOCS as $key => $label) {
            $nav .= '<a href="/platform/yasal/'.$key.'"'.($key === $slug ? ' aria-current="page"' : '').'>'.self::e(self::SHORT[$key]).'</a>';
        }
        $card = '<div class="lg-company"><strong>'.self::e($company['unvan']).'</strong><span>'.self::e($company['adres']).'</span>'
            .($company['mersis'] !== '' ? '<span>MERSİS: '.self::e($company['mersis']).'</span>' : '')
            .($company['vergi'] !== '' ? '<span>Vergi: '.self::e($company['vergi']).'</span>' : '')
            .($company['kep'] !== '' ? '<span>KEP: '.self::e($company['kep']).'</span>' : '')
            .($company['kvkk_eposta'] !== '' ? '<span>KVKK: <a href="mailto:'.self::e($company['kvkk_eposta']).'">'.self::e($company['kvkk_eposta']).'</a></span>' : '')
            .($company['telefon'] !== '' ? '<span>Telefon: '.self::e($company['telefon']).'</span>' : '').'</div>';
        if ($slug === null) {
            $cards = '';
            foreach (self::DOCS as $key => $label) {
                $doc = $this->doc($key);
                $cards .= '<a class="lg-card" href="/platform/yasal/'.$key.'"><span class="lg-date">Düzenlenme: '.self::e(self::longDate($doc['effective_on'])).' · Sürüm '.$doc['version'].'</span><h2>'.self::e($doc['title']).'</h2><p>'.self::e(mb_strimwidth($doc['summary'], 0, 220, '…')).'</p><span class="lg-more">Metni oku →</span></a>';
            }
            $main = '<header class="intro lg-intro"><div class="lp-mesh" aria-hidden="true"><i></i><i></i><i></i></div><span class="eyebrow">YASAL</span><h1>Yasal metinler</h1><p>'
                .self::e($company['marka']).' hizmetlerine ilişkin aydınlatma, gizlilik, kullanım ve çerez metinleri. Her metnin düzenlenme tarihi ve sürümü kartın üstünde yer alır.</p></header>'
                .'<section class="lg-grid">'.$cards.'</section>'.$card;
            return ['title' => 'Yasal metinler', 'description' => $company['marka'].' KVKK aydınlatma metni, gizlilik politikası, kullanım şartları ve çerez politikası.', 'main' => $main];
        }
        $doc = $this->doc($slug);
        $rendered = self::render($doc['body'], $company);
        $summary = $doc['summary'] !== '' ? (self::inline($doc['summary'], $company) ?? '') : '';
        $toc = '';
        foreach ($rendered['toc'] as $item) $toc .= '<li><a href="#'.$item['id'].'">'.self::e($item['text']).'</a></li>';
        $history = '';
        foreach ($this->revisions($slug) as $rev) {
            $history .= '<li><span>Sürüm '.$rev['version'].'</span><time datetime="'.self::e($rev['effective_on']).'">'.self::e(self::longDate($rev['effective_on'])).'</time>'
                .($rev['note'] !== '' ? '<em>'.self::e($rev['note']).'</em>' : '').'</li>';
        }
        if ($history === '') $history = '<li><span>Sürüm 1</span><time datetime="'.self::e($doc['effective_on']).'">'.self::e(self::longDate($doc['effective_on'])).'</time><em>İlk yayın</em></li>';
        $date = self::longDate($doc['effective_on']);
        $main = '<header class="intro lg-intro"><div class="lp-mesh" aria-hidden="true"><i></i><i></i><i></i></div>'
            .'<p class="lg-stamp"><time datetime="'.self::e($doc['effective_on']).'"><b>Düzenlenme tarihi:</b> '.self::e($date).'</time><span>Sürüm '.$doc['version'].'</span></p>'
            .'<span class="eyebrow">YASAL · '.self::e(mb_strtoupper(self::SHORT[$slug], 'UTF-8')).'</span><h1>'.self::e($doc['title']).'</h1>'
            .($summary !== '' ? '<p>'.$summary.'</p>' : '').'</header>'
            .'<div class="lg-layout"><aside class="lg-side"><nav class="lg-docs" aria-label="Yasal metinler">'.$nav.'</nav>'
            .($toc !== '' ? '<details class="lg-toc" open><summary>Bu sayfada</summary><ol>'.$toc.'</ol></details>' : '').'</aside>'
            .'<article class="lg-article">'.$rendered['html']
            .'<section class="lg-history" aria-labelledby="lg-history-title"><h2 id="lg-history-title">Sürüm geçmişi</h2><ul>'.$history.'</ul></section>'
            .$card.'</article></div>';
        $description = $doc['summary'] !== '' ? mb_strimwidth(strip_tags($summary), 0, 160, '…') : $doc['title'];
        return ['title' => $doc['title'], 'description' => html_entity_decode($description, ENT_QUOTES, 'UTF-8'), 'main' => $main];
    }

    /** Hakkımızda sayfasının kabuğunu (üst menü, alt alan, tema) kullanarak yasal sayfayı üretir. */
    public function page(?string $slug, string $shell): string
    {
        $data = $this->mainHtml($slug);
        $html = preg_replace_callback('~<main id="icerik"[^>]*>.*</main>~s', static fn() => '<main id="icerik" class="lp lp-sub lp-no-js lg-page">'.$data['main'].'</main>', $shell, 1) ?? $shell;
        $title = self::e($data['title']);
        $html = preg_replace_callback('~<title>.*?</title>~s', static fn() => '<title>'.$title.' · VetZimo</title>', $html, 1) ?? $html;
        $html = preg_replace_callback('~<meta name="description" content="[^"]*">~', static fn() => '<meta name="description" content="'.self::e($data['description']).'">', $html, 1) ?? $html;
        return $this->applyFooter(str_replace('</head>', '<link rel="stylesheet" href="/legal.css?v=1"></head>', $html), time());
    }
}
