// Bitcoin address format validation (read-only, no keys involved).
// Base58Check (P2PKH / P2SH) with SHA-256d checksum, bech32 (BIP173) and bech32m (BIP350).

const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
  0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
  0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
  0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);

export function sha256(bytes) {
  const l = bytes.length, bitLen = l * 8;
  const n = ((l + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 4, bitLen >>> 0); dv.setUint32(n - 8, Math.floor(bitLen / 4294967296));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, r) => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i-15], 7) ^ rotr(W[i-15], 18) ^ (W[i-15] >>> 3);
      const s1 = rotr(W[i-2], 17) ^ rotr(W[i-2], 19) ^ (W[i-2] >>> 10);
      W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=h;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let bytes = [0];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === "1") bytes.push(0); else break; }
  return new Uint8Array(bytes.reverse());
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= G[i];
  }
  return chk;
}
function hrpExpand(hrp) {
  const r = [];
  for (const c of hrp) r.push(c.charCodeAt(0) >> 5);
  r.push(0);
  for (const c of hrp) r.push(c.charCodeAt(0) & 31);
  return r;
}
function convertBits(data, from, to) {
  let acc = 0, bits = 0; const out = []; const maxv = (1 << to) - 1;
  for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } }
  if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

export const TYPES = {
  p2pkh: { name: "P2PKH (legacy)", prefix: "1…", note: "The original address type. Highest fees per input. Starts with 1." },
  p2sh: { name: "P2SH (script hash)", prefix: "3…", note: "Pays to a script: often multisig or wrapped SegWit. Starts with 3." },
  p2wpkh: { name: "P2WPKH (native SegWit, bech32)", prefix: "bc1q… (42 chars)", note: "Native SegWit single key. Lower fees, lowercase only." },
  p2wsh: { name: "P2WSH (SegWit script, bech32)", prefix: "bc1q… (62 chars)", note: "Native SegWit script, used for multisig and Lightning channels." },
  p2tr: { name: "P2TR (Taproot, bech32m)", prefix: "bc1p…", note: "Taproot (2021). Schnorr signatures, better privacy for complex scripts." },
};

/** Validate a mainnet Bitcoin address. Returns { valid, type?, network?, error? }. */
export function validateAddress(input) {
  const a = String(input || "").trim();
  if (!a) return { valid: false, error: "Empty" };
  if (/^(xprv|yprv|zprv|tprv)/.test(a) || /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(a))
    return { valid: false, error: "That looks like a PRIVATE KEY. Never paste private keys anywhere. This app only needs public addresses.", danger: true };
  if (a.split(/\s+/).length >= 12) return { valid: false, error: "That looks like a seed phrase. Never share it. This app never needs it.", danger: true };
  const lower = a.toLowerCase();
  if (/^(bc1|tb1|bcrt1)/.test(lower)) {
    if (a !== lower && a !== a.toUpperCase()) return { valid: false, error: "Mixed case is not allowed in bech32 addresses" };
    const pos = lower.lastIndexOf("1");
    const hrp = lower.slice(0, pos), data = [];
    for (const c of lower.slice(pos + 1)) { const v = CHARSET.indexOf(c); if (v < 0) return { valid: false, error: `Invalid character "${c}"` }; data.push(v); }
    if (data.length < 7 || lower.length > 90) return { valid: false, error: "Wrong length" };
    const pm = polymod([...hrpExpand(hrp), ...data]);
    const enc = pm === 1 ? "bech32" : pm === 0x2bc830a3 ? "bech32m" : null;
    if (!enc) return { valid: false, error: "Checksum failed (typo?)" };
    const ver = data[0];
    const prog = convertBits(data.slice(1, -6), 5, 8);
    if (!prog || prog.length < 2 || prog.length > 40) return { valid: false, error: "Invalid witness program" };
    if (ver === 0 && enc !== "bech32") return { valid: false, error: "SegWit v0 must use bech32" };
    if (ver !== 0 && enc !== "bech32m") return { valid: false, error: "SegWit v1+ must use bech32m" };
    const network = hrp === "bc" ? "mainnet" : hrp === "tb" ? "testnet" : "regtest";
    let type = null;
    if (ver === 0 && prog.length === 20) type = "p2wpkh";
    else if (ver === 0 && prog.length === 32) type = "p2wsh";
    else if (ver === 1 && prog.length === 32) type = "p2tr";
    else if (ver === 0) return { valid: false, error: "Invalid v0 program length" };
    else type = "future";
    if (network !== "mainnet") return { valid: false, type, network, error: `This is a ${network} address. Only mainnet lookups are supported.` };
    return { valid: true, type, network, encoding: enc };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(a)) return { valid: false, error: "Not a recognised Bitcoin address format" };
  const raw = b58decode(a);
  if (!raw || raw.length !== 25) return { valid: false, error: "Wrong length for a Base58 address" };
  const body = raw.slice(0, 21), chk = raw.slice(21);
  const h = sha256(sha256(body));
  for (let i = 0; i < 4; i++) if (h[i] !== chk[i]) return { valid: false, error: "Checksum failed (typo?)" };
  const v = body[0];
  if (v === 0x00) return { valid: true, type: "p2pkh", network: "mainnet", encoding: "base58" };
  if (v === 0x05) return { valid: true, type: "p2sh", network: "mainnet", encoding: "base58" };
  if (v === 0x6f || v === 0xc4) return { valid: false, network: "testnet", error: "This is a testnet address. Only mainnet lookups are supported." };
  return { valid: false, error: `Unknown version byte ${v}` };
}
