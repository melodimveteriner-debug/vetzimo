<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class SupportAttachments
{
    public const PER_FILE=3000000;
    public const MAX_COUNT=3;
    public const TOTAL=6000000;

    public static function uploaded(): array
    {
        if ((int)($_SERVER['CONTENT_LENGTH']??0)>self::TOTAL+30000 || (!$_POST && !$_FILES)) {
            throw new RuntimeException('Eklerin toplamı en fazla 6 MB olabilir. Sunucunun yükleme sınırını kontrol edin.',413);
        }
        $files=$_FILES['attachments']??[];
        $errors=$files['error']??[];
        if (!is_array($errors) || count($errors)>self::MAX_COUNT) throw new RuntimeException('En fazla üç dosya yükleyin.',422);
        $result=[];
        $total=0;
        foreach ($errors as $i=>$error) {
            if ($error===UPLOAD_ERR_NO_FILE) continue;
            if (in_array($error,[UPLOAD_ERR_INI_SIZE,UPLOAD_ERR_FORM_SIZE],true)) {
                throw new RuntimeException('Bir dosya sunucunun yükleme sınırını aşıyor.',413);
            }
            $path=$files['tmp_name'][$i]??null;
            if ($error!==UPLOAD_ERR_OK || !is_string($path) || !is_uploaded_file($path)) {
                throw new RuntimeException('Dosya yüklenemedi. Yeniden seçip deneyin.',422);
            }
            $name=$files['name'][$i]??'';
            if (!is_string($name) || !preg_match('~\A[\p{L}\p{N} ._()\-]{1,165}\.(jpg|jpeg|png|webp|pdf|xlsx|csv)\z~uiD',$name,$match)) {
                throw new RuntimeException('Dosya adı veya biçimi geçersiz. JPG, PNG, WebP, PDF, XLSX veya CSV seçin.',422);
            }
            $bytes=file_get_contents($path,false,null,0,self::PER_FILE+1);
            if ($bytes===false || $bytes==='') throw new RuntimeException('Boş dosya yüklenemez.',422);
            $size=strlen($bytes);
            $total+=$size;
            if ($size>self::PER_FILE || $total>self::TOTAL) throw new RuntimeException('Dosya başına en fazla 3 MB, toplam 6 MB yükleyin.',413);
            if (!self::valid(strtolower($match[1]),$bytes)) throw new RuntimeException('Dosyanın içeriği uzantısıyla eşleşmiyor.',422);
            $result[]=[$name,$bytes,$size];
        }
        return $result;
    }

    private static function valid(string $ext,string $bytes): bool
    {
        $image=['jpeg'=>'image/jpeg','jpg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp'];
        if (isset($image[$ext])) {
            $dimensions=@getimagesizefromstring($bytes);
            return $dimensions && $dimensions['mime']===$image[$ext] && max($dimensions[0],$dimensions[1])<=10000;
        }
        if ($ext==='pdf') return preg_match('/\A%PDF-\d\.\d(?:\r|\n)/',$bytes)===1;
        if ($ext==='xlsx') return self::isWorkbook($bytes);
        return preg_match('//u',$bytes)===1 && !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/',$bytes)
            && !preg_match('/\A\s*(?:\xEF\xBB\xBF)?\s*</',$bytes);
    }

    private static function isWorkbook(string $bytes): bool
    {
        if (!str_starts_with($bytes,"PK\x03\x04")) return false;
        // Inspect ZIP directory metadata without extracting or executing the document.
        $last=strrpos($bytes,"PK\x05\x06");
        if ($last===false || $last+22>strlen($bytes)) return false;
        $end=unpack('vdisk/vdirectoryDisk/vdiskCount/vcount/Vsize/Voffset/vcomment',substr($bytes,$last+4,18));
        if ($end['disk'] || $end['directoryDisk'] || $end['diskCount']!==$end['count'] || !$end['count'] ||
            $end['count']>1500 || $end['offset']+$end['size']!==$last || $last+22+$end['comment']!==strlen($bytes)) return false;
        $known=[];
        $inflated=0;
        $position=$end['offset'];
        for ($i=0;$i<$end['count'];$i++) {
            if ($position+46>$last || substr($bytes,$position,4)!=="PK\x01\x02") return false;
            $method=unpack('vflag/vmethod',substr($bytes,$position+8,4));
            $row=unpack('Vcompressed/Vraw/vname/vextra/vcomment',substr($bytes,$position+20,14));
            $next=$position+46+$row['name']+$row['extra']+$row['comment'];
            if ($next>$last || !$row['name'] || ($method['flag']&1) || !in_array($method['method'],[0,8],true)) return false;
            $name=substr($bytes,$position+46,$row['name']);
            if (!preg_match('~\A[A-Za-z0-9_./\[\] -]+\z~D',$name) || str_starts_with($name,'/') ||
                in_array('..',explode('/',$name),true) || preg_match('~(?:vbaProject|activeX/|embeddings/|externalLinks/)~i',$name) || isset($known[$name])) return false;
            $inflated+=$row['raw'];
            if ($inflated>32000000) return false;
            $known[$name]=true;
            $position=$next;
        }
        return $position===$last && isset($known['[Content_Types].xml'],$known['xl/workbook.xml']);
    }

    public static function download(PDO $db,string $ticket,string $id): never
    {
        $q=$db->prepare('SELECT a.name,a.bytes,a.size_bytes FROM clinic_support_attachment a
            JOIN clinic_support_reply r ON r.id=a.reply_id WHERE r.ticket_id=? AND a.id=?');
        $q->execute([$ticket,$id]);
        $file=$q->fetch();
        if (!$file) throw new RuntimeException('Ek bulunamadı.',404);
        header('Content-Type: application/octet-stream');
        header("Content-Disposition: attachment; filename=\"vetzimo-destek-eki\"; filename*=UTF-8''".rawurlencode($file['name']));
        header('X-Content-Type-Options: nosniff');
        header('Content-Length: '.$file['size_bytes']);
        echo $file['bytes'];
        exit;
    }
}
