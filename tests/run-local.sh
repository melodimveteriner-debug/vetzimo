#!/bin/bash
# Yerel (tek makine) test koşucusu: her test için boş bir veritabanı kurar,
# database/schema.sql + database/migrations uygular ve PHP testlerini çalıştırır.
# Gereken: yerel MariaDB'de şifresiz root@127.0.0.1 (yalnızca test makinesinde!).
set -uo pipefail
cd "$(dirname "$0")/.."
sql=(mariadb -h127.0.0.1 -uroot)
fresh() {
  "${sql[@]}" -e "DROP DATABASE IF EXISTS $1; CREATE DATABASE $1 CHARACTER SET utf8mb4;"
  [ "${2:-}" = empty ] && return
  "${sql[@]}" "$1" < database/schema.sql
  for f in database/migrations/*.sql; do "${sql[@]}" "$1" < "$f"; done
}
fail=0
run() { local name=$1; shift; if out=$("$@" 2>&1); then echo "GEÇTİ  $name"; else echo "KALDI  $name"; echo "$out" | tail -15 | sed 's/^/    /'; fail=1; fi; }
for f in src/*.php public/*.php bin/*.php tests/*.php; do php -l "$f" >/dev/null || { echo "SÖZDİZİMİ $f"; fail=1; }; done
echo "Sözdizimi denetimi tamam"
fresh test_core;      run core.php    env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_core' php tests/core.php
fresh test_installer empty; run install.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_installer' php tests/install.php
fresh test_roles empty;     run roles.php   env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_roles' php tests/roles.php
fresh test_partial empty;  run partial-save.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_partial' php tests/partial-save.php
fresh test_triage empty;  run homecare-triage.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_triage' php tests/homecare-triage.php
command -v node >/dev/null && run homecare-triage.mjs node tests/homecare-triage.mjs
fresh test_visit empty;    run home-visit.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_visit' php tests/home-visit.php
fresh test_staff empty;    run staff-booking.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_staff' php tests/staff-booking.php
fresh test_surgery empty;  run surgery.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_surgery' php tests/surgery.php
fresh test_icu empty;      run icu.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_icu' php tests/icu.php
fresh test_center empty;   run center.php  env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_center' php tests/center.php
if command -v node >/dev/null; then
  fx=$(mktemp); node tests/finance-fixtures.mjs "$fx" >/dev/null 2>&1 && run finance.php php tests/finance.php "$fx"; rm -f "$fx"
fi
exit $fail
