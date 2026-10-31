import { z } from 'zod';
import { writeZip } from '../services/zip-stream.js';

// One table, three file formats, for the Admin exports. csv is the original; xlsx opens in Excel and Google Sheets
// (every cell is text, so phone numbers and pincodes keep their digits); tsv is tab-separated text for the
// "Copy for Google Sheets" button, which pastes straight into columns. No dependency: an .xlsx is a small ZIP of XML
// files and services/zip-stream.js already writes ZIPs.

// A cell that starts with = + - @ would run as a formula when opened or pasted into a spreadsheet; a leading ' keeps
// it as plain text (CSV injection). Applied to every format.
export function neutralizeFormula(text) {
	return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

const asText = (value) => neutralizeFormula(value === null || value === undefined ? '' : String(value));

function csvCell(value) {
	const text = asText(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers, rows) {
	return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

// Tabs and line breaks inside a cell would break the columns on paste, so they become spaces.
export function toTsv(headers, rows) {
	return [headers, ...rows].map((row) => row.map((value) => asText(value).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
// Also strips characters XML cannot carry (most control characters).
const xml = (text) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => XML_ESCAPES[c]);

function columnName(index) {
	let name = '';
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	return name;
}

// Excel files are built in memory (a ZIP needs the whole sheet), so they are capped; CSV and "copy" have no cap.
export const XLSX_MAX_ROWS = 20000;

function xlsxCell(value, column, row, style) {
	const text = asText(value);
	return text === '' ? '' : `<c r="${columnName(column)}${row}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

// rowChunks: an async iterable of arrays of rows. Only the finished row XML strings are kept, not the row objects.
export async function buildXlsx(headers, rowChunks, sheetName = 'Export') {
	const lines = [`<row r="1">${headers.map((header, column) => xlsxCell(header, column, 1, 1)).join('')}</row>`];
	let widths = null;
	let count = 0;
	for await (const chunk of rowChunks) {
		if (!widths) {
			widths = headers.map((header, column) => {
				const longest = chunk.slice(0, 200).reduce((max, row) => Math.max(max, asText(row[column]).length), String(header).length);
				return Math.min(Math.max(longest + 2, 10), 50);
			});
		}
		for (const row of chunk) {
			if (count >= XLSX_MAX_ROWS) {
				const error = new Error(`Excel files are limited to ${XLSX_MAX_ROWS.toLocaleString('en-IN')} rows. Use a date range to export fewer rows, or choose CSV.`);
				error.statusCode = 422;
				error.code = 'EXPORT_TOO_LARGE_FOR_XLSX';
				throw error;
			}
			count += 1;
			lines.push(`<row r="${count + 1}">${row.map((value, column) => xlsxCell(value, column, count + 1, 0)).join('')}</row>`);
		}
	}
	widths = widths || headers.map((header) => Math.min(Math.max(String(header).length + 2, 10), 50));
	const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
		+ `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
		+ `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
		+ `<cols>${widths.map((width, column) => `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
		+ `<sheetData>${lines.join('')}</sheetData></worksheet>`;
	const files = [
		['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
		['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
		['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
		['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
		['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
		['xl/worksheets/sheet1.xml', sheet],
	];
	const chunks = [];
	await writeZip((async function* entries() { for (const [name, text] of files) yield { name, buffer: Buffer.from(text, 'utf8') }; }()), async (chunk) => { chunks.push(chunk); });
	return Buffer.concat(chunks);
}

export async function toXlsx(headers, rows, sheetName = 'Export') {
	return buildXlsx(headers, [rows], sheetName);
}

const formatSchema = z.enum(['csv', 'xlsx', 'tsv']).default('csv');

// The requested format (?format=csv|xlsx|tsv, default csv); throws 400 for anything else. Exported so a route can
// reject a bad format before it does anything with side effects.
export function exportFormat(request) {
	const parsed = formatSchema.safeParse(request.query.format || undefined);
	if (!parsed.success) {
		const error = new Error('format must be csv, xlsx or tsv.');
		error.statusCode = 400;
		error.code = 'INVALID_FORMAT';
		throw error;
	}
	return parsed.data;
}

// Sends the table in the requested format. baseName has no extension.
export async function sendTable(request, response, { baseName, headers, rows, sheetName }) {
	const format = exportFormat(request);
	if (format === 'xlsx') {
		response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		response.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
		return response.send(await toXlsx(headers, rows, sheetName));
	}
	response.setHeader('Content-Type', format === 'tsv' ? 'text/tab-separated-values; charset=utf-8' : 'text/csv; charset=utf-8');
	response.setHeader('Content-Disposition', `attachment; filename="${baseName}.${format}"`);
	return response.send(format === 'tsv' ? toTsv(headers, rows) : toCsv(headers, rows));
}

// Same as sendTable, but the rows come from `pages`, an async iterable of row arrays (one database page at a time),
// so a big export never holds the whole table in memory: CSV and TSV are written to the response page by page with
// back-pressure. `onComplete` runs after the last page and before the response ends. If the data fails once the
// download has started the connection is cut, so a truncated file is never mistaken for a complete one.
export async function sendTableStream(request, response, { baseName, headers, sheetName, pages, onComplete }) {
	const format = exportFormat(request);
	if (format === 'xlsx') {
		const buffer = await buildXlsx(headers, pages, sheetName);
		if (onComplete) await onComplete();
		response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		response.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
		return response.send(buffer);
	}
	const toLine = format === 'tsv'
		? (row) => row.map((value) => asText(value).replace(/[\t\r\n]+/g, ' ')).join('\t')
		: (row) => row.map(csvCell).join(',');
	const separator = format === 'tsv' ? '\n' : '\r\n';
	response.setHeader('Content-Type', format === 'tsv' ? 'text/tab-separated-values; charset=utf-8' : 'text/csv; charset=utf-8');
	response.setHeader('Content-Disposition', `attachment; filename="${baseName}.${format}"`);
	const write = (text) => (response.write(text) ? null : new Promise((resolve) => { response.once('drain', resolve); response.once('close', resolve); }));
	// The first page is read before anything is sent, so a database failure there is still a clean error response.
	const iterator = pages[Symbol.asyncIterator]();
	let step = await iterator.next();
	try {
		await write(toLine(headers));
		while (!step.done) {
			if (response.destroyed) return;
			if (step.value.length) await write(separator + step.value.map(toLine).join(separator));
			step = await iterator.next();
		}
		if (onComplete) await onComplete();
		response.end();
	} catch (error) {
		if (!response.headersSent) throw error;
		response.destroy(error);
	}
}

// Reads a table one page at a time with a cursor: fetchPage(cursorId, take) returns up to `take` rows in a fixed order
// (the caller adds the cursor and a unique tie-break); the last row's id is the next cursor.
export async function* pagedRows(fetchPage, toRow, pageSize = 500) {
	let cursor = null;
	for (;;) {
		const rows = await fetchPage(cursor, pageSize);
		if (!rows.length) return;
		yield rows.map(toRow);
		if (rows.length < pageSize) return;
		cursor = rows[rows.length - 1].id;
	}
}
