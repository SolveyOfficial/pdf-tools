import { UserError } from "../lib/errors";
import { prepareImage } from "../lib/images";
import {
  buildPdf,
  countPages,
  formatBytes,
  imagesToPdf,
  isImage,
  isPdf,
  outputName,
  type InputFile,
} from "../lib/pdf";
import { dropZone, h, iconButton, move, runTask, statusArea } from "../ui";

import type { Tool } from "./tool";

interface Item {
  file: InputFile;
  /** Number of pages, or 1 for an image. */
  pages: number;
}

export const merge: Tool = {
  id: "merge",
  title: "Merge",
  heading: "Merge PDFs",
  description:
    "Join PDFs and images into one PDF. Put the files in the order you want, then merge.",
  mount(container) {
    let items: Item[] = [];
    const status = statusArea();
    const list = h("ol", { class: "file-list" });
    const mergeButton = h(
      "button",
      { type: "button", class: "primary", on: { click: () => void run() } },
      "Merge",
    );
    const actions = h("div", { class: "actions" }, mergeButton);

    const render = () => {
      list.replaceChildren(
        ...items.map((item, index) =>
          h(
            "li",
            { class: "file-list__item" },
            h("span", { class: "file-list__number" }, `${index + 1}`),
            h(
              "span",
              { class: "file-list__name" },
              h("strong", {}, item.file.name),
              h(
                "small",
                {},
                isPdf(item.file)
                  ? `${item.pages} page${item.pages === 1 ? "" : "s"} · ${formatBytes(item.file.bytes.length)}`
                  : `Image · ${formatBytes(item.file.bytes.length)}`,
              ),
            ),
            iconButton("Move up", "↑", () => {
              items = move(items, index, index - 1);
              render();
            }),
            iconButton("Move down", "↓", () => {
              items = move(items, index, index + 1);
              render();
            }),
            iconButton(
              "Remove",
              "✕",
              () => {
                items = items.filter((_, i) => i !== index);
                render();
              },
              "danger",
            ),
          ),
        ),
      );
      actions.hidden = items.length === 0;
      mergeButton.disabled = items.length < 2;
      mergeButton.textContent =
        items.length < 2 ? "Add at least two files" : `Merge ${items.length} files`;
    };

    const add = (files: InputFile[]) =>
      runTask(status, [mergeButton], async () => {
        status.progress("Reading files…");
        for (const file of files) {
          if (isPdf(file)) {
            items.push({ file, pages: await countPages(file.bytes) });
          } else if (isImage(file)) {
            items.push({ file, pages: 1 });
          } else {
            throw new UserError(`"${file.name}" is not a PDF or an image.`);
          }
        }
        status.clear();
        render();
      });

    const run = () =>
      runTask(status, [mergeButton], async () => {
        status.progress("Merging…");
        const sources: Uint8Array[] = [];
        for (const item of items) {
          if (isPdf(item.file)) {
            sources.push(item.file.bytes);
          } else {
            const image = await prepareImage(item.file);
            sources.push(await imagesToPdf([image], { pageSize: "a4", margin: 36 }));
          }
        }
        const bytes = await buildPdf(
          sources,
          items.flatMap((item, source) =>
            Array.from({ length: item.pages }, (_, index) => ({
              source,
              index,
              rotation: 0,
            })),
          ),
        );
        status.result({
          message: `Merged ${items.length} files into one PDF with ${items.reduce(
            (total, item) => total + item.pages,
            0,
          )} pages.`,
          file: {
            bytes,
            name: outputName(items[0].file.name, "merged"),
            type: "application/pdf",
          },
        });
      });

    const zone = dropZone({
      accept: "application/pdf,.pdf,image/*",
      multiple: true,
      label: "Choose PDFs or images",
      hint: "or drop them here",
      onFiles: add,
    });

    container.append(zone.element, list, actions, status.element);
    render();
  },
};
