// VetZimo.exe dosyasına simge ve sürüm bilgisi yazar (Wine gerektirmez; saf JavaScript).
import fs from "node:fs";
import * as ResEdit from "resedit";
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url)));
const exePath = new URL("../dist/win-unpacked/VetZimo.exe", import.meta.url);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), {ignoreCert: true});
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(new URL("./icon.ico", import.meta.url)));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map(i => i.data));
const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const [a, b, c] = pkg.version.split(".").map(Number);
vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({lang: 1033, codepage: 1200}, {ProductName: "VetZimo", FileDescription: "VetZimo · Veteriner klinik yönetimi", CompanyName: "VetZimo", LegalCopyright: "© VetZimo", OriginalFilename: "VetZimo.exe", InternalName: "VetZimo"});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log("VetZimo.exe: simge ve sürüm bilgisi yazıldı", pkg.version);
