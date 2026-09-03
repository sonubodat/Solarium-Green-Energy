# QR Template and Placement Specification

## Purpose

An Admin creates a reusable physical print template, uploads optional artwork, places a QR placeholder, publishes the geometry, and then creates print batches from explicit QR ranges.

## User flow

1. Admin opens **QR Management**.
2. Admin clicks **Create template**.
3. The template form appears. It stays closed by default so the QR inventory view remains focused.
4. Admin uploads one artwork file: PNG, JPG, or PDF, maximum 2 MB.
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
- accepts only `image/png`, `image/jpeg`, and `application/pdf`;
- rejects files over 2 MB;
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

Production generation is a separate queued worker step. The worker must generate the complete PDF, record progress, retry a failed job safely, and store the final PDF privately in `qr-artifacts`. A retry must resume or replace only the same idempotent job; it must never create a second production batch.

## Verification checklist

- [x] The form is hidden until **Create template** is clicked.
- [x] Selecting a file shows its filename before submission.
- [x] The artwork is shown in a page-proportional editor preview.
- [x] The QR placeholder can be dragged visually.
- [x] Resizing keeps the QR square.
- [x] The normal editor does not require the client to enter X/Y coordinates.
- [x] Advanced placement fields are available only under an explicit disclosure.
- [x] A valid PNG, JPG, or PDF under 2 MB creates a `DRAFT` template.
- [x] An invalid file type returns a readable validation error.
- [x] A file over 2 MB returns `QR_ARTWORK_TOO_LARGE`.
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
