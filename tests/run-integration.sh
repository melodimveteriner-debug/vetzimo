#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
rt=${VETNET_TEST_RUNTIME:-/usr}
export LD_LIBRARY_PATH="$rt/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
php=("$rt/bin/php8.4" -n -d "extension_dir=$rt/lib/php/20240924" -d extension=mysqlnd -d extension=pdo -d extension=pdo_mysql)
testdir=$(mktemp -d "${TMPDIR:-/tmp}/vetnet-check-XXXXXX")
export VETNET_FINANCE_FIXTURES="$testdir/finance.json"
node cpanel/tests/finance-fixtures.mjs "$VETNET_FINANCE_FIXTURES"
cleanup() {
  for pid in "${server_pid:-}" "${db_pid:-}"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf -- "$testdir"
}
trap cleanup EXIT
"$rt/bin/mariadb-install-db" --no-defaults --basedir="$rt" --datadir="$testdir/db" --auth-root-authentication-method=normal --skip-test-db >"$testdir/install.log" 2>&1
"$rt/sbin/mariadbd" --no-defaults --basedir="$rt" --datadir="$testdir/db" --socket= --pid-file="$testdir/db.pid" --bind-address=127.0.0.1 --port=43328 >"$testdir/db.log" 2>&1 &
db_pid=$!
for i in {1..50}; do if "$rt/bin/mariadb" --no-defaults -h127.0.0.1 -P43328 -uroot -e 'SELECT 1' >/dev/null 2>&1; then break; fi; sleep 0.1; done
if ! kill -0 "$db_pid" 2>/dev/null; then
  echo 'The isolated test database did not start; refusing to connect to an existing server.' >&2
  exit 1
fi
sql=("$rt/bin/mariadb" --no-defaults -h127.0.0.1 -P43328 -uroot)
"${sql[@]}" -e 'CREATE DATABASE test_core; CREATE DATABASE test_installer; CREATE DATABASE test_http; CREATE DATABASE test_roles; CREATE DATABASE test_center;'
for f in cpanel/database/*.sql; do "${sql[@]}" test_core < "$f"; done
for f in cpanel/src/*.php cpanel/public/*.php cpanel/bin/*.php cpanel/tests/*.php; do "${php[@]}" -l "$f"; done
VETNET_TEST_DSN='mysql:host=127.0.0.1;port=43328;dbname=test_core' "${php[@]}" cpanel/tests/core.php
VETNET_TEST_DSN='mysql:host=127.0.0.1;port=43328;dbname=test_installer' "${php[@]}" cpanel/tests/install.php
VETNET_TEST_DSN='mysql:host=127.0.0.1;port=43328;dbname=test_roles' "${php[@]}" cpanel/tests/roles.php
"${php[@]}" cpanel/tests/finance.php "$VETNET_FINANCE_FIXTURES"
VETNET_TEST_DSN='mysql:host=127.0.0.1;port=43328;dbname=test_center' "${php[@]}" cpanel/tests/center.php
export VETNET_TEST_CONFIG="$testdir/config.php"
python3 - <<'PY'
import base64,os,secrets
root=os.getcwd()
open(os.environ['VETNET_TEST_CONFIG'],'w').write("<?php return "+"['origin'=>'https://vetnet.test','dsn'=>'mysql:host=127.0.0.1;port=43328;dbname=test_http','username'=>'root','password'=>'','installationToken'=>'"+'t'*48+"','rateSecret'=>'"+secrets.token_hex(32)+"','encryptionKey'=>'"+base64.b64encode(secrets.token_bytes(32)).decode()+"','assets'=>'"+root+"/dist/cpanel-assets'];")
PY
export VETNET_CPANEL_CONFIG="$testdir/config.php"
export VETNET_TEST_PUBLIC="$PWD/cpanel/public"
# Test harness only: represents an HTTPS terminator. Never shipped.
cat > "$testdir/router.php" <<'PHP'
<?php
$_SERVER['HTTPS']='on';
$root=getenv('VETNET_TEST_PUBLIC');
require $root.(parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH)==='/install.php'?'/install.php':'/index.php');
PHP
"${php[@]}" -S 127.0.0.1:43329 "$testdir/router.php" >"$testdir/http.log" 2>&1 &
server_pid=$!
sleep 0.2
if ! kill -0 "$server_pid" 2>/dev/null; then
  echo 'The isolated test HTTP server did not start.' >&2
  exit 1
fi
python3 cpanel/tests/http_checks.py
