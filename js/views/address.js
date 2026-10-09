import { h, card, money, btc, num, badge, field, toast, time, date } from "../ui.js";
import { load, save } from "../store.js";
import { addressInfo, btcPrice } from "../api.js";
import { validateAddress, TYPES } from "../btcaddr.js";

export const FAMOUS = [
  { addr: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", label: "Satoshi genesis address", note: "Received the first ever block reward (3 Jan 2009). Those 50 BTC can never be spent; people still send it tips." },
  { addr: "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo", label: "Binance cold wallet (widely reported)", note: "One of the largest P2SH addresses on the rich lists." },
  { addr: "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF", label: "'1Feex' Mt. Gox-linked address (widely reported)", note: "Holds ~80k BTC widely linked to coins stolen from Mt. Gox in 2011; untouched since." },
  { addr: "bc1qazcm763858nkj2dj986etajv6wquslv8uxwczt", label: "Bitfinex 2016 hack address (widely reported)", note: "Native SegWit example linked to the 2016 Bitfinex hack." },
  { addr: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", label: "Taproot format example (BIP350 test vector)", note: "A bc1p… Taproot address used as a reference example in the BIP350 specification." },
];

export async function render(root, ctx) {
  let book = load("addrbook", []);
  const look = card("Look up an address");
  const result = h("div");
  const bookCard = card("Watch-only address book");
  const famous = card("Famous addresses");
  const types = card("Address types explained");
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Bitcoin addresses"), h("p", {}, "Paste any address to check its format and look up its public balance and history.")),
    h("p", { class: "note good" }, "Read-only. An address is public, like a bank account number. Crypto Lab never asks for private keys or seed phrases, and you should never paste them anywhere."),
    look, bookCard, famous, types);

  const addrIn = h("input", { placeholder: "1…, 3…, bc1q… or bc1p…", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Bitcoin address" });
  const status = h("p", { class: "muted", "data-k": "valid" });
  addrIn.addEventListener("input", () => showValid());
  function showValid() {
    const v = validateAddress(addrIn.value);
    if (!addrIn.value.trim()) return status.replaceChildren("");
    if (v.danger) { addrIn.value = ""; status.replaceChildren(h("span", { class: "down" }, "⛔ " + v.error)); return v; }
    status.replaceChildren(v.valid ? h("span", { class: "ok" }, `✓ Valid ${TYPES[v.type]?.name || v.type} · ${v.encoding}`) : h("span", { class: "down" }, `✗ ${v.error}`));
    return v;
  }
  look.append(addrIn, status, h("div", { class: "row" }, h("button", { class: "primary", onclick: () => lookup(addrIn.value.trim()) }, "Look up"), h("button", { onclick: () => addToBook(addrIn.value.trim()) }, "＋ Watch")), result);

  async function lookup(a) {
    addrIn.value = a; const v = showValid();
    if (!v?.valid) return;
    result.replaceChildren(h("p", { class: "muted" }, "Looking up…"));
    const [r, p] = await Promise.all([addressInfo(a), btcPrice()]);
    const aud = p.data?.aud;
    if (!r.data) return result.replaceChildren(badge(r, { exampleLabel: "Lookup failed: both mempool.space and Blockstream are unreachable" }));
    const d = r.data;
    const bal = d.balanceSat / 1e8;
    const entry = book.find((b) => b.addr === a);
    if (entry) { entry.lastBalance = bal; entry.lastChecked = Date.now(); save("addrbook", book); paintBook(); }
    result.replaceChildren(badge(r),
      h("div", { class: "stats" }, h("div", { class: "stat", "data-k": "balance" }, h("span", {}, "Balance"), h("b", {}, btc(bal)), h("small", {}, aud ? `≈ ${money(bal * aud)} (${p.source})` : "AUD price unavailable")),
        h("div", { class: "stat", "data-k": "txcount" }, h("span", {}, "Transactions"), h("b", {}, num(d.txCount, 0)), h("small", {}, d.mempoolTx ? `${d.mempoolTx} unconfirmed` : "")),
        h("div", { class: "stat" }, h("span", {}, "Total received"), h("b", {}, btc(d.received / 1e8, 4))), h("div", { class: "stat" }, h("span", {}, "Type"), h("b", {}, v.type.toUpperCase()), h("small", {}, TYPES[v.type]?.prefix || ""))),
      h("h3", {}, "Recent transactions"),
      h("ul", { class: "list" }, d.txs.map((t) => h("li", {}, h("b", { class: t.delta >= 0 ? "up" : "down" }, `${t.delta >= 0 ? "+" : ""}${btc(t.delta / 1e8)}`), " ", h("small", {}, t.confirmed ? date(t.time) : "unconfirmed"), h("br"),
        h("a", { class: "mono", href: `https://mempool.space/tx/${t.txid}`, target: "_blank", rel: "noopener noreferrer" }, t.txid.slice(0, 20) + "…")))),
      h("p", { class: "muted" }, h("a", { href: `https://mempool.space/address/${a}`, target: "_blank", rel: "noopener noreferrer" }, "Open on mempool.space ↗")));
  }
  function addToBook(a, label = "", note = "") {
    const v = validateAddress(a); if (!v.valid) return toast(v.error || "Invalid address", "bad");
    if (book.some((b) => b.addr === a)) return toast("Already in your address book");
    book.unshift({ addr: a, label: label || prompt("Label for this address?", "") || "Unlabelled", note, type: v.type, added: Date.now() });
    save("addrbook", book); paintBook(); toast("Added (watch-only)");
  }
  function paintBook() {
    bookCard.replaceChildren(h("h2", {}, "Watch-only address book"), h("p", { class: "muted" }, "Saved only on this device. Labels and notes are yours; balances are fetched when you tap Check."),
      book.length ? h("ul", { class: "list" }, book.map((b, i) => {
        const noteIn = h("input", { value: b.note || "", placeholder: "Notes", "aria-label": "Notes" });
        noteIn.addEventListener("change", () => { b.note = noteIn.value; save("addrbook", book); });
        return h("li", {}, h("b", {}, b.label), " ", h("span", { class: "tag" }, TYPES[b.type]?.prefix || b.type), h("div", { class: "mono" }, b.addr),
          b.lastBalance != null ? h("small", {}, `Last balance ${btc(b.lastBalance)}${ctx.price("bitcoin", "AUD") ? ` ≈ ${money(b.lastBalance * ctx.price("bitcoin", "AUD"))}` : ""} · ${time(b.lastChecked)}`) : null, noteIn,
          h("div", { class: "row" }, h("button", { class: "small", onclick: () => { lookup(b.addr); window.scrollTo({ top: 0, behavior: "smooth" }); } }, "Check"), h("button", { class: "small", onclick: () => { const l = prompt("New label", b.label); if (l) { b.label = l; save("addrbook", book); paintBook(); } } }, "Rename"), h("button", { class: "small", onclick: () => { book.splice(i, 1); save("addrbook", book); paintBook(); } }, "Remove")));
      })) : h("p", { class: "muted" }, "Empty. Look up an address and tap ＋ Watch, or add a famous one below."));
  }
  famous.append(h("ul", { class: "list" }, FAMOUS.map((f) => h("li", {}, h("b", {}, f.label), h("div", { class: "mono" }, f.addr), h("small", {}, f.note),
    h("div", { class: "row" }, h("button", { class: "small", "data-famous": f.addr, onclick: () => { lookup(f.addr); window.scrollTo({ top: 0, behavior: "smooth" }); } }, "Look up"), h("button", { class: "small", onclick: () => addToBook(f.addr, f.label, f.note) }, "＋ Watch"))))));
  types.append(h("ul", { class: "list" }, Object.values(TYPES).map((t) => h("li", {}, h("b", {}, t.name), " ", h("span", { class: "tag" }, t.prefix), h("br"), h("small", {}, t.note)))),
    h("p", { class: "muted" }, "Every address has a built-in checksum, so most typos are caught before any lookup. Reusing addresses hurts privacy: anyone can see every payment to an address (as this page shows)."));
  paintBook();
}
