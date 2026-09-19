# QR Template and Placement Specification

## Purpose

An Admin creates a reusable physical print template, uploads optional artwork, places a QR placeholder, publishes the geometry, and then creates print batches from explicit QR ranges.

## User flow

1. Admin opens **QR Management**.
2. Admin clicks **Create template**.
3. The template form appears. It stays closed by default so the QR inventory view remains focused.
4. Admin uploads one artwork file: PNG, JPG, or **single-page** PDF, maximum 8 MB (inclusive: exactly 8 MiB is accepted, one byte more is rejected).
5. The editor displays the artwork at a stable page aspect ratio with a visible QR placeholder on top.
6. Admin drags the QR placeholder and resizes it visually. The placeholder remains square during both operations.
7. The editor calculates and stores the resulting position and size in millimetres. Technical X/Y fields remain hidden under **Advanced placement**.
8. Admin optionally enables a `V-0001` label and positions it in the editor.
9. The backend uploads the artwork to the private `qr-artifacts` bucket and stores its object key and metadata on the template record.
10. Admin saves the template as `DRAFT`.
11. Admin reviews the artwork and placeholder position, then publishes an immutable template version.
12. Admin creates a print batch by selecting a published template and an explicit QR range such as `V-0001` through `V-10000`.

## Placement contract

The QR placeholder is independent of the uploaded artwork. Artwork provides the visual background; the visual editor controls these stored placement fields:

- `page_width_mm`
- `page_height_mm`
- `qr_x`
- `qr_y`
- `qr_width`
- `qr_height`

The origin is the top-left of the physical page. Coordinates and dimensions are millimetres. The editor must enforce `qr_width == qr_height`; the QR must never be stretched into a rectangle. The QR rectangle must satisfy:

```text
0 <= qr_x
0 <= qr_y
qr_x + qr_width <= page_width_mm
qr_y + qr_height <= page_height_mm
```

The client-facing editor should show the size as one square value, for example `QR size: 35 mm x 35 mm`. Dragging changes X/Y. Corner resizing changes both width and height by the same amount. The editor may expose raw X/Y/size fields only inside an **Advanced placement** disclosure for precision work.

If a text label is enabled, `label_text_x`, `label_text_y`, and `label_font_size` use the same page coordinate system.

A PDF renderer converts millimetres to PDF points with:

```text
points = millimetres * 72 / 25.4
```

The renderer must preserve the template page dimensions and must not infer a QR position from the image dimensions, file name, or upload order.

## Upload handling

The browser sends the form as `multipart/form-data` with the artwork under the `artwork` field. The browser must not set the `Content-Type` header manually; `fetch` supplies the multipart boundary.

The backend:

- authenticates the Admin session before processing the file;
- accepts only `image/png`, `image/jpeg` and single-page `application/pdf`;
- **validates the actual file content, not the declared Content-Type** (`inspectArtwork` in `backend/src/services/qr-artwork.js`): images are decoded with `sharp`, PDFs are parsed with `pdf-lib`. Before this existed a random binary declared `image/png` was accepted and stored. The same inspector runs again at generation time, so a successful upload genuinely implies a printable file;
- rejects a multi-page PDF with `400 QR_ARTWORK_MULTIPAGE_PDF`, naming the real page count;
- rejects an unreadable file with `400 QR_ARTWORK_CORRUPT`, a password-protected PDF with `400 QR_ARTWORK_ENCRYPTED`, and a PDF whose page has no drawable content with `400 QR_ARTWORK_EMPTY_PDF` (pdf-lib cannot embed a page with no content stream);
- rejects files over 8 MB with `413 QR_ARTWORK_TOO_LARGE` (the limit and both error messages live in `backend/src/lib/qr-artwork-limits.js`, so the multer, service and global error-handler paths respond identically);
- stores artwork in `SUPABASE_QR_STORAGE_BUCKET`, defaulting to `qr-artifacts`;
- stores only the private object key and file metadata in PostgreSQL;
- does not make the bucket public;
- must remove an uploaded object if the database insert fails after upload.

## Publishing and batches

Published artwork and geometry are immutable. A correction creates a new template version rather than mutating a template already used for printing.

A print batch must:

- reference a published template;
- validate the QR range format and order;
- verify every code in the range exists;
- never create missing QR records;
- snapshot the exact ordered QR list and published template version;
- prevent duplicate batches with an idempotency key;
- produce representative proof pages before final generation;
- decode every QR on every proof page and compare it with the expected `/v/V-####` URL;
- require explicit Admin approval before final generation.

**"Never create missing QR records" describes the print-batch route itself, not the admin's overall ability to print.** The Print QR Codes wizard's Step 1 checks the selected range against inventory (`GET /api/admin/qr/range-check`) before the admin can continue, and offers a **separate, explicit, audited** "Generate N missing QR codes" action (`POST /api/admin/qr/generate-range`) when there's a gap. That action is its own deliberate inventory event — the same `QR_GENERATED` audit action the sequential generator writes, distinguished by `mode: 'range'` in its metadata — not something print-batch does as a side effect of printing. `POST /api/admin/qr/print-batch` is unmodified and still refuses a range with any missing code.

