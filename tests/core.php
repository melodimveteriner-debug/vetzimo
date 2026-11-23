<?php
declare(strict_types=1);

use VetNet\Cpanel\Database;
use VetNet\Cpanel\DealerLogin;
use VetNet\Cpanel\DealerWorkspace;
use VetNet\Cpanel\SessionRepository;

foreach (['Finance','ClinicAccess','WorkspaceRepository','Database','DealerLogin','SessionRepository','DealerWorkspace'] as $class) {
    require __DIR__ . '/../src/' . $class . '.php';
}

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function expectCode(int $code, callable $action): void {
    try {
        $action();
    } catch (RuntimeException $error) {
        if ($error->getCode() === $code) return;
        throw $error;
    }
    throw new RuntimeException('Expected error ' . $code);
}

$db = Database::connect(getenv('VETNET_TEST_DSN') ?: '', getenv('VETNET_TEST_USER') ?: 'root', getenv('VETNET_TEST_PASSWORD') ?: '');
$now = time();
$password = 'Test clinic ' . bin2hex(random_bytes(12));
$hash = password_hash($password, PASSWORD_ARGON2ID);
$partner = $db->prepare('INSERT INTO partner_account (id,code,name,email,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)');
$account = $db->prepare("INSERT INTO identity_account (id,kind,identifier,password_hash) VALUES (?,'phone',?,?)");
$member = $db->prepare("INSERT INTO identity_membership (id,account_id,partner_id,role,modules,status) VALUES (?,?,?,'dealer','{}','active')");
foreach (['a','b'] as $i => $key) {
    $partner->execute([$key, $key, $key, $key.'@example.test', gmdate('c', $now), gmdate('c', $now)]);
    $account->execute(['account-'.$key, '+90555100000'.($i+1), $hash]);
    $member->execute(['member-'.$key, 'account-'.$key, $key]);
}

$login = new DealerLogin($db, random_bytes(32));
$sessions = new SessionRepository($db);
$workspaces = new DealerWorkspace($db);
check($login->signIn('0555 100 00 01', 'wrong', '192.0.2.1', $now) === null, 'Wrong password accepted');
$a = $login->signIn('0555 100 00 01', $password, '192.0.2.1', $now);
$b = $login->signIn('+90 555 100 00 02', $password, '192.0.2.2', $now);
check($a !== null && $b !== null, 'Dealer login failed');
$cookies = fn(array $row): array => [
    SessionRepository::SESSION_COOKIE => $row['token'], SessionRepository::DEVICE_COOKIE => $row['device'],
];
check($sessions->resolve($cookies($a), $now)['partner_id'] === 'a', 'Wrong dealer resolved');
check($sessions->resolve($cookies(['token'=>$a['token'],'device'=>$b['device']]), $now) === null, 'Wrong device accepted');
check($sessions->resolve($cookies($a), $now+1801) === null, 'Idle session accepted');
expectCode(403, fn() => $workspaces->read([], $now));
check($workspaces->writeValidated($cookies($a), 'member-a', $now, 0, (object) ['version'=>1,'clients'=>[]]) === 1, 'Initial write failed');
check($workspaces->read($cookies($b), $now)['revision'] === 0, 'Other clinic data visible');
expectCode(409, fn() => $workspaces->writeValidated($cookies($a), 'member-b', $now, 0, (object) ['version'=>1]));
check($workspaces->writeValidated($cookies($a), 'member-a', $now, 0, (object) ['version'=>1]) === null, 'Stale write accepted');
check($workspaces->writeValidated($cookies($a), 'member-a', $now, 1, (object) ['version'=>1]) === 2, 'Update failed');
$db->exec("UPDATE identity_membership SET status='revoked' WHERE id='member-a'");
check($sessions->resolve($cookies($a), $now) === null, 'Revoked membership accepted');
$login->signOut($b['token'], $b['device']);
check($sessions->resolve($cookies($b), $now) === null, 'Logout did not invalidate session');
for ($i=0; $i<10; $i++) $login->signIn('', '', '192.0.2.3', $now);
expectCode(429, fn() => $login->signIn('', '', '192.0.2.3', $now));

check((int)$db->query('SELECT COUNT(*) FROM clinic_audit')->fetchColumn() === 2, 'Audit writes missing or duplicate');
echo "PHP/MySQL-compatible core integration checks passed.\n";
