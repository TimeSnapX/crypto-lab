import { h } from "../ui.js";
import { FEATURES } from "./home.js";
export function render(root) {
  root.append(h("div", { class: "pagehead" }, h("h2", {}, "All sections")),
    h("div", { class: "tiles" }, [...FEATURES, ["sources", "🛰️", "Data sources", "Which live APIs are working right now"], ["settings", "💾", "Backup & settings", "Export/import everything as JSON"]]
      .map(([r, ico, t, d]) => h("a", { class: "tile", href: `#${r}` }, h("span", { class: "ico" }, ico), h("b", {}, t), h("small", {}, d)))));
}
