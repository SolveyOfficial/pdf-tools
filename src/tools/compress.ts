import { UserError } from "../lib/errors";
import { compressAsImages, compressLossless, PRESETS } from "../lib/compress";
import { formatBytes, isPdf, outputName, type InputFile } from "../lib/pdf";
import { closePdf, openPdf } from "../lib/render";
import { choice, dropZone, h, runTask, select, statusArea } from "../ui";

import type { Tool } from "./tool";

type Mode = "target" | "quality" | "lossless";
type Target = "100" | "200" | "300" | "500" | "1024" | "2048";
type Quality = keyof typeof PRESETS;

const percentSmaller = (before: number, after: number) =>
  Math.round((1 - after / before) * 100);

export const compress: Tool = {
  id: "compress",
  title: "Compress",
  heading: "Compress a PDF",
  description:
    "Make a PDF smaller, for example to fit the upload limit of an online form.",
  mount(container) {
    let file: InputFile | null = null;
    const status = statusArea();
    const info = h("p", { class: "file-info" });

    const target = select<Target>(
      "Make it smaller than",
      [
        { value: "100", label: "100 KB" },
        { value: "200", label: "200 KB" },
        { value: "300", label: "300 KB" },
        { value: "500", label: "500 KB" },
        { value: "1024", label: "1 MB" },
        { value: "2048", label: "2 MB" },
      ],
      "500",
    );
    const quality = select<Quality>(
      "Quality",
      [
        { value: "high", label: "High (150 DPI)" },
        { value: "medium", label: "Medium (120 DPI)" },
        { value: "low", label: "Low (80 DPI)" },
      ],
      "medium",
    );
    const note = h(
      "p",
      { class: "note" },
      "This turns each page into an image, so text can no longer be selected or searched.",
    );
    const update = (value: Mode) => {
      target.element.hidden = value !== "target";
      quality.element.hidden = value !== "quality";
      note.hidden = value === "lossless";
    };
    const mode = choice<Mode>(
      "compress-mode",
      "How to compress",
      [
        { value: "target", label: "To a size", hint: "Best quality under a size limit" },
        { value: "quality", label: "By quality", hint: "Choose the image quality" },
        { value: "lossless", label: "Keep text", hint: "Small saving, nothing changes" },
      ],
      "target",
      update,
    );
    const button = h(
      "button",
      { type: "button", class: "primary", on: { click: () => void run() } },
      "Compress",
    );
    const options = h(
      "div",
      { class: "options" },
      info,
      mode.element,
      target.element,
      quality.element,
      note,
      h("div", { class: "actions" }, button),
    );
    options.hidden = true;
    update(mode.value);

    const load = (files: InputFile[]) =>
      runTask(status, [button], async () => {
        const [chosen] = files;
        if (!isPdf(chosen)) {
          throw new UserError(`"${chosen.name}" is not a PDF.`);
        }
        status.progress("Opening…");
        const doc = await openPdf(chosen.bytes);
        file = chosen;
        info.replaceChildren(
          h("strong", {}, chosen.name),
          ` · ${doc.numPages} page${doc.numPages === 1 ? "" : "s"} · ${formatBytes(chosen.bytes.length)}`,
        );
        await closePdf(doc);
        options.hidden = false;
        status.clear();
      });

    const run = () =>
      runTask(status, [button], async () => {
        if (!file) {
          return;
        }
        const before = file.bytes.length;
        const name = outputName(file.name, "compressed");
        const result = (bytes: Uint8Array, message: string, detail?: string) =>
          status.result({
            message,
            detail,
            file: { bytes, name, type: "application/pdf" },
          });

        if (mode.value === "lossless") {
          status.progress("Compressing…");
          const bytes = await compressLossless(file.bytes);
          if (bytes.length >= before) {
            status.error(
              new Error(
                "This PDF is already stored compactly. Try “To a size” or “By quality” to make it smaller.",
              ),
            );
            return;
          }
          result(
            bytes,
            `Reduced from ${formatBytes(before)} to ${formatBytes(bytes.length)} (${percentSmaller(before, bytes.length)}% smaller).`,
          );
          return;
        }

        const targetBytes =
          mode.value === "target" ? Number(target.value) * 1024 : undefined;
        if (targetBytes && before <= targetBytes) {
          status.error(
            new Error(`This PDF is already smaller than ${formatBytes(targetBytes)}.`),
          );
          return;
        }
        const doc = await openPdf(file.bytes);
        try {
          const compressed = await compressAsImages(
            doc,
            { targetBytes, setting: PRESETS[quality.value] },
            (message) => status.progress(message),
          );
          const after = compressed.bytes.length;
          if (!targetBytes && after >= before) {
            status.error(
              new Error(
                "Compressing at this quality would make the PDF bigger. Try a lower quality.",
              ),
            );
            return;
          }
          result(
            compressed.bytes,
            `Reduced from ${formatBytes(before)} to ${formatBytes(after)} (${percentSmaller(before, after)}% smaller).`,
            compressed.fitsTarget
              ? `Pages saved as images at ${compressed.setting.dpi} DPI.`
              : `This is the smallest possible at the lowest quality, but it is still above ${formatBytes(targetBytes!)}. Try splitting the PDF into parts.`,
          );
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
