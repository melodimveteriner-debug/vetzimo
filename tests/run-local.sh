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
run external-import.php php tests/external-import.php
fresh test_scale;  run scale.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_scale' php -d memory_limit=1G tests/scale.php
fresh test_conc;  run concurrency.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_conc' php tests/concurrency.php
fresh test_merge empty; run merge.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_merge' php tests/merge.php
fresh test_cold;   run cold.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_cold' php -d memory_limit=1G tests/cold.php
fresh test_perm empty; run permissions.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_perm' php tests/permissions.php
fresh test_usage empty; run app-usage.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_usage' php tests/app-usage.php
fresh test_reset empty; run password-reset.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_reset' php tests/password-reset.php
fresh test_family empty; run family-photos.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_family' php tests/family-photos.php
fresh test_rtpl empty; run reminder-templates.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_rtpl' php tests/reminder-templates.php
run agent-download.php php tests/agent-download.php
fresh test_vc empty; run vaccine-continuation.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_vc' php tests/vaccine-continuation.php
fresh test_saledisc empty; run sale-discounts.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_saledisc' php tests/sale-discounts.php
fresh test_triage empty;  run homecare-triage.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_triage' php tests/homecare-triage.php
command -v node >/dev/null && run homecare-triage.mjs node tests/homecare-triage.mjs
command -v node >/dev/null && run xray-rules.mjs node tests/xray-rules.mjs
command -v node >/dev/null && run voice-clinical.mjs node tests/voice-clinical.mjs
command -v node >/dev/null && run device-parsers.mjs node tests/device-parsers.mjs
command -v node >/dev/null && run device-agent.mjs node tests/device-agent.mjs
command -v node >/dev/null && run vet-knowledge.mjs node tests/vet-knowledge.mjs
fresh test_visit empty;    run home-visit.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_visit' php tests/home-visit.php
fresh test_staff empty;    run staff-booking.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_staff' php tests/staff-booking.php
fresh test_surgery empty;  run surgery.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_surgery' php tests/surgery.php
fresh test_icu empty;      run icu.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_icu' php tests/icu.php
fresh test_consent empty;  run consent.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_consent' php tests/consent.php
fresh test_tfa empty;      run team-2fa.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_tfa' php tests/team-2fa.php
fresh test_debt empty;     run debt-message.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_debt' php tests/debt-message.php
fresh test_tasks empty;    run tasks.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_tasks' php tests/tasks.php
fresh test_bridge empty;   run bridge.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_bridge' php tests/bridge.php
fresh test_legal empty;    run legal.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_legal' php tests/legal.php
fresh test_inbox empty;    run inbox.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_inbox' php tests/inbox.php
fresh test_phone empty;    run phone-gateway.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_phone' php tests/phone-gateway.php
fresh test_permit empty;   run client-permit.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_permit' php tests/client-permit.php
fresh test_edoc empty;     run edoc.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_edoc' php tests/edoc.php
fresh test_pkg empty;      run package-features.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_pkg' php tests/package-features.php
fresh test_saas empty;     run saas-payment.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_saas' php tests/saas-payment.php
fresh test_agree empty;    run dealer-agreement.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_agree' php tests/dealer-agreement.php
fresh test_alert empty;    run clinic-alerts.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_alert' php tests/clinic-alerts.php
fresh test_apphub empty;  run app-hub.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_apphub' php tests/app-hub.php
fresh test_dev empty;     run device-hub.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_dev' php tests/device-hub.php
fresh test_track empty;   run visit-track.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_track' php tests/visit-track.php
fresh test_dldemo empty;  run downloads-demo.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_dldemo' php tests/downloads-demo.php
fresh test_ids empty;     run settings-ids.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_ids' php tests/settings-ids.php
fresh test_guide empty;   run clinic-guide.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_guide' php tests/clinic-guide.php
fresh test_legal empty;   run clinic-legal.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_legal' php tests/clinic-legal.php
fresh test_contact empty; run site-contact.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_contact' php tests/site-contact.php
fresh test_life empty;    run partner-lifecycle.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_life' php tests/partner-lifecycle.php
run pregnancy.php php tests/pregnancy.php
fresh test_preg empty; run pregnancy-db.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_preg' php tests/pregnancy-db.php
run daily-note.php php tests/daily-note.php
fresh test_paypkg empty;  run payments-packages.php env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_paypkg' php tests/payments-packages.php
fresh test_center empty;   run center.php  env VETNET_TEST_DSN='mysql:host=127.0.0.1;dbname=test_center' php tests/center.php
if command -v node >/dev/null; then
  fx=$(mktemp); node tests/finance-fixtures.mjs "$fx" >/dev/null 2>&1 && run finance.php php tests/finance.php "$fx"; rm -f "$fx"
fi
exit $fail
