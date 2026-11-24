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
