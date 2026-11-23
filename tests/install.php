<?php
declare(strict_types=1);
use VetNet\Cpanel\Database;
use VetNet\Cpanel\Installer;
use VetNet\Cpanel\DealerLogin;
require __DIR__.'/bootstrap.php';
$db = Database::connect(getenv('VETNET_TEST_DSN'), 'root', '');
$installer = new Installer($db,dirname(__DIR__));
try { $installer->install('Test','invalid','vet@example.test','short'); throw new Exception('Invalid input accepted'); }
catch (RuntimeException $e) { if ($e->getCode() !== 422) throw $e; }
if ($db->query('SHOW TABLES')->fetch()) throw new Exception('Invalid input created tables');
$installer->install('Test Klinik','05551000003','vet@example.test','Test-setup-password-42');
$first = $db->query('SELECT payload FROM clinic_workspace')->fetchColumn();
if (!str_contains($first,'Test Klinik')) throw new Exception('Clinic name missing');
try { $installer->install('Replace','05551000004','replace@example.test','Test-setup-password-42'); throw new Exception('Reinstall accepted'); }
catch (RuntimeException $e) { if ($e->getCode() !== 409) throw $e; }
if ($first !== $db->query('SELECT payload FROM clinic_workspace')->fetchColumn()) throw new Exception('Existing workspace changed');
if (!(new DealerLogin($db,str_repeat('x',32)))->signIn('05551000003','Test-setup-password-42','192.0.2.1',time())) throw new Exception('Installed login failed');
echo "PASS fresh install, input validation, reinstall protection, data preservation, installed account login\n";
