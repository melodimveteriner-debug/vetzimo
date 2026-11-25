<?php
// Sahte PayTR get-token: imzayı test anahtarlarıyla doğrular, jeton döner.
$p=$_POST;
$hash=$p['merchant_id'].$p['user_ip'].$p['merchant_oid'].$p['email'].$p['payment_amount'].$p['user_basket'].$p['no_installment'].$p['max_installment'].$p['currency'].$p['test_mode'];
$ok=hash_equals(base64_encode(hash_hmac('sha256',$hash.'TestSalt12345','TestKey12345',true)),$p['paytr_token'] ?? '');
header('Content-Type: application/json');
echo json_encode($ok?['status'=>'success','token'=>'tok'.substr($p['merchant_oid'],0,12)]:['status'=>'failed','reason'=>'imza hatali']);
