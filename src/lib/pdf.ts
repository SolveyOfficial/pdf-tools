import { UserError } from "./errors";
import { degrees, PDFDocument, type PDFImage } from "pdf-lib";

/** A file chosen by the user, already read into memory. */
export interface InputFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** A page of a source document, as shown in the page organiser. */
export interface PageRef {
  /** Index of the source document in the list passed to `buildPdf`. */
  source: number;
  /** Zero-based page index inside the source document. */
  index: number;
  /** Extra clockwise rotation in degrees (a multiple of 90). */
  rotation: number;
}

export const isPdf = (file: Pick<InputFile, "name" | "type">) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export const isImage = (file: Pick<InputFile, "name" | "type">) =>
  file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);

/** Loads a PDF, also accepting files that are only protected from editing. */
export const loadPdf = (bytes: Uint8Array) =>
  PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

const newDocument = async () => {
  const doc = await PDFDocument.create();
  doc.setProducer("Solvey PDF Tools");
  doc.setCreator("Solvey PDF Tools");
  return doc;
};

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

const normaliseRotation = (angle: number) => ((angle % 360) + 360) % 360;

/**
 * Builds a new PDF from pages of one or more source PDFs, in the given order
 * and with the given extra rotation.
 */
export const buildPdf = async (
  sources: Uint8Array[],
  pages: PageRef[],
): Promise<Uint8Array> => {
  const loaded = await Promise.all(sources.map(loadPdf));
  const output = await newDocument();
  // copy each source's pages in one go, keeping the requested order
  const copies = await Promise.all(
    loaded.map((doc, source) => {
      const wanted = pages
        .filter((page) => page.source === source)
        .map((page) => page.index);
      return output.copyPages(doc, wanted);
    }),
  );
  const used = loaded.map(() => 0);
  for (const page of pages) {
    const copy = copies[page.source][used[page.source]++];
    if (page.rotation) {
      copy.setRotation(
        degrees(normaliseRotation(copy.getRotation().angle + page.rotation)),
      );
    }
    output.addPage(copy);
  }
  return save(output);
};

/** Returns the number of pages of a PDF. */
export const countPages = async (bytes: Uint8Array) =>
  (await loadPdf(bytes)).getPageCount();

/** Joins whole PDFs, one after the other. */
export const mergePdfs = async (sources: Uint8Array[]) => {
  const counts = await Promise.all(sources.map(countPages));
  const pages = counts.flatMap((count, source) =>
    Array.from({ length: count }, (_, index) => ({
      source,
      index,
      rotation: 0,
    })),
  );
  return buildPdf(sources, pages);
};

/**
 * Parses page ranges such as "1-3, 5, 8-" into lists of zero-based page
 * indexes, one list per comma-separated part. Throws with a readable message
 * when the text is not valid.
 */
export const parseRanges = (text: string, pageCount: number): number[][] => {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    throw new UserError("Enter the pages to use, for example 1-3, 5.");
  }
  return parts.map((part) => {
    const match = /^(\d+)?\s*(?:(-|–|to)\s*(\d+)?)?$/i.exec(part);
    if (!match || (!match[1] && !match[3])) {
      throw new UserError(`"${part}" is not a page or a range of pages.`);
    }
    const start = match[1] ? Number(match[1]) : 1;
    const end = match[2] ? (match[3] ? Number(match[3]) : pageCount) : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      throw new UserError(
        `"${part}" is outside the document, which has ${pageCount} page${
          pageCount === 1 ? "" : "s"
        }.`,
      );
    }
    const step = start <= end ? 1 : -1;
    const pages: number[] = [];
    for (let page = start; page !== end + step; page += step) {
      pages.push(page - 1);
    }
    return pages;
  });
};

/** Splits a PDF into several PDFs, one per group of zero-based page indexes. */
export const splitPdf = async (bytes: Uint8Array, groups: number[][]) =>
  Promise.all(
    groups.map((group) =>
      buildPdf(
        [bytes],
        group.map((index) => ({ source: 0, index, rotation: 0 })),
      ),
    ),
  );

/** Groups the pages of a document into chunks of `size` pages. */
export const chunkPages = (pageCount: number, size: number): number[][] => {
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    groups.push(
      Array.from(
        { length: Math.min(size, pageCount - start) },
        (_, offset) => start + offset,
      ),
    );
  }
  return groups;
};

export type PageSize = "fit" | "a4" | "letter";

export interface ImagesToPdfOptions {
  pageSize: PageSize;
  /** Margin around each image, in points (1/72 inch). */
  margin: number;
}

/** Page sizes in points, portrait. */
export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
} as const;

/** An image ready to be placed in a PDF: JPEG or PNG bytes and its size. */
export interface PreparedImage {
  bytes: Uint8Array;
  format: "jpeg" | "png";
  width: number;
  height: number;
}

/**
 * Works out where to draw an image on a page: scaled down to fit inside the
 * margins (never enlarged), centred, with the page turned to match the
 * image's orientation.
 */
export const layoutImage = (
  width: number,
  height: number,
  options: ImagesToPdfOptions,
) => {
  if (options.pageSize === "fit") {
    return {
      pageWidth: width + options.margin * 2,
      pageHeight: height + options.margin * 2,
      x: options.margin,
      y: options.margin,
      width,
      height,
    };
  }
  const [short, long] = PAGE_SIZES[options.pageSize];
  const landscape = width > height;
  const pageWidth = landscape ? long : short;
  const pageHeight = landscape ? short : long;
  const scale = Math.min(
    1,
    (pageWidth - options.margin * 2) / width,
    (pageHeight - options.margin * 2) / height,
  );
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
};

/** Puts each image on its own page. */
export const imagesToPdf = async (
  images: PreparedImage[],
  options: ImagesToPdfOptions,
) => {
  const doc = await newDocument();
  for (const image of images) {
    const embedded: PDFImage =
      image.format === "jpeg"
        ? await doc.embedJpg(image.bytes)
        : await doc.embedPng(image.bytes);
    const layout = layoutImage(image.width, image.height, options);
    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    page.drawImage(embedded, {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    });
  }
  return save(doc);
};

/** Turns "report.pdf" into "report-<suffix>.pdf". */
export const outputName = (name: string, suffix: string, extension = "pdf") =>
  `${name.replace(/\.[^.]+$/, "") || "document"}-${suffix}.${extension}`;

/** Formats a byte count for people, e.g. "1.2 MB". */
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
