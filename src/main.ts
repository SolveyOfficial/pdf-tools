import "./styles.css";

import { compress } from "./tools/compress";
import { imagesToPdfTool } from "./tools/images-to-pdf";
import { merge } from "./tools/merge";
import { organise } from "./tools/organise";
import { pdfToImages } from "./tools/pdf-to-images";
import { split } from "./tools/split";
import type { Tool } from "./tools/tool";
import { h } from "./ui";

const tools: Tool[] = [merge, organise, split, compress, imagesToPdfTool, pdfToImages];

const nav = document.querySelector<HTMLElement>("#tools")!;
const main = document.querySelector<HTMLElement>("#main")!;
const panels = new Map<string, HTMLElement>();
const tabs = new Map<string, HTMLAnchorElement>();

for (const tool of tools) {
  const tab = h("a", { href: `#${tool.id}`, class: "tab" }, tool.title);
  tabs.set(tool.id, tab);
  nav.append(tab);
}

// The page's own <title> stays on the default view, so search engines index it;
// a tool picked by its address gets its own.
const pageTitle = document.title;

const show = () => {
  const id = location.hash.slice(1);
  const tool = tools.find((candidate) => candidate.id === id) ?? tools[0];
  let panel = panels.get(tool.id);
  if (!panel) {
    const body = h("div", { class: "panel__body" });
    panel = h(
      "section",
      { class: "panel", "aria-labelledby": `${tool.id}-heading` },
      h("h2", { id: `${tool.id}-heading` }, tool.heading),
      h("p", { class: "panel__description" }, tool.description),
      body,
    );
    tool.mount(body);
    panels.set(tool.id, panel);
    main.append(panel);
  }
  for (const [key, element] of panels) {
    element.hidden = key !== tool.id;
  }
  for (const [key, tab] of tabs) {
    if (key === tool.id) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  document.title = location.hash.length > 1 ? `${tool.heading}, free | Solvey` : pageTitle;
};

addEventListener("hashchange", show);
show();

// Pages dropped outside a drop area would otherwise be opened by the browser
for (const type of ["dragover", "drop"]) {
  addEventListener(type, (event) => event.preventDefault());
}
