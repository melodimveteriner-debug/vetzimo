<?php
declare(strict_types=1);

namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/**
 * Bayinin yaşam döngüsü:
 * - renewal(): uygulamanın üst uyarı şeridi için kalan gün / son tarih (demo ve 30 günden az kalan abonelik).
 * - sweep(): süresi biten bayi ve demonun girişi hemen kapanır; veriler 30 gün saklanır, sonra kalıcı olarak silinir.
 * - purge(): yönetici (şifre + iki adımlı doğrulama sonrası) bayiyi ve şubelerini tüm verileriyle veritabanından siler.
 *   VetZimo bayiye ait dosyaları diskte tutmaz (görseller, ekler, web sitesi medyası veritabanındadır); silme tamdır.
 */
final class PartnerLifecycle
{
    public const RETENTION_DAYS = 30;
    public const WARN_DAYS = 30;
    private const CHUNK = 5000;

    public function __construct(private readonly PDO $db) {}

    private static function today(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('today', new \DateTimeZone('Europe/Istanbul'));
    }

    /** Geçerli ve planlanmış dönemlerin bittiği son gün; hiç dönem yoksa null. */
    private function terms(string $partner): array
    {
        $q = $this->db->prepare('SELECT plan_id,plan_name,kind,starts_on,ends_on FROM clinic_subscription WHERE partner_id=? ORDER BY ends_on DESC');
        $q->execute([$partner]);
        return $q->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Uygulama üst şeridi: demo veya bitişe 30 günden az kalan abonelik ya da saklama süresindeki bayi. */
    public function renewal(string $partner): ?array
    {
        $today = self::today();
        $day = $today->format('Y-m-d');
        $all = $this->terms($partner);
        $terms = array_values(array_filter($all, static fn($t) => $t['kind'] !== 'upgrade'));
        if (!$terms) return null;
        $upgrade = null;
        foreach ($all as $t) if ($t['kind'] === 'upgrade' && $t['starts_on'] <= $day && $t['ends_on'] >= $day) {
            $upgrade = ['plan' => (string)$t['plan_name'], 'ends' => $t['ends_on'],
                'days' => (int)$today->diff(new \DateTimeImmutable($t['ends_on'], new \DateTimeZone('Europe/Istanbul')))->days];
        }
        $result = $this->renewalOf($terms, $today, $day);
        if ($upgrade) {
            foreach ($terms as $t) if ($t['starts_on'] <= $day && $t['ends_on'] >= $day) { $upgrade['base'] = (string)$t['plan_name']; break; }
            return ($result ?? ['state' => 'upgrade']) + ['upgrade' => $upgrade];
        }
        return $result;
    }

    private function renewalOf(array $terms, \DateTimeImmutable $today, string $day): ?array
    {
        $live = array_values(array_filter($terms, static fn($t) => $t['ends_on'] >= $day));
        if ($live) {
            $end = max(array_column($live, 'ends_on'));
            $current = null;
            foreach ($live as $t) if ($t['starts_on'] <= $day) { $current = $t; break; }
            $current ??= $live[0];
            $days = (int)$today->diff(new \DateTimeImmutable($end, new \DateTimeZone('Europe/Istanbul')))->days;
            $trial = $current['kind'] === 'trial';
            if (!$trial && $days >= self::WARN_DAYS) return null;
            return ['state' => $trial ? 'trial' : 'ending', 'days' => $days, 'ends' => $end, 'plan' => (string)$current['plan_name']];
        }
        $end = $terms[0]['ends_on'];
        $keep = (new \DateTimeImmutable($end, new \DateTimeZone('Europe/Istanbul')))->modify('+'.self::RETENTION_DAYS.' days')->format('Y-m-d');
        return ['state' => 'expired', 'days' => 0, 'ends' => $end, 'keepUntil' => $keep, 'plan' => (string)$terms[0]['plan_name']];
    }

    /** Yönetici bayi kartı için saklama durumu. */
    public function retention(string $partner): array
    {
        $terms = array_values(array_filter($this->terms($partner), static fn($t) => $t['kind'] !== 'upgrade'));
        if (!$terms) return ['state' => 'unmanaged'];
        $day = self::today()->format('Y-m-d');
        $end = $terms[0]['ends_on'];
        if ($end >= $day) return ['state' => 'active', 'ends' => $end];
        $keep = (new \DateTimeImmutable($end))->modify('+'.self::RETENTION_DAYS.' days')->format('Y-m-d');
        return ['state' => $keep < $day ? 'retention-over' : 'retention', 'ends' => $end, 'keepUntil' => $keep];
    }

    private function ensureClosure(): void
    {
        $this->db->exec("CREATE TABLE IF NOT EXISTS partner_closure (partner_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
            ends_on DATE NOT NULL, closed_at INT UNSIGNED NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    /**
     * Süre bitişi kuralı:
     * 1) Abonelik/demo süresi biten bayinin girişi hemen kapanır, açık oturumları sonlanır (veriler korunur).
     * 2) Veriler bitişten sonra 30 gün saklanır; bu sürede yenileme yapılırsa hesap kendiliğinden yeniden açılır.
     * 3) 30 günün sonunda bayinin ve şubelerinin tüm verileri kalıcı olarak silinir.
     * Merkezin mesaj hattı olarak kullanılan bayi hiçbir zaman silinmez. $purgeLimit: tek çalıştırmada en çok silinecek bayi.
     */
    public function sweep(int $now, int $purgeLimit = 20): array
    {
        $this->ensureClosure();
        $today = self::today()->format('Y-m-d');
        $limit = self::today()->modify('-'.self::RETENTION_DAYS.' days')->format('Y-m-d');
        $protected = '';
        try { $protected = (string)(new CenterContact($this->db, ''))->settings()['linePartner']; } catch (\Throwable) {}
        $closed = [];
        $q = $this->db->prepare("SELECT p.id,MAX(s.ends_on) ends_on FROM partner_account p JOIN clinic_subscription s ON s.partner_id=p.id
            WHERE p.active=1 GROUP BY p.id HAVING MAX(s.ends_on) < ?");
        $q->execute([$today]);
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $partner = $row['id'];
            if ($partner === $protected) continue;
            $this->db->prepare('UPDATE partner_account SET active=0,updated_at=? WHERE id=? AND active=1')->execute([gmdate('c', $now), $partner]);
            $this->db->prepare('DELETE s FROM identity_session s JOIN identity_membership m ON m.id=s.membership_id WHERE m.partner_id=?')->execute([$partner]);
            $this->db->prepare('INSERT INTO partner_closure(partner_id,ends_on,closed_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ends_on=VALUES(ends_on),closed_at=VALUES(closed_at)')
                ->execute([$partner, $row['ends_on'], $now]);
            $closed[] = $partner;
        }
        $purged = [];
        if ($purgeLimit > 0) {
            $q = $this->db->prepare("SELECT c.partner_id FROM partner_closure c JOIN partner_account p ON p.id=c.partner_id AND p.active=0
                WHERE NOT EXISTS (SELECT 1 FROM clinic_subscription s WHERE s.partner_id=c.partner_id AND s.ends_on >= ?) ORDER BY c.ends_on LIMIT ".(int)$purgeLimit);
            $q->execute([$limit]);
            foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $partner) {
                if ($partner === $protected) continue;
                try { $this->purge($partner); $purged[] = $partner; }
                catch (\Throwable $e) { error_log('VetZimo retention purge '.$partner.': '.get_class($e)); }
            }
        }
        return ['closed' => $closed, 'purged' => $purged];
    }

    /** Süre bitişiyle kapanan bayi yeni dönem alınca (ödeme, yönetici ataması, deneme) yeniden açılır. Elle kapatılan bayiye dokunmaz. */
    public function reopen(string $partner): bool
    {
        // Tablo yoksa (hiç kapatma olmadıysa) yapılacak bir şey yoktur; DDL işlem içinde çalıştırılmaz.
        try { $q = $this->db->prepare('SELECT 1 FROM partner_closure WHERE partner_id=?'); $q->execute([$partner]); }
        catch (\PDOException) { return false; }
        if (!$q->fetchColumn()) return false;
        $q = $this->db->prepare('SELECT 1 FROM clinic_subscription WHERE partner_id=? AND ends_on>=? LIMIT 1');
        $q->execute([$partner, self::today()->format('Y-m-d')]);
        if (!$q->fetchColumn()) return false;
        $this->db->prepare('UPDATE partner_account SET active=1,updated_at=? WHERE id=?')->execute([gmdate('c'), $partner]);
        $this->db->prepare('DELETE FROM partner_closure WHERE partner_id=?')->execute([$partner]);
        return true;
    }

    // ───────────────────────────── tamamen silme ─────────────────────────────
    private function tablesWith(string $column): array
    {
        $q = $this->db->prepare('SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME=?');
        $q->execute([$column]);
        return $q->fetchAll(PDO::FETCH_COLUMN);
    }

    private static function ident(string $name): string
    {
        if (!preg_match('/\A[A-Za-z0-9_]{1,64}\z/', $name)) throw new RuntimeException('Tablo adı geçersiz.', 500);
        return '`'.$name.'`';
    }

    /** Büyük tablolarda kilitlenmeyi önlemek için parça parça siler. */
    private function chunk(string $table, string $where, array $params): int
    {
        $total = 0;
        do {
            $q = $this->db->prepare('DELETE FROM '.self::ident($table).' WHERE '.$where.' LIMIT '.self::CHUNK);
            $q->execute($params);
            $n = $q->rowCount();
            $total += $n;
        } while ($n === self::CHUNK);
        return $total;
    }

    private function exists(string $table): bool
    {
        $q = $this->db->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
        $q->execute([$table]);
        return (bool)$q->fetchColumn();
    }

    /** Silmeden önce yöneticiye gösterilen özet. */
    public function summary(string $partner): array
    {
        $p = $this->db->prepare('SELECT id,name FROM partner_account WHERE id=?');
        $p->execute([$partner]);
        $row = $p->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new RuntimeException('Bayi bulunamadı.', 404);
        $count = function (string $sql, array $args): int { try { $q = $this->db->prepare($sql); $q->execute($args); return (int)$q->fetchColumn(); } catch (\PDOException) { return 0; } };
        $ws = 'partner:'.$partner;
        return ['partner' => $row, 'retention' => $this->retention($partner), 'counts' => [
            'Üyelik (bayi, şube, personel, hasta sahibi)' => $count('SELECT COUNT(*) FROM identity_membership WHERE partner_id=?', [$partner]),
            'Klinik kayıtları (hasta, müşteri, aşı, satış…)' => $count('SELECT COUNT(*) FROM clinic_record r JOIN clinic_record_set s ON s.id=r.set_id WHERE s.workspace_id=?', [$ws]),
            'Web sitesi' => $count('SELECT COUNT(*) FROM clinic_web_site WHERE partner_id=?', [$partner]),
            'Web sitesi görselleri' => $count('SELECT COUNT(*) FROM clinic_web_media WHERE partner_id=?', [$partner]),
            'Gönderilen mesajlar' => $count('SELECT COUNT(*) FROM phone_outbox WHERE partner_id=?', [$partner]),
            'Abonelik dönemleri' => $count('SELECT COUNT(*) FROM clinic_subscription WHERE partner_id=?', [$partner]),
        ], 'files' => 'VetZimo bayiye ait dosyaları diskte ayrıca tutmaz; görseller, ekler ve web sitesi medyası veritabanında saklanır ve silme ile birlikte kaldırılır.'];
    }

    /** Bayiyi, şubelerini, ekip ve hasta sahibi üyeliklerini, klinik kayıtlarını ve web sitesini tamamen siler. */
    public function purge(string $partner): array
    {
        $p = $this->db->prepare('SELECT id FROM partner_account WHERE id=?');
        $p->execute([$partner]);
        if (!$p->fetchColumn()) throw new RuntimeException('Bayi bulunamadı.', 404);
        $ws = 'partner:'.$partner;
        // 1) Önce giriş kapanır ve oturumlar sonlanır (silme sürerken kimse yazamaz).
        $this->db->prepare('UPDATE partner_account SET active=0 WHERE id=?')->execute([$partner]);
        $this->db->prepare('DELETE s FROM identity_session s JOIN identity_membership m ON m.id=s.membership_id WHERE m.partner_id=?')->execute([$partner]);
        $m = $this->db->prepare('SELECT id,account_id FROM identity_membership WHERE partner_id=?');
        $m->execute([$partner]);
        $members = $m->fetchAll(PDO::FETCH_ASSOC);
        $memberIds = array_column($members, 'id');
        $accounts = array_values(array_unique(array_column($members, 'account_id')));
        $deleted = [];
        $add = static function (string $t, int $n) use (&$deleted): void { if ($n > 0) $deleted[$t] = ($deleted[$t] ?? 0) + $n; };
        $in = static fn(array $ids): string => implode(',', array_fill(0, max(1, count($ids)), '?'));
        $this->db->exec('SET FOREIGN_KEY_CHECKS=0');
        try {
            // 2) Bayi kimliği taşımayan alt tablolar (üst kayıt üzerinden).
            $children = [
                ['clinic_record', 'set_id IN (SELECT id FROM clinic_record_set WHERE workspace_id=?)', [$ws]],
                ['clinic_record_set', 'workspace_id=?', [$ws]],
                ['clinic_directory_patient', 'directory_id IN (SELECT id FROM clinic_directory WHERE workspace_id=?)', [$ws]],
                ['clinic_directory_owner', 'directory_id IN (SELECT id FROM clinic_directory WHERE workspace_id=?)', [$ws]],
                ['clinic_directory', 'workspace_id=?', [$ws]],
                ['clinic_workspace', 'user_id=?', [$ws]],
                ['clinic_support_attachment', 'reply_id IN (SELECT r.id FROM clinic_support_reply r JOIN clinic_support t ON t.id=r.ticket_id WHERE t.partner_id=?)', [$partner]],
                ['clinic_support_reply', 'ticket_id IN (SELECT id FROM clinic_support WHERE partner_id=?)', [$partner]],
                ['clinic_support_read', 'ticket_id IN (SELECT id FROM clinic_support WHERE partner_id=?)', [$partner]],
                ['clinic_visit_payment', 'visit_id IN (SELECT id FROM clinic_visit_request WHERE partner_id=?)', [$partner]],
                ['clinic_visit_quote', 'visit_id IN (SELECT id FROM clinic_visit_request WHERE partner_id=?)', [$partner]],
                ['clinic_visit_slot', 'visit_id IN (SELECT id FROM clinic_visit_request WHERE partner_id=?)', [$partner]],
                ['clinic_visit_mail', 'event_id IN (SELECT id FROM clinic_visit_event WHERE partner_id=?)', [$partner]],
                ['clinic_visit_read', 'event_id IN (SELECT id FROM clinic_visit_event WHERE partner_id=?)', [$partner]],
                ['vebot_local_job', 'turn_id IN (SELECT id FROM vebot_turn WHERE partner_id=?)', [$partner]],
            ];
            foreach ($children as [$table, $where, $args]) if ($this->exists($table)) $add($table, $this->chunk($table, $where, $args));
            // 3) Üyeliğe bağlı tablolar.
            if ($memberIds) {
                foreach ($this->tablesWith('membership_id') as $table) $add($table, $this->chunk($table, 'membership_id IN ('.$in($memberIds).')', $memberIds));
                if ($this->exists('clinic_staff_plan')) $add('clinic_staff_plan', $this->chunk('clinic_staff_plan', 'member_id IN ('.$in($memberIds).')', $memberIds));
            }
            // 4) partner_id sütunu olan tüm tablolar (yeni eklenen tablolar da otomatik kapsanır).
            foreach ($this->tablesWith('partner_id') as $table) {
                if ($table === 'partner_account') continue;
                $add($table, $this->chunk($table, 'partner_id=?', [$partner]));
            }
            foreach ($this->tablesWith('trial_partner') as $table) $add($table, $this->chunk($table, 'trial_partner=?', [$partner]));
            // 5) Başka bir kurumda üyeliği kalmayan (merkez hesabı olmayan) kişisel hesaplar.
            foreach ($accounts as $account) {
                $left = $this->db->prepare('SELECT (SELECT COUNT(*) FROM identity_membership WHERE account_id=?)+(SELECT COUNT(*) FROM identity_center WHERE account_id=?)');
                $left->execute([$account, $account]);
                if ((int)$left->fetchColumn() > 0) continue;
                foreach ($this->tablesWith('account_id') as $table) {
                    if (in_array($table, ['center_audit', 'identity_center'], true)) continue;
                    $add($table, $this->chunk($table, 'account_id=?', [$account]));
                }
                $add('identity_account', $this->chunk('identity_account', 'id=?', [$account]));
            }
            $add('partner_account', $this->chunk('partner_account', 'id=?', [$partner]));
        } finally {
            $this->db->exec('SET FOREIGN_KEY_CHECKS=1');
        }
        return ['deleted' => $deleted, 'rows' => array_sum($deleted)];
    }
}
