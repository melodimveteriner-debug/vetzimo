<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class ClinicContact
{
    public function __construct(private readonly PDO $db,private readonly Notifications $notifications,private readonly string $origin) {}

    public function read(string $membership): array
    {
        $query=$this->db->prepare('SELECT email,pending_email,expires FROM clinic_contact WHERE membership_id=?');
        $query->execute([$membership]);
        $row=$query->fetch();
        return ['email'=>$row['email'] ?? '', 'pending_email'=>($row['expires'] ?? 0)>time()?$row['pending_email']:'',
            'smtpEnabled'=>$this->notifications->settings()['smtpEnabled']];
    }

    public function request(string $membership, object $input, int $now): array
    {
        $email=$input->email ?? null;
        if (!is_string($email) || strlen($email)>254 || !filter_var(trim($email),FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Geçerli e-posta adresi girin.',422);
        }
        if (!$this->notifications->settings()['smtpEnabled']) throw new RuntimeException('Merkez yönetiminde SMTP bağlantısını etkinleştirin.',503);
        $email=trim($email);
        $token=bin2hex(random_bytes(32));
        $hash=hash('sha256',$token);
        $query=$this->db->prepare("INSERT INTO clinic_contact(membership_id,pending_email,token_hash,expires) VALUES (?,?,?,?)
            ON DUPLICATE KEY UPDATE pending_email=VALUES(pending_email),token_hash=VALUES(token_hash),expires=VALUES(expires)");
        $query->execute([$membership,$email,$hash,$now+1800]);
        try {
            $this->notifications->send('smtp',$email,'VetZimo bildirim adresinizi doğrulayın',
                "Bu bağlantıyı aynı VetZimo çalışma alanında oturum açarak 30 dakika içinde kullanın.\n".$this->origin.'/app#bildirim-epostasi/'.$token);
        } catch (\Throwable $error) {
            $this->db->prepare("UPDATE clinic_contact SET pending_email='',token_hash=NULL,expires=0 WHERE membership_id=? AND token_hash=?")
                ->execute([$membership,$hash]);
            throw $error;
        }
        return ['status'=>'accepted'];
    }

    public function verify(string $membership, object $input, int $now): void
    {
        $token=$input->token ?? null;
        if (!is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/',$token)) throw new RuntimeException('Doğrulama bağlantısı geçersiz.',422);
        $query=$this->db->prepare("UPDATE clinic_contact SET email=pending_email,pending_email='',token_hash=NULL,expires=0
            WHERE membership_id=? AND token_hash=? AND expires>?");
        $query->execute([$membership,hash('sha256',$token),$now]);
        if (!$query->rowCount()) throw new RuntimeException('Bağlantı kullanılmış, süresi dolmuş veya başka bir çalışma alanına ait.',422);
    }

    public function notifyReply(string $ticket): void
    {
        if (!$this->notifications->settings()['smtpEnabled']) return;
        $query=$this->db->prepare("SELECT DISTINCT c.email FROM clinic_support t JOIN identity_membership m ON m.partner_id=t.partner_id
            JOIN clinic_contact c ON c.membership_id=m.id JOIN identity_account a ON a.id=m.account_id
            JOIN partner_account p ON p.id=m.partner_id WHERE t.id=? AND m.role='dealer' AND m.status='active'
            AND a.blocked=0 AND p.active=1 AND c.email<>'' LIMIT 10");
        $query->execute([$ticket]);
        foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $email) {
            try {
                $this->notifications->send('smtp',$email,'VetZimo destek talebinize yanıt geldi',
                    "Yanıtı VetZimo panelinden açabilirsiniz.\n".$this->origin.'/clinic#bayi-destek/'.$ticket);
            } catch (\Throwable $error) { error_log('VetZimo support notification: '.get_class($error)); }
        }
    }
}
