import { prepareImage } from "../lib/images";
import {
  formatBytes,
  imagesToPdf,
  isImage,
  outputName,
  type InputFile,
  type PageSize,
} from "../lib/pdf";
import { dropZone, h, iconButton, move, runTask, select, statusArea } from "../ui";

import type { Tool } from "./tool";

interface Item {
  file: InputFile;
  url: string;
}

const MARGINS = { none: 0, small: 18, large: 36 } as const;

export const imagesToPdfTool: Tool = {
  id: "images-to-pdf",
  title: "Images to PDF",
  heading: "Images to PDF",
  description:
    "Turn photos, scans and screenshots into a PDF, one image per page. JPG and PNG images keep their full quality.",
  mount(container) {
    let items: Item[] = [];
    const status = statusArea();
    const list = h("ol", { class: "image-grid" });
    const pageSize = select<PageSize>(
      "Page size",
      [
        { value: "a4", label: "A4" },
        { value: "letter", label: "US Letter" },
        { value: "fit", label: "Same as image" },
      ],
      "a4",
    );
    const margin = select<keyof typeof MARGINS>(
      "Margin",
      [
        { value: "none", label: "None" },
        { value: "small", label: "Small" },
        { value: "large", label: "Large" },
      ],
      "small",
    );
    const button = h(
      "button",
      { type: "button", class: "primary", on: { click: () => void run() } },
      "Create PDF",
    );
    const options = h(
      "div",
      { class: "options options--inline" },
      pageSize.element,
      margin.element,
      h("div", { class: "actions" }, button),
    );

    const render = () => {
      options.hidden = items.length === 0;
      button.textContent = `Create PDF (${items.length} page${items.length === 1 ? "" : "s"})`;
      list.replaceChildren(
        ...items.map((item, index) =>
          h(
            "li",
            { class: "image-card" },
            h("img", { src: item.url, alt: item.file.name, loading: "lazy" }),
            h(
              "span",
              { class: "image-card__label" },
              `${index + 1}. ${item.file.name}`,
              h("small", {}, formatBytes(item.file.bytes.length)),
            ),
            h(
              "div",
              { class: "page-card__actions" },
              iconButton("Move earlier", "←", () => {
                items = move(items, index, index - 1);
                render();
              }),
              iconButton(
                "Remove",
                "✕",
                () => {
                  URL.revokeObjectURL(item.url);
                  items = items.filter((_, i) => i !== index);
                  render();
                },
                "danger",
              ),
              iconButton("Move later", "→", () => {
                items = move(items, index, index + 1);
                render();
              }),
            ),
          ),
        ),
      );
    };

    const add = async (files: InputFile[]) => {
      const rejected = files.filter((file) => !isImage(file));
      for (const file of files.filter(isImage)) {
        items.push({
          file,
          url: URL.createObjectURL(
            new Blob([file.bytes as BlobPart], { type: file.type }),
          ),
        });
      }
      if (rejected.length) {
        status.error(new Error(`"${rejected[0].name}" is not an image.`));
      } else {
        status.clear();
      }
      render();
    };

    const run = () =>
      runTask(status, [button], async () => {
        const images = [];
        for (const [i, item] of items.entries()) {
          status.progress(`Preparing image ${i + 1} of ${items.length}…`);
          images.push(await prepareImage(item.file));
        }
        status.progress("Creating the PDF…");
        const bytes = await imagesToPdf(images, {
          pageSize: pageSize.value,
          margin: MARGINS[margin.value],
        });
        status.result({
          message: `Created a PDF with ${images.length} page${images.length === 1 ? "" : "s"}.`,
          file: {
            bytes,
            name: outputName(items[0].file.name, "images"),
            type: "application/pdf",
          },
        });
      });

    const zone = dropZone({
      accept: "image/*",
      multiple: true,
      label: "Choose images",
      hint: "JPG, PNG, WebP and more, or drop them here",
      onFiles: add,
    });
    container.append(zone.element, list, options, status.element);
    render();
  },
};
