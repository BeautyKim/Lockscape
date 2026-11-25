import { createCredential, verifyPassword, isCredential } from "../src/crypto";
import { LOCALES, resolveLocale, getStrings, fmt } from "../src/i18n";
import en from "../src/i18n/en";

let fail = 0;
const check = (name: string, ok: boolean) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fail++; };

(async () => {
  const t0 = Date.now();
  const cred = await createCredential("correct horse battery");
  console.log("hash time ms:", Date.now() - t0);
  check("credential shape valid", isCredential(cred));
  check("correct password verifies", await verifyPassword("correct horse battery", cred));
  check("wrong password rejected", !(await verifyPassword("wrong", cred)));
  check("salt differs per credential", (await createCredential("x" + "y".repeat(8))).salt !== cred.salt);
  // Korean: NFC vs NFD (macOS vs Windows input) must match
  const ko = "비밀번호테스트1234";
  const kc = await createCredential(ko.normalize("NFC"));
  check("Korean NFD == NFC", await verifyPassword(ko.normalize("NFD"), kc));
  check("tampered iter rejected", !isCredential({ ...cred, iter: 1 }));
  check("tampered iter too large rejected", !isCredential({ ...cred, iter: 1e12 }));
  check("garbage rejected", !isCredential("x") && !isCredential(null) && !isCredential({}));

  // i18n
  const cases: [string, string][] = [["ko","ko"],["ko_KR","ko"],["en-US","en"],["ja","ja"],["zh","zh"],["zh-CN","zh"],["zh-TW","zh-tw"],["zh-Hant-HK","zh-tw"],["pt-BR","pt"],["pt","pt"],["es-MX","es"],["fr-CA","fr"],["de-AT","de"],["ru","ru"],["ar","en"],["",  "en"]];
  for (const [i, o] of cases) check(`resolveLocale(${JSON.stringify(i)}) = ${o}`, resolveLocale(i) === o);
  const keys = Object.keys(en).sort().join();
  for (const [code, s] of Object.entries(LOCALES)) {
    check(`${code}: all keys, none empty`, Object.keys(s).sort().join() === keys && Object.values(s).every(v => typeof v === "string" && v.length > 0));
  }
  for (const k of ["wait","minutes","seconds","tooShort"] as const)
    for (const [code, s] of Object.entries(LOCALES)) check(`${code}.${k} has {n}`, s[k].includes("{n}"));
  check("fmt", fmt(getStrings("ko").wait, 7) === "7초 후에 다시 시도하세요.");
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
})();