Production generation is a separate queued worker step. The worker must generate the complete PDF, record progress, retry a failed job safely, and store the final PDF privately in `qr-artifacts`. A retry must resume or replace only the same idempotent job; it must never create a second production batch.

## Artwork formats and the two composers

`backend/src/services/qr-proof.js` composes every print PDF. **PDFKit cannot embed a PDF page and pdf-lib cannot consume a PDFKit document mid-stream**, so the two libraries are never mixed inside one document — the engine is chosen by artwork type:

| Artwork | Engine | How the artwork is reused |
|---|---|---|
| PNG / JPG | PDFKit (unchanged) | `document.openImage()` once, referenced by every page |
| Single-page PDF | pdf-lib | `embedPdf(bytes, [0])` once, `drawPage` on every page |

Geometry is resolved in exactly one place (`resolveGeometry`) and handed to whichever engine composes the document, so the two paths cannot drift. pdf-lib's bottom-left origin and text baseline are converted inside its composer only. Equivalence was verified by rendering the same template through both engines at 200 DPI: the QR bounding box was **pixel-identical** and the label shared the same top-left anchor (2 px width difference out of 97 px, from Helvetica metric differences between the two libraries).

`generateQrProof` renders through the same geometry and composer as production, **artwork included**, so approving a proof means approving what will actually print. (Proof pages previously showed the QR on a blank page for every format.)

**pdf-lib caveats, by design:**
- `embedPage` copies page content and resources only — **annotations are not copied** (links, form fields). Harmless for print artwork.
- Password-protected PDFs are rejected rather than loaded with `ignoreEncryption`. Note that pdf-lib only flags a PDF as encrypted when its `/Encrypt` entry resolves to a real object, which is always true of a genuinely encrypted file.
- pdf-lib has **no native or system dependency** — it installs and runs on Render with no OS-level packages. Rasterising the PDF instead (pdfjs-dist + node-canvas, or a MuPDF wasm build) was rejected: node-canvas needs cairo/pango system libraries, and rasterising would discard vector quality on artwork destined for physical print.

## PDF generation cost and known limits

- The template artwork is stored **once per template** in the private-intent `qr-artifacts` bucket; print jobs reference the template and never copy it. Storage used = number of templates x artwork size, independent of how many print jobs exist.
- `generateQrTemplatePdf` opens the artwork image **once** and reuses it on every page. (pdfkit only de-duplicates images passed as string paths, so passing the buffer per page used to embed a full copy on each page: 10 pages of an 8 MB PNG was a 79.7 MB PDF.) Measured with 8 MB artwork after the fix: 10 pages = 8.1 MB, 200 pages = 10.1 MB, 1000 pages = 18.8 MB (about 30 s, peak RSS about 376 MB).
- **Measured cost per engine** (same 1000-page workload, measured on the dev machine against the real database):

  | Pages | pdf-lib, 7.3 MB PDF artwork | PDFKit, 5.3 MB JPEG artwork |
  |---|---|---|
  | 10 | 7.08 MB · 3.4 s · 273 MB RSS | 0.29 MB · 1.9 s · 267 MB RSS |
  | 50 | 7.49 MB · 5.0 s · 328 MB RSS | 0.73 MB · 3.2 s · 272 MB RSS |
  | 200 | 9.02 MB · 9.6 s · 442 MB RSS | 2.38 MB · 7.1 s · 285 MB RSS |
  | 1000 | 17.20 MB · 41.8 s · **922 MB RSS** | 11.15 MB · 29.5 s · 318 MB RSS |

- **Known limitation — memory is not constant.** Output *size* stays flat because the artwork is embedded once, but both engines assemble the whole document in memory and return it in one response, and **pdf-lib's peak RSS grows far more steeply than PDFKit's** (922 MB vs 318 MB at 1000 pages) because it holds the entire document object graph plus one embedded image per unique QR. A 1000-page PDF-artwork run will exceed a 512 MB container. Until the queued production worker (unchecked below) exists, **keep PDF-artwork print jobs to a few hundred pages** and split larger runs into several batches; check the deployed instance's memory before raising that.
- An artwork that cannot be rendered is **never silently dropped**: generation re-inspects the stored file and raises a clear error naming the job.

## Verification checklist

