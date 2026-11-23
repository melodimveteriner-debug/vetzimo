<?php
declare(strict_types=1);
use VetNet\Cpanel\Finance;
require __DIR__.'/../src/Finance.php';
$pairs=json_decode(file_get_contents($argv[1]),false,64,JSON_THROW_ON_ERROR);
foreach($pairs as $pair) Finance::validate($pair->old,$pair->next);
function invalid(object $pair,callable $edit): void {
 $copy=json_decode(json_encode($pair->next));$edit($copy);
 try { Finance::validate($pair->old,$copy); } catch(RuntimeException $e) { if($e->getCode()===422)return;throw $e; }
 throw new RuntimeException('Invalid finance data accepted');
}
$sale=$pairs[2];
invalid($sale,function($n){$n->sales[0]->amount='1';});
invalid($sale,function($n){$n->sales[0]->paid='9999';});
invalid($sale,function($n){$n->stockMoves=[];$n->stockLots[0]->remaining='10';$n->products[0]->stock='10';});
invalid($sale,function($n){$n->sales[0]->stockAllocations='[]';});
invalid($pairs[3],function($n){$n->collections[0]->amount='126';});
invalid($pairs[3],function($n){$n->sales[0]->amount='1';});
echo "PASS existing JavaScript clinical model to PHP financial validation: product, discounted VAT sale, stock reduction, partial collection, purchase, payment, expense; rejected tampered total, overpayment, missing stock movement and allocation\n";
