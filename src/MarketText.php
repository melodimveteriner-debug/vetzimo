<?php
declare(strict_types=1);
namespace VetNet\Cpanel;

final class MarketText
{
    public static function editorFields(string $html): array
    {
        $fields=[];
        self::transform($html,[],$fields);
        if (!preg_match('~<main\b[^>]*>(.*?)</main>~is',$html,$main,PREG_OFFSET_CAPTURE)) return [];
        [$body,$start]=$main[1];
        $end=$start+strlen($body);
        $catalogStart=strpos($html,'<!-- vetnet-package-catalog -->');
        $catalogEnd=strpos($html,'<!-- /vetnet-package-catalog -->');
        preg_match_all('~<[^>]+\bdata-edit-area="([^"]+)"[^>]*>~i',$body,$areas,PREG_SET_ORDER|PREG_OFFSET_CAPTURE);
        $result=[];
        foreach ($fields as $key=>$row) {
            $offset=$row['offset'];
            if ($offset<$start || $offset>=$end || strtolower($row['tag'])==='h1') continue;
            if ($catalogStart!==false && $catalogEnd!==false && $offset>$catalogStart && $offset<$catalogEnd) continue;
            $group='Sayfa içeriği';
            foreach ($areas as $area) {
                if ($start+$area[0][1]>$offset) break;
                $group=html_entity_decode($area[1][0],ENT_QUOTES|ENT_HTML5,'UTF-8');
            }
            unset($row['offset']);
            $result[$key]=$row+['group'=>$group];
        }
        return $result;
    }

    public static function transform(string $html,array $edits,array &$fields): string
    {
        $occurrences=[];
        return preg_replace_callback('~<(h[1-6]|p|a|button|summary|label|strong|small|span|li)(\s[^>]*)?>([^<>]+)</\1>~iu',
            static function(array $matches) use($edits,&$fields,&$occurrences): string {
                $offset=$matches[0][1];
                $m=array_column($matches,0);
                $text=trim(html_entity_decode($m[3],ENT_QUOTES|ENT_HTML5,'UTF-8'));
                if ($text==='') return $m[0];
                $hash=substr(hash('sha256',$m[0]),0,24);
                $occurrences[$hash]=($occurrences[$hash] ?? 0)+1;
                $key=$hash.'-'.$occurrences[$hash];
                $fields[$key]=['tag'=>$m[1],'text'=>$text,'offset'=>$offset];
                if (!isset($edits[$key]) || strtolower($m[1])==='h1') return $m[0];
                return '<'.$m[1].($m[2] ?? '').'>'.htmlspecialchars($edits[$key],ENT_QUOTES,'UTF-8').'</'.$m[1].'>';
            },$html,-1,$count,PREG_OFFSET_CAPTURE) ?? $html;
    }
}
