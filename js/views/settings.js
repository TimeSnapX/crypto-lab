import { h, card, download, toast } from "../ui.js";
import { exportAll, importAll } from "../store.js";
export function render(root) {
  const file = h("input", { type: "file", accept: "application/json,.json" });
  file.addEventListener("change", async () => {
    try { importAll(JSON.parse(await file.files[0].text())); toast("Imported. Reloading…"); setTimeout(() => location.reload(), 600); }
    catch (e) { toast("Import failed: " + e.message, "bad"); }
  });
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "Backup & settings")),
    card("Backup", h("p", {}, "Everything (paper portfolio, trades, watchlist, address book, projects, lessons) is stored only in this browser. Export a JSON file to back it up or move it to another device."),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => download(`crypto-lab-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportAll(), null, 2)) }, "Export all (JSON)")),
      h("label", { class: "field" }, h("span", {}, "Import a Crypto Lab backup"), file)),
    card("Reset", h("p", { class: "muted" }, "Deletes all Crypto Lab data in this browser."), h("button", { onclick: () => { if (confirm("Delete all Crypto Lab data on this device?")) { Object.keys(localStorage).filter((k) => k.startsWith("cl.")).forEach((k) => localStorage.removeItem(k)); location.reload(); } } }, "Reset everything")),
    card("Safety", h("ul", {}, h("li", {}, "No wallet connections, no seed phrases, no private keys, ever."), h("li", {}, "No real trades: every buy, sell, long and short is paper money."), h("li", {}, "Network access is limited (by Content-Security-Policy) to the read-only price and blockchain APIs listed under Data sources."))));
}
