<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Aile fotoğrafları: hasta sahibi en fazla 3 fotoğraf ekler (fotoğraftakilerin adları + soyadı). Fotoğraf önce
 * klinik ekibine (bayi, şube yöneticisi, personel) onaya düşer. Onaylanınca hasta sahibinin panelinde ve klinik
 * panelinde görünür; hasta sahibi web sitesinde paylaşıma izin verdiyse kliniğin web sitesinde de "... Ailesi" olarak
 * iskambil kartı şeklinde yayınlanır. İzin yoksa fotoğraf yalnız hasta sahibinde ve klinik panelinde (gizli) kalır.
 */
final class FamilyPhotos
{
    public const MAX = 3;
    private const BYTES = 1_600_000;

    public function __construct(private readonly PDO $db) {}

    /**
     * Fotoğraf dosyaları veritabanında değil diskte tutulur (veritabanı ve yedekleri şişmez): uygulama kökündeki
     * storage/family-photos/ — web'e açık public/ klasörünün dışındadır, ayrıca kendi .htaccess'i her erişimi reddeder.
     * Disk yazılamazsa (izin/kota) fotoğraf eskisi gibi veritabanına kaydedilir; yükleme kaybolmaz.
     */
    public static function dir(): string
    {
        return rtrim((string)(getenv('VETNET_STORAGE') ?: dirname(__DIR__).'/storage'), '/').'/family-photos';
    }

    private static function path(string $id): string { return self::dir().'/'.substr($id, 0, 2).'/'.$id.'.img'; }

    /** Baytları atomik olarak diske yazar; başarısızsa false (çağıran veritabanına kaydeder). */
    private static function writeFile(string $id, string $bytes): bool
    {
        $root = self::dir();
        $dir = dirname(self::path($id));
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return false;
        if (!is_file($root.'/.htaccess')) @file_put_contents($root.'/.htaccess', "Require all denied\nDeny from all\n");
        $tmp = $dir.'/.'.$id.'.'.bin2hex(random_bytes(4)).'.tmp';
        if (@file_put_contents($tmp, $bytes, LOCK_EX) !== strlen($bytes)) { @unlink($tmp); return false; }
        @chmod($tmp, 0640);
        if (!@rename($tmp, self::path($id))) { @unlink($tmp); return false; }
        return true;
    }

    private static function readFile(string $id): ?string
    {
        $bytes = @file_get_contents(self::path($id));
        return is_string($bytes) && $bytes !== '' ? $bytes : null;
    }

    public static function removeFile(string $id): void
    {
        if (preg_match('/\A[a-f0-9]{32}\z/', $id)) @unlink(self::path($id));
    }

