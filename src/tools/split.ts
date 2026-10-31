import { UserError } from "../lib/errors";
import { zip } from "../lib/files";
import {
  chunkPages,
  countPages,
  formatBytes,
  isPdf,
  outputName,
  parseRanges,
  splitPdf,
  type InputFile,
} from "../lib/pdf";
import { choice, dropZone, field, h, runTask, statusArea } from "../ui";

import type { Tool } from "./tool";

type Mode = "extract" | "ranges" | "every" | "chunks";

/** Describes a group of zero-based pages as "1-3" or "5". */
const describe = (group: number[]) =>
  group.length === 1
    ? `${group[0] + 1}`
    : `${group[0] + 1}-${group[group.length - 1] + 1}`;

export const split: Tool = {
  id: "split",
  title: "Split",
  heading: "Split a PDF",
  description:
    "Take pages out of a PDF, or break it into several files. Several files are downloaded together as a ZIP.",
  mount(container) {
    let file: InputFile | null = null;
    let pageCount = 0;
    const status = statusArea();
    const info = h("p", { class: "file-info" });

    const ranges = h("input", {
      type: "text",
      placeholder: "for example 1-3, 5, 8-",
      autocomplete: "off",
      spellcheck: false,
    });
    const rangesField = field(
      "Pages",
      ranges,
      "Separate pages and ranges with commas. “8-” means page 8 to the end.",
    );
    const size = h("input", { type: "number", min: 1, value: 2, inputMode: "numeric" });
    const sizeField = field("Pages per file", size);

    const update = (value: Mode) => {
      rangesField.hidden = value !== "extract" && value !== "ranges";
      sizeField.hidden = value !== "chunks";
    };
    const mode = choice<Mode>(
      "split-mode",
      "How to split",
      [
        { value: "extract", label: "Extract pages", hint: "Chosen pages, in one PDF" },
        { value: "ranges", label: "Split by ranges", hint: "One PDF per range" },
        { value: "every", label: "Every page", hint: "One PDF per page" },
        { value: "chunks", label: "Every few pages", hint: "Equal parts" },
      ],
      "extract",
      update,
    );
    const splitButton = h(
      "button",
      { type: "button", class: "primary", on: { click: () => void run() } },
      "Split",
    );
    const options = h(
      "div",
      { class: "options" },
      info,
      mode.element,
      rangesField,
      sizeField,
      h("div", { class: "actions" }, splitButton),
    );
    options.hidden = true;

    const load = (files: InputFile[]) =>
      runTask(status, [splitButton], async () => {
        const [chosen] = files;
        if (!isPdf(chosen)) {
          throw new UserError(`"${chosen.name}" is not a PDF.`);
        }
        status.progress("Opening…");
        pageCount = await countPages(chosen.bytes);
        file = chosen;
        info.replaceChildren(
          h("strong", {}, chosen.name),
          ` · ${pageCount} page${pageCount === 1 ? "" : "s"} · ${formatBytes(chosen.bytes.length)}`,
        );
        options.hidden = false;
        update(mode.value);
        status.clear();
      });

    const run = () =>
      runTask(status, [splitButton], async () => {
        if (!file) {
          return;
        }
        const name = file.name;
        let groups: number[][];
        switch (mode.value) {
          case "extract":
            groups = [parseRanges(ranges.value, pageCount).flat()];
            break;
          case "ranges":
            groups = parseRanges(ranges.value, pageCount);
            break;
          case "every":
            groups = chunkPages(pageCount, 1);
            break;
          case "chunks": {
            const perFile = Math.floor(Number(size.value));
            if (!(perFile >= 1)) {
              throw new UserError("Enter how many pages each file should have.");
            }
            groups = chunkPages(pageCount, perFile);
          }
        }
        status.progress("Splitting…");
        const parts = await splitPdf(file.bytes, groups);
        if (parts.length === 1) {
          const pages = groups[0].length;
          status.result({
            message: `Created a PDF with ${pages} page${pages === 1 ? "" : "s"}.`,
            file: {
              bytes: parts[0],
              name: outputName(
                name,
                mode.value === "extract" ? "extract" : `pages-${describe(groups[0])}`,
              ),
              type: "application/pdf",
            },
          });
          return;
        }
        status.result({
          message: `Split into ${parts.length} PDFs.`,
          file: {
            bytes: zip(
              parts.map((bytes, i) => ({
                name: outputName(name, `pages-${describe(groups[i])}`),
                bytes,
              })),
            ),
            name: outputName(name, "split", "zip"),
            type: "application/zip",
          },
        });
      });

    const zone = dropZone({
      accept: "application/pdf,.pdf",
      multiple: false,
      label: "Choose a PDF",
      hint: "or drop it here",
      onFiles: load,
    });
    container.append(zone.element, options, status.element);
  },
};
