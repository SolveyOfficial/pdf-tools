# Solvey PDF Tools

Free PDF tools that run entirely in your browser.

Live: https://solveyofficial.github.io/pdf-tools/

- **Merge**: join PDFs and images into one PDF
- **Organise pages**: reorder, rotate and delete pages, or combine pages from
  several PDFs
- **Split**: extract pages, or split into ranges, single pages or equal parts
- **Compress**: make a PDF smaller than a size limit (100 KB to 2 MB), choose a
  quality, or re-save it without changing anything
- **Images to PDF**: one image per page on A4, Letter or image-sized pages;
  JPG and PNG images keep their full quality, and phone photos are turned
  upright
- **PDF to images**: save pages as JPG or PNG at 72, 150 or 300 DPI

## Private by design

Your files are never uploaded. The app has no analytics or tracking, and it
serves its own fonts and PDF renderer, so it loads nothing from other sites.

Built with [pdf-lib](https://pdf-lib.js.org) and Mozilla's
[pdf.js](https://mozilla.github.io/pdf.js/).

## Development

You need Node.js 22.13 or later.

```sh
npm install
npm run dev        # development server
npm run lint       # Prettier and ESLint
npm run typecheck  # TypeScript
npm test           # unit tests
npm run build      # production build in dist/
```

Set `BASE_PATH` (for example `BASE_PATH=/pdf-tools/`) when the app is served
from a sub-path. The build also writes `THIRD_PARTY_NOTICES.md`, listing every
bundled package, font and data file with its licence; the app links to it as
"Licences".

When the repository is public, every push to `main` is published to GitHub
Pages.

## Licence

MIT, see LICENSE.