- [x] The form is hidden until **Create template** is clicked.
- [x] Selecting a file shows its filename before submission.
- [x] The artwork is shown in a page-proportional editor preview.
- [x] The QR placeholder can be dragged visually.
- [x] Resizing keeps the QR square.
- [x] The normal editor does not require the client to enter X/Y coordinates.
- [x] Advanced placement fields are available only under an explicit disclosure.
- [x] A valid PNG, JPG, or single-page PDF up to 8 MB creates a `DRAFT` template.
- [x] A multi-page PDF returns `QR_ARTWORK_MULTIPAGE_PDF` naming the page count, and no template is created.
- [x] A corrupt, encrypted, or blank-page PDF is rejected with its own error code.
- [x] Any other type (e.g. GIF) returns `INVALID_QR_ARTWORK_TYPE`.
- [x] An invalid file type returns a readable validation error.
- [x] A file over 8 MB returns `QR_ARTWORK_TOO_LARGE` (exactly 8 MB is accepted).
- [x] The artwork is stored in the private `qr-artifacts` bucket.
- [x] The database record contains `artworkPath`, `artworkFileName`, and `artworkMimeType`.
- [x] QR placement remains controlled by the numeric template fields.
- [x] Publishing is available only after the draft has been reviewed.
- [x] A print batch accepts only published templates and existing QR ranges.
- [x] A range such as `V-0001` through `V-10000` is validated against existing QR records.
- [x] Missing QR records are reported and never created as a side effect.
- [x] The batch stores the exact ordered QR snapshot.
- [x] Representative proof pages are generated before production.
- [x] Every proof QR is decoded and checked against its expected code and URL.
- [ ] Production is queued and reports progress.
- [ ] Retries are idempotent and do not duplicate jobs.
- [ ] The final PDF is stored privately.
- [x] A failed database write does not leave an orphaned artwork object.
- [x] A failed proof metadata write does not leave an orphaned proof object.

## Which template printed which QR

The QR → template → Solar Mitra mapping is held by the existing print-job tables, not by a field on the QR code:

```text
QrCode -- QrPrintJobItem --> QrPrintJob --> QrPrintTemplate
QrCode -- QrAssignment ----> Vendor            (current holder)
```

A **single-code designed PDF** (`GET /api/admin/qr/template-pdf`) is recorded the same way as a batch: one `QrPrintJob` with `kind = SINGLE` and one item. The record is written **only after the PDF has generated**, so a failed download never creates false history. `QrPrintJob.kind` (`BATCH` | `SINGLE`) exists because a batch may legitimately contain a single code, so the two cannot be told apart by `itemCount`.

Reprinting a code **adds** a print record and never overwrites or deletes an earlier one, so the full print history of any code is preserved. `GET /api/admin/qr` exposes `latestPrint` per code for the QR table; `GET /api/admin/qr/:qrId/print-history` returns every print; `GET /api/admin/qr/print-jobs` lists jobs with filters, and `/print-history/export` gives the client a CSV.

**Consequence for template deletion:** because a single print creates a job row, a template becomes **archive-only after its first single print** — deleting it would mean destroying that print history. The `409 QR_TEMPLATE_HAS_PRINT_JOBS` message and the Saved-templates usage label both name batches and single prints separately so the reason is explicit.

## Deleting, archiving, and restoring a template

A `QrPrintJob` holds a required foreign key to its `QrPrintTemplate` (no cascade), so a template that's been used for any real print job — batch or single-code — can never be safely hard-deleted; that job's own `templateSnapshot` (an immutable copy of the template's rendering fields, captured at creation time) is what actually renders its PDF/proof, never the live template row. Two admin actions reflect this directly instead of one action that behaves inconsistently: **Delete** only succeeds when zero `QrPrintJob` rows reference the template (verified inside a transaction, with the FK's own `P2003` as a backstop against a genuinely concurrent print-job creation); **Archive** sets `status: ARCHIVED` unconditionally and is always reversible via **Restore** (`status` back to `PUBLISHED`) — nothing about the template's artwork or history is touched either way.

No QR code ever stores which template it was printed with — reprinting always means picking a template fresh from whichever ones are currently `PUBLISHED`, so removing a template (either way) can never break reprinting: the admin either picks a different currently-published template, or falls back to the template-less "blank QR" export (`GET /api/admin/qr/pdf`, `GET /api/admin/qr/print`), which has no dependency on templates at all.

- [x] A template with zero print jobs can be deleted, and its uploaded artwork is removed from storage after the database delete commits (never before, and a storage-cleanup failure is logged, not reported as a failed delete).
- [x] A template referenced by any print job cannot be deleted (`409 QR_TEMPLATE_HAS_PRINT_JOBS`) — archiving is offered instead.
- [x] A template is archived or deleted, never both, and the admin sees which one actually happened.
- [x] `GET /api/admin/qr/templates` reports each template's print-job usage count, split into batches and single prints, so the admin can check before deciding.
- [x] An archived template is rejected by `POST /api/admin/qr/print-batch` for new batches (this route enforces `PUBLISHED` with no environment-based exception).
- [x] An archived template's own past print jobs keep generating correctly from their `templateSnapshot`, unaffected by the archive.
- [x] Restoring an archived template makes it usable for new print jobs again, with no data loss.
- [x] A concurrent delete-vs-print-job-creation race never leaves a `QrPrintJob` pointing at a deleted template.

## Proof preview and the Content-Security-Policy

Step 3 of the print wizard embeds the proof PDF in an `<iframe>` whose `src` is a signed Supabase Storage URL (`GET /api/admin/qr/print-batch/:jobId/proof` → `proof_url`). `frontend/vercel.json`'s CSP must therefore list `https://*.supabase.co` in `frame-src` (alongside `'self' blob:`); without it the browser blocks the frame ("Framing ... violates ... frame-src") and the proof appears blank even though the `POST .../proof` returned `201`. Keep `frame-src`, `img-src` and `connect-src` in sync when changing storage hosts.
