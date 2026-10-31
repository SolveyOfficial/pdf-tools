import { UserError } from "../lib/errors";
import { zip } from "../lib/files";
import { formatBytes, isPdf, outputName, parseRanges, type InputFile } from "../lib/pdf";
import {
  blobBytes,
  canvasToBlob,
  closePdf,
  openPdf,
  pageSize,
  renderPage,
  safeScale,
} from "../lib/render";
import { dropZone, field, h, runTask, select, statusArea } from "../ui";

import type { Tool } from "./tool";

type Format = "jpeg" | "png";
type Dpi = "72" | "150" | "300";

export const pdfToImages: Tool = {
  id: "pdf-to-images",
  title: "PDF to images",
  heading: "PDF to images",
  description:
    "Save pages of a PDF as JPG or PNG images. Several images are downloaded together as a ZIP.",
  mount(container) {
    let file: InputFile | null = null;
    let pageCount = 0;
    const status = statusArea();
    const info = h("p", { class: "file-info" });
    const format = select<Format>(
      "Format",
      [
        { value: "jpeg", label: "JPG (smaller files)" },
        { value: "png", label: "PNG (sharpest)" },
      ],
      "jpeg",
    );
    const dpi = select<Dpi>(
      "Resolution",
      [
        { value: "72", label: "Screen (72 DPI)" },
        { value: "150", label: "Standard (150 DPI)" },
        { value: "300", label: "Print (300 DPI)" },
      ],
      "150",
    );
    const pages = h("input", {
      type: "text",
      placeholder: "all pages",
      autocomplete: "off",
      spellcheck: false,
    });
    const button = h(
      "button",
      { type: "button", class: "primary", on: { click: () => void run() } },
      "Convert",
    );
    const options = h(
      "div",
      { class: "options" },
      info,
      h(
        "div",
        { class: "options--inline" },
        format.element,
        dpi.element,
        field("Pages", pages, "Leave empty for all, or enter e.g. 1-3, 5."),
      ),
      h("div", { class: "actions" }, button),
    );
    options.hidden = true;

    const load = (files: InputFile[]) =>
      runTask(status, [button], async () => {
        const [chosen] = files;
        if (!isPdf(chosen)) {
          throw new UserError(`"${chosen.name}" is not a PDF.`);
        }
        status.progress("Opening…");
        const doc = await openPdf(chosen.bytes);
        pageCount = doc.numPages;
        await closePdf(doc);
        file = chosen;
        info.replaceChildren(
          h("strong", {}, chosen.name),
          ` · ${pageCount} page${pageCount === 1 ? "" : "s"} · ${formatBytes(chosen.bytes.length)}`,
        );
        options.hidden = false;
        status.clear();
      });

    const run = () =>
      runTask(status, [button], async () => {
        if (!file) {
          return;
        }
        const wanted = pages.value.trim()
          ? [...new Set(parseRanges(pages.value, pageCount).flat())]
          : Array.from({ length: pageCount }, (_, i) => i);
        const type = format.value === "png" ? "image/png" : "image/jpeg";
        const extension = format.value === "png" ? "png" : "jpg";
        const doc = await openPdf(file.bytes);
        try {
          const images = [];
          for (const [n, index] of wanted.entries()) {
            status.progress(`Converting page ${n + 1} of ${wanted.length}…`);
            const page = await doc.getPage(index + 1);
            const { width, height } = pageSize(page);
            const canvas = await renderPage(
              page,
              safeScale(width, height, Number(dpi.value) / 72),
            );
            images.push({
              name: outputName(file.name, `page-${index + 1}`, extension),
              bytes: await blobBytes(await canvasToBlob(canvas, type, 0.9)),
            });
            canvas.width = canvas.height = 0;
          }
          if (images.length === 1) {
            status.result({
              message: "Converted 1 page.",
              file: { ...images[0], type },
            });
          } else {
            status.result({
              message: `Converted ${images.length} pages.`,
              file: {
                bytes: zip(images),
                name: outputName(file.name, "images", "zip"),
                type: "application/zip",
              },
            });
          }
        } finally {
          await closePdf(doc);
        }
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
