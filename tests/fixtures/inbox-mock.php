<?php
// Gelen kutusu testi için sahte sağlayıcı: Meta Graph, Telegram Bot API ve Netgsm yanıtlarını taklit eder, istekleri kaydeder.
$uri = $_SERVER['REQUEST_URI'];
$body = file_get_contents('php://input');
file_put_contents(getenv('INBOX_MOCK_LOG') ?: sys_get_temp_dir().'/inbox-mock.log', json_encode(['method' => $_SERVER['REQUEST_METHOD'], 'uri' => $uri, 'body' => $body,
    'auth' => $_SERVER['HTTP_AUTHORIZATION'] ?? ''], JSON_UNESCAPED_UNICODE)."\n", FILE_APPEND);
header('Content-Type: application/json');
if (preg_match('~/messages$~', parse_url($uri, PHP_URL_PATH)) && str_contains($uri, '/me/')) { echo json_encode(['recipient_id' => '1', 'message_id' => 'mid.'.bin2hex(random_bytes(4))]); return; }
if (preg_match('~/v[0-9.]+/[0-9]+/messages$~', parse_url($uri, PHP_URL_PATH))) {
    $data = json_decode($body, true);
    if (($data['to'] ?? '') === '905550000999') { http_response_code(400); echo json_encode(['error' => ['message' => 'Recipient phone number not in allowed list']]); return; }
    echo json_encode(['messages' => [['id' => 'wamid.'.bin2hex(random_bytes(4))]]]); return;
}
if (preg_match('~fields=first_name~', $uri)) { echo json_encode(['first_name' => 'Can', 'last_name' => 'Er']); return; }
if (preg_match('~fields=name,username~', $uri)) { echo json_encode(['username' => 'pamukun_annesi']); return; }
if (preg_match('~fields=display_phone_number~', $uri)) { echo json_encode(['verified_name' => 'Test Kliniği']); return; }
if (str_contains($uri, '/setWebhook') || str_contains($uri, '/deleteWebhook')) { echo json_encode(['ok' => true, 'result' => true]); return; }
if (str_contains($uri, '/getMe')) { echo json_encode(['ok' => true, 'result' => ['username' => 'vzbot']]); return; }
if (str_contains($uri, '/sendMessage')) { echo json_encode(['ok' => true, 'result' => ['message_id' => 77]]); return; }
if (str_contains($uri, '/sms/rest/v2/send')) { echo json_encode(['code' => '00', 'jobid' => '123456']); return; }
http_response_code(404); echo json_encode(['error' => ['message' => 'mock: bilinmeyen adres '.$uri]]);
