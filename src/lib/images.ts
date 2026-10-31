import { UserError } from "./errors";
import type { InputFile, PreparedImage } from "./pdf";
import { blobBytes, canvasToBlob } from "./render";

/**
 * Reads the EXIF orientation of a JPEG (1 = upright). Phone photos are often
 * stored sideways with this tag telling viewers how to turn them; PDFs ignore
 * the tag, so such photos must be redrawn upright.
 */
export const jpegOrientation = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) {
    return 1;
  }
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength) {
      // "Exif\0\0"
      if (view.getUint32(offset + 4) !== 0x45786966) {
        return 1;
      }
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) {
        return 1;
      }
      const little = view.getUint16(tiff) === 0x4949;
      const firstIfd = tiff + view.getUint32(tiff + 4, little);
      if (firstIfd + 2 > view.byteLength) {
        return 1;
      }
      const entries = view.getUint16(firstIfd, little);
      for (let i = 0; i < entries; i++) {
        const entry = firstIfd + 2 + i * 12;
        if (entry + 12 > view.byteLength) {
          return 1;
        }
        if (view.getUint16(entry, little) === 0x0112) {
          return view.getUint16(entry + 8, little);
        }
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) {
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
};

const isPng = (bytes: Uint8Array) =>
  bytes.length > 8 &&
  bytes[0] === 0x89 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x4e &&
  bytes[3] === 0x47;

const isJpeg = (bytes: Uint8Array) =>
  bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

/**
 * Turns any image the browser can open into JPEG or PNG bytes for a PDF.
 * JPEG and PNG files are kept as they are (no quality loss) unless a photo
 * has to be turned upright; other formats are converted.
 */
export const prepareImage = async (file: InputFile): Promise<PreparedImage> => {
  const blob = new Blob([file.bytes as BlobPart], { type: file.type });
  let bitmap: ImageBitmap;
  try {
    // the browser applies the EXIF orientation here
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new UserError(`"${file.name}" is not an image this browser can open.`);
  }
  const { width, height } = bitmap;
  const upright = !isJpeg(file.bytes) || jpegOrientation(file.bytes) === 1;
  if (isJpeg(file.bytes) && upright) {
    bitmap.close();
    return { bytes: file.bytes, format: "jpeg", width, height };
  }
  if (isPng(file.bytes)) {
    bitmap.close();
    return { bytes: file.bytes, format: "png", width, height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const photo = isJpeg(file.bytes) || /\.(jpe?g|webp|avif|heic)$/i.test(file.name);
  if (photo) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const format = photo ? "jpeg" : "png";
  const bytes = await blobBytes(
    await canvasToBlob(canvas, `image/${format}`, photo ? 0.92 : undefined),
  );
  return { bytes, format, width, height };
};
