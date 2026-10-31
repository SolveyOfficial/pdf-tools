import { UserError } from "../lib/errors";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { buildPdf, isPdf, outputName, type InputFile, type PageRef } from "../lib/pdf";
import { openPdf, pageSize, renderPage } from "../lib/render";
import { dropZone, h, iconButton, move, runTask, statusArea } from "../ui";

import type { Tool } from "./tool";

const THUMBNAIL_WIDTH = 150;

export const organise: Tool = {
  id: "organise",
  title: "Organise pages",
  heading: "Organise pages",
  description:
    "Reorder, rotate and delete pages. Drag pages to move them, or use the arrows. You can add more PDFs to combine their pages.",
  mount(container) {
    const sources: InputFile[] = [];
    const docs: PDFDocumentProxy[] = [];
    const thumbnails = new Map<string, Promise<string>>();
    let pages: PageRef[] = [];
    let dragged: number | null = null;

    const status = statusArea();
    const grid = h("ol", { class: "page-grid" });
    const saveButton = h(
      "button",
      { type: "button", class: "primary", on: { click: () => void save() } },
      "Save PDF",
    );
    const rotateAll = (angle: number) => {
      pages = pages.map((page) => ({ ...page, rotation: page.rotation + angle }));
      render();
    };
    const toolbar = h(
      "div",
      { class: "actions" },
      saveButton,
      h(
        "button",
        { type: "button", on: { click: () => zone.open() } },
        "Add another PDF",
      ),
      h(
        "button",
        { type: "button", on: { click: () => rotateAll(-90) } },
        "Rotate all left",
      ),
      h(
        "button",
        { type: "button", on: { click: () => rotateAll(90) } },
        "Rotate all right",
      ),
    );

    const thumbnail = (page: PageRef) => {
      const rotation = ((page.rotation % 360) + 360) % 360;
      const key = `${page.source}:${page.index}:${rotation}`;
      if (!thumbnails.has(key)) {
        thumbnails.set(
          key,
          docs[page.source].getPage(page.index + 1).then((pdfPage) => {
            const { width, height } = pageSize(pdfPage);
            // fit the longer side of the page into the thumbnail
            const scale = (THUMBNAIL_WIDTH * devicePixelRatio) / Math.max(width, height);
            return renderPage(pdfPage, scale, rotation).then((canvas) =>
              canvas.toDataURL("image/jpeg", 0.8),
            );
          }),
        );
      }
      return thumbnails.get(key)!;
    };

    const render = () => {
      toolbar.hidden = pages.length === 0;
      saveButton.disabled = pages.length === 0;
      saveButton.textContent = `Save PDF (${pages.length} page${pages.length === 1 ? "" : "s"})`;
      grid.replaceChildren(
        ...pages.map((page, position) => {
          const preview = h("div", { class: "page-card__preview" });
          void thumbnail(page).then((url) => {
            const image = h("img", {
              src: url,
              alt: `Page ${page.index + 1}${sources.length > 1 ? ` of ${sources[page.source].name}` : ""}`,
              draggable: false,
            });
            preview.replaceChildren(image);
          });
          const card = h(
            "li",
            {
              class: "page-card",
              draggable: true,
              on: {
                dragstart: (event) => {
                  dragged = position;
                  (event as DragEvent).dataTransfer!.effectAllowed = "move";
                  card.classList.add("dragging");
                },
                dragend: () => card.classList.remove("dragging"),
                dragover: (event) => {
                  event.preventDefault();
                  card.classList.add("drop-target");
                },
                dragleave: () => card.classList.remove("drop-target"),
                drop: (event) => {
                  event.preventDefault();
                  if (dragged !== null) {
                    pages = move(pages, dragged, position);
                    dragged = null;
                    render();
                  }
                },
              },
            },
            preview,
            h(
              "span",
              { class: "page-card__label" },
              `${position + 1}`,
              sources.length > 1 &&
                h("small", {}, `${sources[page.source].name}, p. ${page.index + 1}`),
            ),
            h(
              "div",
              { class: "page-card__actions" },
              iconButton("Move earlier", "←", () => {
                pages = move(pages, position, position - 1);
                render();
              }),
              iconButton("Rotate left", "↺", () => {
                pages[position] = { ...page, rotation: page.rotation - 90 };
                render();
              }),
              iconButton("Rotate right", "↻", () => {
                pages[position] = { ...page, rotation: page.rotation + 90 };
                render();
              }),
              iconButton(
                "Delete page",
                "✕",
                () => {
                  pages = pages.filter((_, i) => i !== position);
                  render();
                },
                "danger",
              ),
              iconButton("Move later", "→", () => {
                pages = move(pages, position, position + 1);
                render();
              }),
            ),
          );
          return card;
        }),
      );
    };

    const add = (files: InputFile[]) =>
      runTask(status, [saveButton], async () => {
        status.progress("Opening…");
        for (const file of files) {
          if (!isPdf(file)) {
            throw new UserError(`"${file.name}" is not a PDF.`);
          }
          const doc = await openPdf(file.bytes);
          const source = sources.length;
          sources.push(file);
          docs.push(doc);
          for (let index = 0; index < doc.numPages; index++) {
            pages.push({ source, index, rotation: 0 });
          }
        }
        status.clear();
        render();
      });

    const save = () =>
      runTask(status, [saveButton], async () => {
        status.progress("Saving…");
        const bytes = await buildPdf(
          sources.map((source) => source.bytes),
          pages,
        );
        status.result({
          message: `Saved a PDF with ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
          file: {
            bytes,
            name: outputName(sources[0].name, "organised"),
            type: "application/pdf",
          },
        });
      });

    const zone = dropZone({
      accept: "application/pdf,.pdf",
      multiple: true,
      label: "Choose a PDF",
      hint: "or drop it here",
      onFiles: add,
    });

    container.append(zone.element, toolbar, grid, status.element);
    render();
  },
};
