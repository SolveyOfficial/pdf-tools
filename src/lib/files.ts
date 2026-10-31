import { zipSync } from "fflate";

import type { InputFile } from "./pdf";

export const readFile = async (file: File): Promise<InputFile> => ({
  name: file.name,
  type: file.type,
  bytes: new Uint8Array(await file.arrayBuffer()),
});

/** Saves bytes as a file in the user's downloads. */
export const download = (bytes: Uint8Array | Blob, name: string, type: string) => {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** Packs files into a ZIP archive, renaming duplicates. */
export const zip = (files: { name: string; bytes: Uint8Array }[]) => {
  const entries: Record<string, Uint8Array> = {};
  for (const { name, bytes } of files) {
    let unique = name;
    for (let n = 2; unique in entries; n++) {
      unique = name.replace(/(\.[^.]+)?$/, `-${n}$1`);
    }
    // PDFs and images are already compressed
    entries[unique] = bytes;
  }
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, bytes]) => [name, [bytes, { level: 0 }]]),
    ),
  );
};
