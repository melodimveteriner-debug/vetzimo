<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Bayinin Google işletme değerlendirme bağlantısı. Place ID girilirse yorum penceresini doğrudan açan
 * "search.google.com/local/writereview?placeid=..." bağlantısı üretilir; hazır g.page / maps bağlantısı da kabul edilir.
 */
final class ReviewLink
{
    public const DEFAULT_MESSAGE = '{klinik} olarak {hasta} için evinize gelmekten mutluluk duyduk. Değerli yorumunuzla bizi değerlendirir misiniz?';

    public function __construct(private readonly PDO $db) {}

    public static function normalize(string $input): string
    {
        $v = trim($input);
        if ($v === '') return '';
        if (preg_match('/\A(ChIJ|GhIJ|EiQ|Ei)[A-Za-z0-9_-]{10,200}\z/', $v)) return 'https://search.google.com/local/writereview?placeid='.$v;
        if (!preg_match('~\Ahttps://~i', $v)) $v = 'https://'.$v;
        $p = parse_url($v);
        $host = strtolower($p['host'] ?? '');
        $ok = preg_match('/(\A|\.)((google\.[a-z.]{2,8})|g\.page|goo\.gl|maps\.app\.goo\.gl|g\.co)\z/', $host);
        if (!$ok || strlen($v) > 500 || preg_match('/[\s<>"\']/', $v)) throw new RuntimeException('Google işletme yorum bağlantısı veya Place ID girin (g.page, maps.app.goo.gl, google.com/maps veya ChIJ… ile başlayan kimlik).', 422);
        // g.page/r/XXXX bağlantısının sonuna /review eklenirse yorum penceresi doğrudan açılır.
        if (preg_match('~\Ahttps://g\.page/r/[A-Za-z0-9_-]+/?\z~', $v)) $v = rtrim($v, '/').'/review';
        return $v;
    }

    public function get(string $partner): array
    {
        try { $r = $this->db->prepare('SELECT url,message,auto FROM partner_review_link WHERE partner_id=?'); $r->execute([$partner]); $row = $r->fetch(PDO::FETCH_ASSOC); }
        catch (\PDOException) { $row = false; }
        return ['url' => (string)($row['url'] ?? ''), 'message' => (string)(($row['message'] ?? '') ?: self::DEFAULT_MESSAGE), 'auto' => (bool)($row['auto'] ?? false)];
    }

    public function save(string $partner, object $b): array
    {
        $url = self::normalize((string)($b->url ?? ''));
        $msg = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($b->message ?? '')) ?? ''), 0, 300) ?: self::DEFAULT_MESSAGE;
        $this->db->prepare('INSERT INTO partner_review_link(partner_id,url,message,auto) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE url=VALUES(url),message=VALUES(message),auto=VALUES(auto)')
            ->execute([$partner, $url, $msg, !empty($b->auto) ? 1 : 0]);
        return $this->get($partner);
    }
}
