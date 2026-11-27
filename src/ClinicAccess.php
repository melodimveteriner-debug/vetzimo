<?php
declare(strict_types=1);
namespace VetNet\Cpanel;
use RuntimeException;

final class ClinicAccess
{
    public const MODULES = [
        'appointments'=>['appointments'],'clients'=>['clients','documents','visitors'],
        'patients'=>['patients','weights','exams','labs','treatments','prescriptions','stays','surgeries'],
        'followups'=>['followups','vaccineCatalog'],'sales'=>['sales'],
        'products'=>['products','suppliers','purchases','stockLots','stockMoves'],
        'expenses'=>['expenses','collections','payments'],'reports'=>[],
        'messages'=>['messages','templates'],'support'=>[],'esmm'=>[],
        'overviewClients'=>[],'overviewPatients'=>[],
    ];
    /** Paketle açılıp kapatılan ve bayi yöneticisinin rol bazında verebildiği özellikler (anahtar => etiket). */
    public const FEATURES = [
        'inbox'=>'Sohbet (WhatsApp, Instagram, Facebook, Telegram, SMS, e-posta)','phoneGateway'=>'Telefon bağlantısı (kendi hattından SMS ve WhatsApp)',
        'reminders'=>'Otomatik hatırlatmalar','bulkMessages'=>'Toplu mesaj','permits'=>'Müşteri onay formu (KVKK ve ileti izni)',
        'consents'=>'Dijital onam ve imza','edocs'=>'e-Fatura / e-Arşiv / e-SMM','bridge'=>'ATS (aşı takip) ve İTS (ilaç takip) · Bakanlık kayıtları',
        'icu'=>'Yoğun bakım panosu','surgery'=>'Ameliyat modülü','homeCare'=>'Evden takip','homeVisit'=>'Eve hizmet',
        'webSite'=>'Web sitesi oluşturucu','onlineBooking'=>'Web randevu','vebot'=>'VeBot asistan','voice'=>'Sesli komut',
        'xray'=>'Röntgen yapay zekâ yorumu','dicom'=>'DICOM görüntüleyici','labAi'=>'Laboratuvar yorum desteği','calculators'=>'Klinik hesaplayıcılar',
        'taskBoard'=>'İş takibi panosu','commission'=>'Prim raporu','debtReminders'=>'Borç hatırlatma','bulkPrice'=>'Toplu fiyat ve Excel',
        'invoiceImport'=>'Faturadan stok','okc'=>'Yazar kasa (ÖKC)','devices'=>'Laboratuvar ve görüntüleme cihazları (hemogram, biyokimya, kan gazı, idrar, röntgen, ultrason, MR)',
    ];
    /** Hasta sahibi portalında gösterilebilecek bölümler. Yeni bölümler (evden takip, borç, belgeler) varsayılan olarak açıktır. */
    public const CUSTOMER_SECTIONS = ['vaccines','appointments','shares','exam','lab','xray','homeCare','balance','documents'];
    public const CUSTOMER_DEFAULT_ON = ['homeCare','balance','documents'];

    /** Özellik erişimi: paket kapatmışsa kimse kullanamaz; bayi yöneticisi pakete kadar, şube/personel kendi izni kadar (izin yoksa açık). */
    public static function feature(array $actor,string $key,bool $write=false): bool
    {
        if (!isset(self::FEATURES[$key]) || ($actor['packageFeatures'][$key] ?? true)===false) return false;
        if (($actor['role'] ?? '')==='dealer') return true;
        if (!in_array($actor['role'] ?? '',['branch','staff'],true)) return false;
        $grants=json_decode($actor['modules'] ?? '{}',true) ?: [];
        $value=$grants[$key] ?? 'write';
        return $write ? $value==='write' : in_array($value,['read','write'],true);
    }

    public const DELETE_GRANTS = [
        'patients'=>'deletePatients','clients'=>'deleteClients','appointments'=>'deleteAppointments',
        'products'=>'deleteProducts','sales'=>'deleteSales','collections'=>'deleteCollections','initialPayments'=>'deleteCollections',
        'expenses'=>'deleteCash','payments'=>'deleteCash','clinicNotes'=>'deleteNotes',
        'messages'=>'deleteMessages','templates'=>'deleteTemplates',
    ];
    public const ACTION_GRANTS = [
        ...self::DELETE_GRANTS,'homeVisit'=>'deleteHomeVisit','overviewSales'=>'overviewSales',
        'smsSend'=>'smsSend','whatsappSend'=>'whatsappSend','smsHistory'=>'smsHistory','whatsappHistory'=>'whatsappHistory',
        'backup'=>'backup','dataImport'=>'dataImport','spreadsheet'=>'spreadsheet','cashCorrect'=>'cashCorrect',
    ];

