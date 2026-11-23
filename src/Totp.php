<?php
declare(strict_types=1);
namespace VetNet\Cpanel;
use RuntimeException;
final class Totp
{
    private const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    public static function secret(): string
    {
        $out='';for($i=0;$i<32;$i++)$out.=self::ALPHABET[random_int(0,31)];return $out;
    }
    public static function code(string $secret,int $step,int $digits=6): string
    {
        if(!preg_match('/\A[A-Z2-7]{16,128}\z/',$secret)||!in_array($digits,[6,8],true)||$step<0) throw new RuntimeException('Doğrulama anahtarı geçersiz.',422);
        $buffer=0;$bits=0;$key='';
        foreach(str_split($secret) as $character) {
            $buffer=($buffer<<5)|strpos(self::ALPHABET,$character);$bits+=5;
            if($bits>=8){$bits-=8;$key.=chr(($buffer>>$bits)&255);$buffer&=(1<<$bits)-1;}
        }
        $digest=hash_hmac('sha1',pack('N2',intdiv($step,4294967296),$step%4294967296),$key,true);
        $offset=ord($digest[19])&15;
        $number=unpack('N',substr($digest,$offset,4))[1]&0x7fffffff;
        return str_pad((string)($number%(10**$digits)),$digits,'0',STR_PAD_LEFT);
    }
    public static function verify(string $secret,string $code,int $now,int $last=-1): ?int
    {
        if(!preg_match('/\A[0-9]{6}\z/',$code)) return null;
        $current=intdiv($now,30);
        foreach([$current,$current-1,$current+1] as $step) if($step>$last && hash_equals(self::code($secret,$step),$code)) return $step;
        return null;
    }
    public static function encrypt(string $secret,string $key): string
    {
        $raw=base64_decode($key,true);
        if($raw===false||strlen($raw)!==32) throw new RuntimeException('32 baytlık şifreleme anahtarı yapılandırılmalıdır.',503);
        $nonce=random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        return base64_encode($nonce.sodium_crypto_secretbox($secret,$nonce,$raw));
    }
    public static function decrypt(string $box,string $key): string
    {
        $raw=base64_decode($key,true);$bytes=base64_decode($box,true);
        if($raw===false||strlen($raw)!==32||$bytes===false||strlen($bytes)<40) throw new RuntimeException('Şifreleme yapılandırması geçersiz.',503);
        $secret=sodium_crypto_secretbox_open(substr($bytes,24),substr($bytes,0,24),$raw);
        if($secret===false) throw new RuntimeException('Doğrulama anahtarı açılamadı.',503);
        return $secret;
    }
}
