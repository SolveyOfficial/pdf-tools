import type { PDFDocumentProxy } from "pdfjs-dist";

import { imagesToPdf, loadPdf } from "./pdf";
import { blobBytes, canvasToBlob, pageSize, renderPage, safeScale } from "./render";

/** One way of turning pages into images: resolution and JPEG quality. */
export interface Setting {
  dpi: number;
  quality: number;
}

/**
 * Settings from best looking to smallest. Each is tried in turn when a target
 * size is set, so the result is the best quality that fits.
 */
export const SETTINGS: Setting[] = [
  { dpi: 200, quality: 0.85 },
  { dpi: 150, quality: 0.8 },
  { dpi: 150, quality: 0.65 },
  { dpi: 130, quality: 0.6 },
  { dpi: 120, quality: 0.5 },
  { dpi: 110, quality: 0.45 },
  { dpi: 100, quality: 0.4 },
  { dpi: 90, quality: 0.35 },
  { dpi: 80, quality: 0.3 },
  { dpi: 72, quality: 0.25 },
  { dpi: 60, quality: 0.2 },
  { dpi: 50, quality: 0.15 },
];

export const PRESETS = {
  high: SETTINGS[1],
  medium: SETTINGS[4],
  low: SETTINGS[8],
} as const;

/** Re-saves a PDF more compactly, keeping text and quality as they are. */
export const compressLossless = async (bytes: Uint8Array) => {
  const doc = await loadPdf(bytes);
  return doc.save({ useObjectStreams: true });
};

export interface CompressResult {
  bytes: Uint8Array;
  setting: Setting;
  /** False when even the smallest setting is larger than the target. */
  fitsTarget: boolean;
}

/**
 * Rebuilds a PDF with every page as a JPEG image. With `targetBytes`, tries
 * the settings from best to smallest and returns the first that fits;
 * otherwise uses `setting`. Pages are drawn once per resolution.
 */
export const compressAsImages = async (
  doc: PDFDocumentProxy,
  options: { setting?: Setting; targetBytes?: number },
  onProgress: (message: string) => void,
): Promise<CompressResult> => {
  const candidates = options.targetBytes ? SETTINGS : [options.setting ?? PRESETS.medium];
  const pages = await Promise.all(
    Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
  );
  const sizes = pages.map(pageSize);

  let canvases: HTMLCanvasElement[] = [];
  let canvasDpi = 0;
  let last: CompressResult | undefined;

  for (const [attempt, setting] of candidates.entries()) {
    if (setting.dpi !== canvasDpi) {
      canvases = [];
      for (const [i, page] of pages.entries()) {
        onProgress(
          `${options.targetBytes ? `Try ${attempt + 1}: d` : "D"}rawing page ${
            i + 1
          } of ${pages.length}…`,
        );
        const { width, height } = sizes[i];
        canvases.push(await renderPage(page, safeScale(width, height, setting.dpi / 72)));
      }
      canvasDpi = setting.dpi;
    }
    onProgress(
      options.targetBytes
        ? `Try ${attempt + 1}: saving at ${setting.dpi} DPI…`
        : "Saving…",
    );
    const images = [];
    for (const [i, canvas] of canvases.entries()) {
      images.push({
        bytes: await blobBytes(await canvasToBlob(canvas, "image/jpeg", setting.quality)),
        format: "jpeg" as const,
        width: sizes[i].width,
        height: sizes[i].height,
      });
    }
    const bytes = await imagesToPdf(images, { pageSize: "fit", margin: 0 });
    last = {
      bytes,
      setting,
      fitsTarget: !options.targetBytes || bytes.length <= options.targetBytes,
    };
    if (last.fitsTarget) {
      return last;
    }
  }
  return last!;
};
