import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  buildPdf,
  chunkPages,
  countPages,
  formatBytes,
  imagesToPdf,
  isImage,
  isPdf,
  layoutImage,
  mergePdfs,
  outputName,
  PAGE_SIZES,
  parseRanges,
  splitPdf,
} from "../src/lib/pdf";

/** Makes a PDF whose pages have widths 100, 101, 102... to tell them apart. */
const makePdf = async (pages: number, firstWidth = 100) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([firstWidth + i, 200]);
  }
  return doc.save();
};

const pageWidths = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((page) => page.getWidth());

// 1x1 PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("file types", () => {
  it("recognises PDFs and images by type or name", () => {
    expect(isPdf({ name: "a.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "a", type: "application/pdf" })).toBe(true);
    expect(isPdf({ name: "a.png", type: "image/png" })).toBe(false);
    expect(isImage({ name: "photo.JPG", type: "" })).toBe(true);
    expect(isImage({ name: "a", type: "image/webp" })).toBe(true);
    expect(isImage({ name: "a.pdf", type: "application/pdf" })).toBe(false);
  });
});

describe("parseRanges", () => {
  it("parses single pages, ranges and open ranges", () => {
    expect(parseRanges("1-3, 5, 8-", 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
    expect(parseRanges("-2", 5)).toEqual([[0, 1]]);
    expect(parseRanges("3 to 1", 5)).toEqual([[2, 1, 0]]);
    expect(parseRanges(" 2 ; 4 – 5 ", 5)).toEqual([[1], [3, 4]]);
  });

  it("rejects text that is not a range", () => {
    expect(() => parseRanges("", 3)).toThrow(/Enter the pages/);
    expect(() => parseRanges("a-b", 3)).toThrow(/not a page/);
    expect(() => parseRanges("-", 3)).toThrow(/not a page/);
  });

  it("rejects pages outside the document", () => {
    expect(() => parseRanges("0", 3)).toThrow(/outside the document/);
    expect(() => parseRanges("2-4", 3)).toThrow(/has 3 pages/);
    expect(() => parseRanges("2", 1)).toThrow(/has 1 page\./);
  });
});

describe("chunkPages", () => {
  it("splits pages into groups of a given size", () => {
    expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(chunkPages(2, 5)).toEqual([[0, 1]]);
    expect(chunkPages(0, 1)).toEqual([]);
  });
});

describe("merge, organise and split", () => {
  it("merges PDFs in order", async () => {
    const merged = await mergePdfs([await makePdf(2, 100), await makePdf(1, 300)]);
    expect(await pageWidths(merged)).toEqual([100, 101, 300]);
  });

  it("reorders, rotates and drops pages", async () => {
    const a = await makePdf(3, 100);
    const b = await makePdf(2, 300);
    const result = await buildPdf(
      [a, b],
      [
        { source: 1, index: 1, rotation: 0 },
        { source: 0, index: 2, rotation: 90 },
        { source: 0, index: 0, rotation: -90 },
      ],
    );
    const doc = await PDFDocument.load(result, { updateMetadata: false });
    expect(doc.getPages().map((page) => page.getWidth())).toEqual([301, 102, 100]);
    expect(doc.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90, 270]);
    expect(doc.getProducer()).toBe("Solvey PDF Tools");
  });

  it("can use the same page twice", async () => {
    const a = await makePdf(2);
    const result = await buildPdf(
      [a],
      [
        { source: 0, index: 1, rotation: 0 },
        { source: 0, index: 1, rotation: 0 },
      ],
    );
    expect(await pageWidths(result)).toEqual([101, 101]);
  });

  it("splits into one file per group", async () => {
    const parts = await splitPdf(await makePdf(5), [[0, 1], [4], [2]]);
    expect(await Promise.all(parts.map(pageWidths))).toEqual([[100, 101], [104], [102]]);
    expect(await countPages(parts[0])).toBe(2);
  });
});

describe("images to PDF", () => {
  it("fits large images inside A4 margins and keeps small ones at size", () => {
    const options = { pageSize: "a4", margin: 36 } as const;
    const big = layoutImage(4000, 2000, options);
    // landscape image gets a landscape page
    expect(big.pageWidth).toBe(PAGE_SIZES.a4[1]);
    expect(big.width).toBeCloseTo(PAGE_SIZES.a4[1] - 72);
    expect(big.x).toBeCloseTo(36);
    const small = layoutImage(100, 50, options);
    expect(small.width).toBe(100);
    expect(small.x).toBeCloseTo((PAGE_SIZES.a4[1] - 100) / 2);
  });

  it("sizes pages to the image when asked", () => {
    expect(layoutImage(300, 200, { pageSize: "fit", margin: 10 })).toEqual({
      pageWidth: 320,
      pageHeight: 220,
      x: 10,
      y: 10,
      width: 300,
      height: 200,
    });
  });

  it("creates one page per image", async () => {
    const pdf = await imagesToPdf(
      [
        { bytes: PNG, format: "png", width: 1, height: 1 },
        { bytes: PNG, format: "png", width: 1, height: 1 },
      ],
      { pageSize: "letter", margin: 0 },
    );
    expect(await pageWidths(pdf)).toEqual([612, 612]);
  });
});

describe("names and sizes", () => {
  it("builds output file names", () => {
    expect(outputName("Report.final.pdf", "merged")).toBe("Report.final-merged.pdf");
    expect(outputName(".pdf", "page-1", "png")).toBe("document-page-1.png");
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(150 * 1024)).toBe("150 KB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.3 MB");
  });
});
