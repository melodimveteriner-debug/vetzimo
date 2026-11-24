// Tarayıcı ön değerlendirme motoru, PHP motoruyla aynı vaka dosyasını geçmelidir.
import {readFileSync} from "node:fs";
import {evaluate} from "../public/homecare-triage.js";
const root = new URL("..", import.meta.url);
const rules = JSON.parse(readFileSync(new URL("public/homecare-triage.json", root), "utf8"));
const cases = JSON.parse(readFileSync(new URL("tests/homecare-triage-cases.json", root), "utf8"));
let failed = 0;
for (const c of cases) {
  const r = evaluate(rules, {observation: c.observation || "routine", details: c.details || {}, note: c.note});
  if (r.level !== c.level || c.has.some(code => !r.reasons.includes(code))) { failed++; console.error("HATA", c.note, r); }
}
if (failed) process.exit(1);
console.log(`PASS tarayıcı ön değerlendirme motoru: ${cases.length} vaka`);
