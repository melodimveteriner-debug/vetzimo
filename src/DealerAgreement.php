<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * VetZimo Kullanım Sözleşmesi: bayi (deneme dahil) hesabı açılmadan önce elektronik olarak onaylanıp imzalanır.
 * Kayıt: imzalayan, imza görüntüsü, sözleşme sürümü, metnin SHA-256 özeti, IP, tarayıcı ve zaman (HMK 193 delil sözleşmesi).
 */
final class DealerAgreement
{
    public const SLUG = 'kullanim-sozlesmesi';

    public function __construct(private readonly PDO $db) {}

    public function current(): array
    {
        $legal = new SiteLegal($this->db);
        $doc = $legal->doc(self::SLUG);
        $render = SiteLegal::render($doc['body'], $legal->company());
        $summary = trim(html_entity_decode(strip_tags(SiteLegal::render($doc['summary'], $legal->company())['html'] ?? $doc['summary']), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        return ['title' => $doc['title'], 'summary' => $summary, 'version' => (int)$doc['version'], 'effective_on' => $doc['effective_on'],
            'html' => $render['html'] ?? '', 'hash' => hash('sha256', $doc['title']."\n".$doc['summary']."\n".$doc['body'])];
    }

    public function signed(string $partner): bool
    {
        try {
            $q = $this->db->prepare('SELECT 1 FROM dealer_agreement WHERE partner_id=? LIMIT 1');
            $q->execute([$partner]);
            return (bool)$q->fetchColumn();
        } catch (\PDOException) { return true; } // tablo kurulmamışsa mevcut kurulumları kilitleme
    }

    public function sign(string $partner, string $account, mixed $input, string $ip, string $agent, int $now): array
    {
        if (!is_object($input) || ($input->accepted ?? false) !== true) throw new RuntimeException('VetZimo Kullanım Sözleşmesi onaylanmadan hesap (deneme dahil) açılamaz.', 422);
        $name = trim(preg_replace('/\s+/u', ' ', (string)($input->name ?? '')) ?? '');
        $title = trim(mb_substr((string)($input->title ?? ''), 0, 120, 'UTF-8'));
        if (!preg_match('/\A[\p{L}][\p{L} .\'-]{2,119}\z/u', $name) || count(explode(' ', $name)) < 2) throw new RuntimeException('İmzalayan kişinin adını ve soyadını yazın.', 422);
        $signature = (string)($input->signature ?? '');
        if (strlen($signature) > 400100 || !preg_match('~\Adata:image/png;base64,([A-Za-z0-9+/=]+)\z~', $signature, $m) || strlen($m[1]) < 200) throw new RuntimeException('Sözleşmeyi imza alanına imzalayın.', 422);
        $png = base64_decode($m[1], true);
        if ($png === false || !str_starts_with($png, "\x89PNG\r\n\x1a\n")) throw new RuntimeException('İmza görüntüsü geçersiz.', 422);
        $doc = $this->current();
        if (is_string($input->hash ?? null) && $input->hash !== $doc['hash']) throw new RuntimeException('Sözleşme metni güncellendi. Sayfayı yenileyip güncel metni onaylayın.', 409);
        $this->db->prepare('INSERT INTO dealer_agreement(partner_id,account_id,version,text_hash,signer_name,signer_title,signature,ip,user_agent,signed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([$partner, $account, $doc['version'], $doc['hash'], $name, $title, $signature, mb_substr($ip, 0, 64), mb_substr($agent, 0, 300), $now]);
        $this->db->prepare('INSERT INTO clinic_audit(partner_id,account_id,action) VALUES (?,?,?)')->execute([$partner, $account, 'agreement.signed']);
        return ['version' => $doc['version'], 'signedAt' => $now];
    }

    /** Yönetici/bayi görünümü: imza kayıtları (imza görüntüsü dahil). */
    public function records(string $partner): array
    {
        $q = $this->db->prepare('SELECT id,version,text_hash,signer_name,signer_title,signature,ip,signed_at FROM dealer_agreement WHERE partner_id=? ORDER BY signed_at DESC LIMIT 20');
        $q->execute([$partner]);
        return array_map(static fn($r) => ['signed_at' => (int)$r['signed_at'], 'version' => (int)$r['version']] + $r, $q->fetchAll(PDO::FETCH_ASSOC));
    }
}