    /**
     * Bakım (günlük görev): veritabanındaki eski fotoğrafları partiler hâlinde diske taşır; kaydı silinmiş
     * (hasta sahibi/bayi silindi) fotoğraf dosyalarını temizler. Yeni yüklemeyle yarışmamak için 1 saatten eski
     * sahipsiz dosyalara dokunur. @return array{moved:int,removed:int}
     */
    public function maintain(int $now, int $batch = 200): array
    {
        $moved = 0; $removed = 0;
        try {
            self::ensure($this->db);
            $q = $this->db->prepare('SELECT id,image FROM clinic_family_photo WHERE image IS NOT NULL LIMIT '.max(1, $batch));
            $q->execute();
            foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
                if (!self::writeFile($r['id'], (string)$r['image'])) break;
                $u = $this->db->prepare('UPDATE clinic_family_photo SET image=NULL WHERE id=? AND image IS NOT NULL');
                $u->execute([$r['id']]);
                $moved += $u->rowCount();
            }
        } catch (PDOException $e) { if ($e->getCode() !== '42S02') throw $e; }
        $exists = $this->db->prepare('SELECT 1 FROM clinic_family_photo WHERE id=?');
        foreach (glob(self::dir().'/??/*.img') ?: [] as $file) {
            $id = basename($file, '.img');
            if (!preg_match('/\A[a-f0-9]{32}\z/', $id) || (int)@filemtime($file) > $now - 3600) continue;
            try { $exists->execute([$id]); $keep = (bool)$exists->fetchColumn(); } catch (PDOException) { $keep = true; }
            if (!$keep && @unlink($file)) $removed++;
        }
        foreach (glob(self::dir().'/??/.*.tmp') ?: [] as $tmp) if ((int)@filemtime($tmp) < $now - 3600) @unlink($tmp);
        return ['moved' => $moved, 'removed' => $removed];
    }

    public static function ensure(PDO $db): void
    {
        $db->exec('CREATE TABLE IF NOT EXISTS clinic_family_photo (id CHAR(32) NOT NULL PRIMARY KEY, partner_id VARCHAR(80) NOT NULL,
            branch_id VARCHAR(80) NOT NULL DEFAULT \'\', membership_id VARCHAR(80) NOT NULL, client_id VARCHAR(80) NOT NULL DEFAULT \'\',
            surname VARCHAR(60) NOT NULL, caption VARCHAR(160) NOT NULL DEFAULT \'\', publish TINYINT NOT NULL DEFAULT 0,
            status VARCHAR(10) NOT NULL DEFAULT \'pending\', mime VARCHAR(20) NOT NULL, image MEDIUMBLOB NULL,
            created_at INT UNSIGNED NOT NULL, decided_at INT UNSIGNED NULL, decided_by VARCHAR(120) NOT NULL DEFAULT \'\',
            KEY partner_status (partner_id,status,created_at), KEY member (membership_id), KEY client (partner_id,client_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        // İlk sürümde image NOT NULL idi; dosyaya taşıma için NULL olabilir yapılır (bir kez, küçük tablo).
        static $checked = false;
        if (!$checked) {
            $checked = true;
            $n = $db->query("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='clinic_family_photo' AND COLUMN_NAME='image'")->fetchColumn();
            if ($n === 'NO') $db->exec('ALTER TABLE clinic_family_photo MODIFY image MEDIUMBLOB NULL');
        }
    }

    private const COLUMNS = 'id,branch_id,membership_id,client_id,surname,caption,publish,status,created_at,decided_at,decided_by';

    private static function row(array $r): array
    {
        return ['id' => $r['id'], 'client' => $r['client_id'], 'branch' => $r['branch_id'], 'surname' => $r['surname'], 'caption' => $r['caption'],
            'family' => self::family($r['surname']), 'publish' => (bool)$r['publish'], 'status' => $r['status'], 'createdAt' => (int)$r['created_at'],
            'decidedAt' => $r['decided_at'] === null ? null : (int)$r['decided_at'], 'decidedBy' => $r['decided_by'], 'url' => '/api/family-photo/'.$r['id']];
    }

    public static function family(string $surname): string
    {
        $s = trim($surname);
        return $s === '' ? '' : mb_convert_case(mb_strtolower($s, 'UTF-8'), MB_CASE_TITLE, 'UTF-8').' Ailesi';
    }

    private function select(string $where, array $args, string $order = 'created_at DESC', int|string $limit = 60): array
    {
        try {
            $q = $this->db->prepare('SELECT '.self::COLUMNS.' FROM clinic_family_photo WHERE '.$where.' ORDER BY '.$order.' LIMIT '.$limit);
            $q->execute($args);
            return array_map(self::row(...), $q->fetchAll(PDO::FETCH_ASSOC));
        } catch (PDOException $e) {
            if ($e->getCode() === '42S02') return [];
            throw $e;
        }
    }

    private static function staff(array $actor): bool { return in_array($actor['role'] ?? '', ['dealer', 'branch', 'staff'], true); }

    /** Şube kısıtı: bayi tüm şubeleri, şube/personel yalnız kendi şubesini görür. */
    private static function branchClause(array $actor, array &$args): string
    {
        if (($actor['role'] ?? '') === 'dealer') return '';
        $args[] = (string)($actor['branch_id'] ?? '');
        return ' AND branch_id=?';
    }

    /** Hasta sahibi: kendi fotoğrafları. Klinik: ?client=… (müşteri kartı) veya bekleyenler. */
    public function list(array $actor, array $query): array
    {
        if (($actor['role'] ?? '') === 'customer') {
            return ['items' => $this->select('partner_id=? AND client_id=? AND status<>?', [$actor['partner_id'], (string)($actor['customer_id'] ?? ''), 'rejected']), 'max' => self::MAX];
        }
        if (!self::staff($actor) || !ClinicAccess::allowed($actor, 'clients')) throw new RuntimeException('Hasta sahibi kayıtlarını görme yetkiniz yok.', 403);
        $args = [$actor['partner_id']];
        $client = is_string($query['client'] ?? null) ? $query['client'] : '';
        if (($query['all'] ?? '') === '1') return $this->gallery($actor, $query);
        if ($client !== '') {
            $args[] = $client;
            $where = 'partner_id=? AND client_id=?';
        } else {
            $args[] = 'pending';
            $where = 'partner_id=? AND status=?';
        }
        $where .= self::branchClause($actor, $args);
        return ['items' => $this->select($where, $args), 'canDecide' => ClinicAccess::allowed($actor, 'clients', true), 'max' => self::MAX];
    }

    /** Müşteriler › Aile Fotoğrafları: tüm aileler, durum süzgeci, arama (soyad/adlar/müşteri), sayfalama. */
    private function gallery(array $actor, array $query): array
    {
        $per = max(6, min(60, (int)($query['per'] ?? 12)));
        $page = max(1, (int)($query['page'] ?? 1));
        $args = [$actor['partner_id']];
        $where = 'partner_id=?'.self::branchClause($actor, $args);
        $status = (string)($query['status'] ?? '');
        if (in_array($status, ['pending', 'approved', 'rejected'], true)) { $where .= ' AND status=?'; $args[] = $status; }
        if ($status === 'public') $where .= " AND status='approved' AND publish=1";
        if ($status === 'private') $where .= ' AND publish=0';
        $q = trim((string)($query['q'] ?? ''));
        $clients = array_values(array_filter(array_map('strval', (array)($query['clients'] ?? [])), static fn($c) => preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $c)));
        if ($q !== '') {
            $like = '%'.addcslashes(mb_substr($q, 0, 60), '%_\\').'%';
            $where .= ' AND (surname LIKE ? OR caption LIKE ?'.($clients ? ' OR client_id IN ('.implode(',', array_fill(0, count(array_slice($clients, 0, 200)), '?')).')' : '').')';
            array_push($args, $like, $like, ...array_slice($clients, 0, 200));
        }
        try {
            $c = $this->db->prepare('SELECT COUNT(*) FROM clinic_family_photo WHERE '.$where); $c->execute($args); $total = (int)$c->fetchColumn();
        } catch (PDOException $e) { if ($e->getCode() !== '42S02') throw $e; $total = 0; }
        $pa = [$actor['partner_id']];
        $pendingWhere = "partner_id=? AND status='pending'".self::branchClause($actor, $pa);
        $pending = 0;
        try { $pq = $this->db->prepare('SELECT COUNT(*) FROM clinic_family_photo WHERE '.$pendingWhere); $pq->execute($pa); $pending = (int)$pq->fetchColumn(); } catch (PDOException) {}
        $pages = max(1, (int)ceil($total / $per)); $page = min($page, $pages);
        $items = $total ? $this->select($where, $args, "FIELD(status,'pending','approved','rejected'), created_at DESC", $per.' OFFSET '.(($page - 1) * $per)) : [];
        return ['items' => $items, 'total' => $total, 'page' => $page, 'pages' => $pages, 'per' => $per, 'pending' => $pending,
            'canDecide' => ClinicAccess::allowed($actor, 'clients', true), 'max' => self::MAX];
    }

    public function upload(array $actor, object $body, int $now): array
    {
        // Hasta sahibi kendi ailesi için ekler (klinik onayına düşer); bayi, şube yöneticisi ve personel (hasta sahibi yazma
        // yetkisiyle) müşteri kartından ekler — klinik eklediği için doğrudan onaylıdır. Sınır müşteri başına 3'tür.
        $customer = ($actor['role'] ?? '') === 'customer';
        if (!$customer && !(self::staff($actor) && ClinicAccess::allowed($actor, 'clients', true))) throw new RuntimeException('Aile fotoğrafı eklemek için hasta sahibi yazma yetkisi gerekir.', 403);
        $client = $customer ? (string)($actor['customer_id'] ?? '') : (is_string($body->client ?? null) ? $body->client : '');
        if (!preg_match('/\A[A-Za-z0-9_-]{1,80}\z/', $client)) throw new RuntimeException('Hasta sahibi seçin.', 422);
        $branch = (string)($actor['branch_id'] ?? '');
        $membership = $customer ? (string)$actor['membership_id'] : '';
        if (!$customer) {
            $slice = (new ClinicRecords($this->db))->slice('partner:'.$actor['partner_id'], ['clients' => [$client]]);
            $row = null;
            foreach ($slice?->clients ?? [] as $c) if (($c->id ?? '') === $client) $row = $c;
            if (!$row) throw new RuntimeException('Hasta sahibi bulunamadı.', 404);
            $branch = (string)($row->branch ?? '');
            if (($actor['role'] ?? '') !== 'dealer' && $branch !== (string)($actor['branch_id'] ?? '')) throw new RuntimeException('Bu hasta sahibi başka şubeye kayıtlı.', 403);
            $m = $this->db->prepare("SELECT id FROM identity_membership WHERE partner_id=? AND role='customer' AND customer_id=? AND status<>'revoked' LIMIT 1");
            $m->execute([$actor['partner_id'], $client]);
            $membership = (string)($m->fetchColumn() ?: '');
        }
        $surname = trim(preg_replace('/\s+/u', ' ', (string)($body->surname ?? '')));
        $caption = trim(preg_replace('/\s+/u', ' ', (string)($body->caption ?? '')));
        if ($surname === '' || mb_strlen($surname) > 40 || !preg_match('/\A[\p{L}][\p{L}\'’ .-]*\z/u', $surname)) throw new RuntimeException('Soyadınızı yazın (yalnız harf).', 422);
        if (mb_strlen($caption) > 120) throw new RuntimeException('Fotoğraftakilerin adları en fazla 120 karakter olabilir.', 422);
        if (!is_bool($body->publish ?? null)) throw new RuntimeException('Web sitesinde paylaşım sorusunu yanıtlayın.', 422);
        $image = (string)($body->image ?? '');
        if (!preg_match('~\Adata:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)\z~', $image, $m)) throw new RuntimeException('Fotoğraf okunamadı. JPG, PNG veya WEBP seçin.', 422);
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || strlen($bytes) < 200 || strlen($bytes) > self::BYTES) throw new RuntimeException('Fotoğraf çok büyük; daha küçük bir fotoğraf seçin.', 422);
        $info = @getimagesizefromstring($bytes);
        if (!$info || $info['mime'] !== $m[1] || $info[0] < 120 || $info[1] < 120 || $info[0] > 4000 || $info[1] > 4000) throw new RuntimeException('Fotoğraf geçersiz veya çok küçük.', 422);
        self::ensure($this->db);
        $this->db->beginTransaction();
        try {
            // Aynı anda gönderilen yüklemeler (hasta sahibi + ekip) sınırı aşamasın diye bayi satırı kilitlenir.
            $this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE')->execute([$actor['partner_id']]);
            $count = $this->db->prepare("SELECT COUNT(*) FROM clinic_family_photo WHERE partner_id=? AND client_id=? AND status<>'rejected'");
            $count->execute([$actor['partner_id'], $client]);
            if ((int)$count->fetchColumn() >= self::MAX) throw new RuntimeException('En fazla '.self::MAX.' aile fotoğrafı ekleyebilirsiniz. Yenisi için birini silin.', 422);
            $id = bin2hex(random_bytes(16));
            $onDisk = self::writeFile($id, $bytes);
            $this->db->prepare('INSERT INTO clinic_family_photo(id,partner_id,branch_id,membership_id,client_id,surname,caption,publish,status,mime,image,created_at,decided_at,decided_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')->execute([$id, $actor['partner_id'], $branch, $membership, $client, $surname, $caption, $body->publish ? 1 : 0,
                $customer ? 'pending' : 'approved', $m[1], $onDisk ? null : $bytes, $now, $customer ? null : $now, $customer ? '' : (string)($actor['name'] ?? '')]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            if (isset($id)) self::removeFile($id); // kayıt oluşmadıysa dosya da kalmaz
            throw $e;
        }
        return $this->list($actor, $customer ? [] : ['client' => $client]);
    }

    /** Hasta sahibi kendi fotoğrafını, klinik (hasta sahibi yazma izniyle) herhangi birini siler. */
    public function delete(array $actor, string $id): array
    {
        $args = [$id, $actor['partner_id']];
        if (($actor['role'] ?? '') === 'customer') { $where = 'id=? AND partner_id=? AND client_id=?'; $args[] = (string)($actor['customer_id'] ?? ''); }
        elseif (self::staff($actor) && ClinicAccess::allowed($actor, 'clients', true)) $where = 'id=? AND partner_id=?'.self::branchClause($actor, $args);
        else throw new RuntimeException('Fotoğrafı silme yetkiniz yok.', 403);
        try { $q = $this->db->prepare('DELETE FROM clinic_family_photo WHERE '.$where); $q->execute($args); }
        catch (PDOException $e) { if ($e->getCode() !== '42S02') throw $e; $q = null; }
        if (!$q || !$q->rowCount()) throw new RuntimeException('Fotoğraf bulunamadı.', 404);
        self::removeFile($id);
        return ['ok' => true];
    }

    public function decide(array $actor, string $id, bool $approve, int $now): array
    {
        if (!self::staff($actor) || !ClinicAccess::allowed($actor, 'clients', true)) throw new RuntimeException('Fotoğraf onayı için hasta sahibi yazma yetkisi gerekir.', 403);
        $args = [$approve ? 'approved' : 'rejected', $now, (string)($actor['name'] ?? ''), $id, $actor['partner_id']];
        $q = $this->db->prepare('UPDATE clinic_family_photo SET status=?,decided_at=?,decided_by=? WHERE id=? AND partner_id=?'.self::branchClause($actor, $args));
        try { $q->execute($args); } catch (PDOException $e) { if ($e->getCode() !== '42S02') throw $e; }
        if (!$q->rowCount()) throw new RuntimeException('Fotoğraf bulunamadı.', 404);
        return ['ok' => true, 'status' => $approve ? 'approved' : 'rejected'];
    }

    /**
     * Görsel. Herkese: onaylı ve paylaşım izni olan. Hasta sahibine: kendi fotoğrafı. Klinik ekibine: kendi kliniği.
     * @return array{0:string,1:string,2:bool}|null [mime, bytes, herkese açık mı]
     */
    public function image(string $id, ?array $actor, ?string $partner = null): ?array
    {
        if (!preg_match('/\A[a-f0-9]{32}\z/', $id)) return null;
        try {
            $q = $this->db->prepare('SELECT partner_id,branch_id,membership_id,client_id,status,publish,mime,image FROM clinic_family_photo WHERE id=?');
            $q->execute([$id]);
            $r = $q->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException) { return null; }
        if (!$r || ($partner !== null && $r['partner_id'] !== $partner)) return null;
        if ($r['image'] === null) {
            $r['image'] = self::readFile($id);
            if ($r['image'] === null) return null;
        }
        $public = $r['status'] === 'approved' && (bool)$r['publish'];
        if ($public) return [$r['mime'], $r['image'], true];
        if ($partner !== null || !$actor || ($actor['partner_id'] ?? '') !== $r['partner_id'] || $r['status'] === 'rejected' && ($actor['role'] ?? '') === 'customer') return null;
        if (($actor['role'] ?? '') === 'customer') return (string)($actor['customer_id'] ?? '') === $r['client_id'] ? [$r['mime'], $r['image'], false] : null;
        if (!self::staff($actor) || !ClinicAccess::allowed($actor, 'clients')) return null;
        if (($actor['role'] ?? '') !== 'dealer' && $r['branch_id'] !== (string)($actor['branch_id'] ?? '')) return null;
        return [$r['mime'], $r['image'], false];
    }

    /** Web sitesi: onaylı + paylaşım izni olan aileler (en yeni önce), her aile en fazla 3 fotoğraf. */
    public function publicFamilies(string $partner, int $limit = 24): array
    {
        $rows = $this->select("partner_id=? AND status='approved' AND publish=1", [$partner], 'decided_at DESC, created_at DESC', 300);
        $families = [];
        foreach ($rows as $r) {
            $key = $r['client'] !== '' ? $r['client'] : $r['id'];
            $families[$key] ??= ['family' => $r['family'], 'photos' => []];
            if (count($families[$key]['photos']) < self::MAX) $families[$key]['photos'][] = ['id' => $r['id'], 'caption' => $r['caption']];
        }
        return array_slice(array_values($families), 0, $limit);
    }

    /** Klinik uyarıları: onay bekleyen fotoğraflar. */
    public function pendingAlerts(array $actor): array
    {
        $args = [$actor['partner_id'], 'pending'];
        $where = 'partner_id=? AND status=?'.self::branchClause($actor, $args);
        return array_map(static fn($r) => ['key' => 'family:'.$r['id'], 'kind' => 'family', 'tone' => 'info',
            'title' => 'Aile fotoğrafı onay bekliyor', 'body' => $r['family'].($r['caption'] !== '' ? ' · '.$r['caption'] : '').' · '.
                ($r['publish'] ? 'web sitesinde paylaşım izni var' : 'yalnız panelde (gizli)'),
            'href' => $r['client'] !== '' ? '#owner/'.rawurlencode($r['client']) : '#clients', 'time' => $r['createdAt'], 'auto' => true],
            $this->select($where, $args, 'created_at DESC', 20));
    }
}
