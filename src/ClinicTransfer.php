<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

use PDO;
use RuntimeException;

final class ClinicTransfer
{
    public function __construct(private readonly PDO $db) {}

    public function handle(array $actor,?object $input,string $branch,bool $export): array
    {
        $canImport=ClinicAccess::action($actor,'dataImport',true);
        $canBackup=ClinicAccess::action($actor,'backup');
        if ((!$input && !$canImport && !$canBackup) || ($input && !$canImport) || ($export && !$canBackup)) {
            throw new RuntimeException('Bu işlem için veri aktarımı veya yedek izniniz yok.',403);
        }
        $repository=new WorkspaceRepository($this->db);
        $partner=$actor['partner_id'];
        if ($input) $this->db->beginTransaction();
        try {
            if ($input) {
                $lock=$this->db->prepare('SELECT id FROM partner_account WHERE id=? FOR UPDATE');
                $lock->execute([$partner]);
                $lock->fetchColumn();
            }
            $current=$repository->load('partner:'.$partner);
            $state=$current['state'];
            $visible=ClinicAccess::visible($state,$actor);
            $branches=array_values(array_filter($visible->branches,static fn($row)=>($row->status??'')!=='Pasif'));
            if (!$input && $branch==='') {
                if ($export) throw new RuntimeException('Yedeği indirilecek şubeyi seçin.',422);
                return ['branches'=>$branches];
            }
            $branch=$input->branch ?? $branch;
            if (!is_string($branch) || !in_array($branch,array_column($branches,'id'),true)) throw new RuntimeException('Şubeye erişiminiz yok.',403);
            $target=ClinicAccess::branch($state,$branch);
            $dataBranch=($target->sharedWith??'')?:$branch;
            if (!$input) {
                if (!$canBackup) throw new RuntimeException('Şube yedeğini indirme izniniz yok.',403);
                if (!$export && !ClinicAccess::action($actor,'spreadsheet')) throw new RuntimeException('Excel indirme izniniz yok.',403);
                $data=[];
                foreach ($visible as $key=>$rows) {
                    if ($key==='branches' || !is_array($rows) || !ClinicAccess::module($key) || !ClinicAccess::allowed($actor,$key)) continue;
                    $data[$key]=array_values(array_filter($rows,static fn($row)=>($row->branch??'')===$dataBranch));
                }
                return ['format'=>'vetnet-workspace-v1','partner'=>$partner,'branch'=>$branch,'datasets'=>$data,
                    'state'=>['branches'=>[$target],...$data],'importTables'=>array_keys(ExternalImport::TABLES),'revision'=>$current['revision']];
            }
            $source=$input->datasets??null;
            $apply=($input->action??'')==='apply';
            if (!$source instanceof \stdClass || !in_array($input->action??'',['apply','preview'],true)) throw new RuntimeException('Aktarım dosyası geçersiz.',422);
            if ($apply && (($input->confirm??null)!==true || ($input->revision??null)!==$current['revision'])) throw new RuntimeException('Kayıtlar güncellendi. Aktarımı yeniden önizleyin.',409);
            foreach ($source as $key=>$items) if (!is_array($items) || !ClinicAccess::module($key) || !ClinicAccess::allowed($actor,$key,true)) {
                throw new RuntimeException('Aktarılan tabloda yazma izniniz yok.',403);
            }
            [$next,$counts]=ExternalImport::merge($state,$source,$dataBranch,($input->source??'')==='vetnet');
            $imported=$skipped=0;
            foreach ($counts as &$count) {
                $count['added']+=$count['updated'];
                $count['skipped']=$count['unchanged'];
                $imported+=$count['added'];
                $skipped+=$count['skipped'];
            }
            unset($count);
            if ($apply && $imported) {
                $revision=$repository->save('partner:'.$partner,$current['revision'],$next);
                if (!$revision) throw new RuntimeException('Kayıtlar değişti. Yeniden önizleyin.',409);
                $this->db->prepare("INSERT INTO clinic_audit(partner_id,account_id,action,revision) VALUES (?,?,'workspace.imported',?)")
                    ->execute([$partner,$actor['account_id'],$revision]);
            }
            $this->db->commit();
            return ['revision'=>$current['revision'],'imported'=>$imported,'skipped'=>$skipped,'counts'=>$counts,'totalIssues'=>0,'issues'=>[]];
        } catch (\Throwable $error) {
            if ($input && $this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }
}