    public static function action(array $actor,string $grant,bool $write=false): bool
    {
        if ($actor['role']==='dealer') return true;
        if (!in_array($actor['role'],['branch','staff'],true)) return false;
        $value=self::modules($actor)->$grant??'none';
        return $write?$value==='write':in_array($value,['read','write'],true);
    }

    public static function deleteAllowed(array $actor,string $collection): bool
    {
        $grant=self::DELETE_GRANTS[$collection]??'';
        if ($grant==='' || !self::action($actor,$grant,true)) return false;
        if ($collection==='clinicNotes') return in_array($actor['role'],['dealer','branch','staff'],true);
        if ($collection==='initialPayments') return self::allowed($actor,'sales',true) && self::allowed($actor,'collections',true);
        return self::allowed($actor,$collection,true);
    }
    public static function branch(object $state,string $id): ?object
    {
        foreach ($state->branches ?? [] as $row) if ($row->id === $id && ($row->status ?? '') !== 'Pasif') return $row;
        return null;
    }
    public static function valid(array $actor,?object $state): bool
    {
        if (!$state) return $actor['role'] === 'dealer';
        if ($actor['role'] === 'dealer') return true;
        $branch=self::branch($state,$actor['branch_id']);
        if (!$branch) return false;
        if ($actor['role'] !== 'customer') return in_array($actor['role'],['staff','branch'],true);
        foreach ($state->clients ?? [] as $client) {
            if ($client->id === $actor['customer_id'] && $client->branch === (($branch->sharedWith ?? '') ?: $branch->id) &&
                DealerLogin::normalizePhone($client->phone ?? '') === $actor['identifier']) return true;
        }
        return false;
    }
    public static function modules(array $actor): object
    {
        $modules=json_decode($actor['modules'] ?? '{}',false,32,JSON_THROW_ON_ERROR);
        foreach ($actor['packageModules'] ?? [] as $key=>$cap) {
            if ($actor['role']==='dealer' || $cap==='none') $modules->$key=$cap;
            elseif ($cap==='read' && ($modules->$key ?? '')==='write') $modules->$key='read';
        }
        if (in_array($actor['role'] ?? '',['dealer','branch','staff'],true)) {
            foreach (array_keys(self::FEATURES) as $key) {
                $modules->$key=self::feature($actor,$key,true)?'write':(self::feature($actor,$key)?'read':'none');
            }
        } elseif (($actor['role'] ?? '')==='customer') {
            foreach (self::CUSTOMER_DEFAULT_ON as $key) if (!isset($modules->$key)) $modules->$key='read';
        }
        return $modules;
    }
    public static function module(string $collection): ?string
    {
        foreach(self::MODULES as $module=>$keys) if(in_array($collection,$keys,true)) return $module;
        return null;
    }
    public static function allowed(array $actor,string $collection,bool $write=false): bool
    {
        if ($actor['role']==='dealer' && (!isset($actor['packageModules']) || self::module($collection)===null)) return !in_array($collection,['users','dealers'],true);
        if (!in_array($actor['role'],['dealer','branch','staff'],true)) return false;
        if($collection==='clinicNotes') return !$write || $actor['role']==='branch';
        // İş takibi panosu: klinik ekibinin ortak listesi; "İş takibi panosu" izni kapalıysa görülmez ve değiştirilemez.
        if($collection==='tasks') return self::feature($actor,'taskBoard',$write);
        // Ameliyat kayıtları hasta modülüne bağlıdır ama "Ameliyat modülü" izni kapalıysa erişilemez.
        if($collection==='surgeries' && !self::feature($actor,'surgery',$write)) return false;
        $module=self::module($collection);
        $grant=self::modules($actor)->{$module ?? ''} ?? 'none';
        return $write ? $grant==='write' : in_array($grant,['read','write'],true);
    }
    public static function visible(object $state,array $actor): object
    {
        if (!self::valid($actor,$state) || $actor['role']==='customer') throw new RuntimeException('Klinik erişimi doğrulanamadı.',403);
        if ($actor['role']==='dealer') {
            $out=clone $state;
            foreach (self::MODULES as $collections) foreach ($collections as $key) {
                if (isset($out->$key) && !self::allowed($actor,$key)) $out->$key=[];
            }
            return $out;
        }
        $branch=self::branch($state,$actor['branch_id']);
        $dataId=$branch->sharedWith ?? $branch->id;
        if ($dataId==='') $dataId=$branch->id;
        $out=(object)['version'=>1,'demo'=>false,'branches'=>[$branch],'preferences'=>$state->preferences];
        foreach ($state as $key=>$rows) {
            if (!is_array($rows) || $key==='branches') continue;
            $out->$key=self::allowed($actor,$key)?array_values(array_filter($rows,fn($r)=>($r->branch ?? '')===$dataId)):[];
        }
        return $out;
    }
}
