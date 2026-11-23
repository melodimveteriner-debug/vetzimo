<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

/** Only for a dedicated, empty database. Never upgrades or overwrites live data. */
final class Installer
{
    public function __construct(private readonly PDO $db, private readonly string $root) {}

    public function install(string $name, string $phone, string $email, string $password, ?array $center=null): void
    {
        $name = trim($name);
        $phone = DealerLogin::normalizePhone($phone);
        $email = strtolower(trim($email));
        if ($name === '' || strlen($name) > 160 || $phone === '' ||
            !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 ||
            strlen($password) < 12 || strlen($password) > 512) {
            throw new RuntimeException('Klinik adı, geçerli cep telefonu, e-posta ve en az 12 karakterli şifre giriniz.', 422);
        }
        if($center!==null) {
            $centerEmail=strtolower(trim($center['email'] ?? ''));
            if(!filter_var($centerEmail,FILTER_VALIDATE_EMAIL)||strlen($centerEmail)>254||strlen($center['password'] ?? '')<12||strlen($center['password'] ?? '')>512) throw new RuntimeException('Yönetici e-postası ve en az 12 karakterli ayrı şifresi gerekli.',422);
            $centerStep=Totp::verify($center['secret'] ?? '',$center['otp'] ?? '',time());
            if($centerStep===null) throw new RuntimeException('Yönetici doğrulama kodu geçersiz.',422);
            $centerBox=Totp::encrypt($center['secret'],$center['key'] ?? '');
            $centerHash=password_hash($center['password'],PASSWORD_ARGON2ID);
        }
        $template = json_decode((string) file_get_contents($this->root . '/initial-workspace.json'), false, 64, JSON_THROW_ON_ERROR);
        if (($template->version ?? null) !== 1 || count($template->branches ?? []) !== 1) {
            throw new RuntimeException('Başlangıç dosyası doğrulanamadı.', 503);
        }
        $template->preferences->clinic = $name;
        $template->branches[0]->name = 'Merkez';
        $template->branches[0]->city = '';
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        $lock = 'vetnet-install-' . substr(hash('sha256', (string)$this->db->query('SELECT DATABASE()')->fetchColumn()), 0, 32);
        $query = $this->db->prepare('SELECT GET_LOCK(?, 0)');
        $query->execute([$lock]);
        if ((int)$query->fetchColumn() !== 1) throw new RuntimeException('Kurulum başka bir işlem tarafından yürütülüyor.', 409);
        try {
            if ($this->db->query('SHOW TABLES')->fetch()) {
                throw new RuntimeException('Veritabanı boş değil. Mevcut kayıtları korumak için kurulum durduruldu.', 409);
            }
            // DDL commits implicitly in MySQL. A failed migration must be inspected,
            // never retried automatically or cleaned by dropping user tables.
            (new Migrations($this->db, $this->root))->installFresh();
            $partner = bin2hex(random_bytes(16));
            $account = bin2hex(random_bytes(16));
            $membership = bin2hex(random_bytes(16));
            $now = time();
            $stamp = gmdate('c', $now);
            $this->db->beginTransaction();
            $this->db->prepare('INSERT INTO partner_account(id,code,name,email,phone,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
                ->execute([$partner,strtoupper(substr($partner,0,12)),$name,$email,$phone,$stamp,$stamp]);
            $this->db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at) VALUES (?,'phone',?,?,?)")
                ->execute([$account,$phone,$hash,$now]);
            $this->db->prepare("INSERT INTO identity_membership(id,account_id,partner_id,role,name,modules,status) VALUES (?,?,?,'dealer',?,'{}','active')")
                ->execute([$membership,$account,$partner,$name]);
            (new WorkspaceRepository($this->db))->save('partner:'.$partner, 0, $template);
            if($center!==null) {
                $centerId=bin2hex(random_bytes(16));
                $this->db->prepare("INSERT INTO identity_account(id,kind,identifier,password_hash,verified_at,totp_seed,totp_step) VALUES (?,'center',?,?,?,?,?)")->execute([$centerId,$centerEmail,$centerHash,$now,$centerBox,$centerStep]);
                $this->db->prepare('INSERT INTO identity_center(account_id,workspace_id,is_owner) VALUES (?,?,1)')->execute([$centerId,'center:'.$centerId]);
            }
            $this->db->commit();
        } finally {
            if ($this->db->inTransaction()) $this->db->rollBack();
            $query = $this->db->prepare('SELECT RELEASE_LOCK(?)');
            $query->execute([$lock]);
        }
    }
}
