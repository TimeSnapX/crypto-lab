// localStorage helpers. Everything stays on this device. No keys, no seed phrases, ever.
const P = "cl.";
export function load(key, fallback) {
  try { const v = localStorage.getItem(P + key); return v == null ? structuredClone(fallback) : JSON.parse(v); } catch { return structuredClone(fallback); }
}
export function save(key, value) { try { localStorage.setItem(P + key, JSON.stringify(value)); return true; } catch { return false; } }
export function exportAll() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(P) && !k.startsWith(P + "cache.")) out[k.slice(P.length)] = JSON.parse(localStorage.getItem(k)); }
  return { app: "crypto-lab", version: 1, exportedAt: new Date().toISOString(), data: out };
}
export function importAll(obj) {
  if (!obj || obj.app !== "crypto-lab" || typeof obj.data !== "object") throw new Error("Not a Crypto Lab backup file");
  for (const [k, v] of Object.entries(obj.data)) {
    if (/seed phrase|mnemonic|private key|xprv|wif/i.test(JSON.stringify(v))) throw new Error("Backup contains a field that looks like a secret; refused.");
    localStorage.setItem(P + k, JSON.stringify(v));
  }
}
