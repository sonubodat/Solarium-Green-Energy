import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, toTsv, toXlsx, exportFormat } from '../src/lib/table-export.js';

const headers = ['Name', 'Phone', 'Note'];
const rows = [['Ram "Store"', '9876543210', 'a, b'], ['=SUM(A1)', '+91 98', 'line1\nline2\tx'], [null, undefined, '<tag> & more']];

test('csv is unchanged: quoted cells, CRLF, formula-neutralised', () => {
	assert.equal(toCsv(headers, rows), 'Name,Phone,Note\r\n"Ram ""Store""",9876543210,"a, b"\r\n\'=SUM(A1),\'+91 98,"line1\nline2\tx"\r\n,,<tag> & more');
});

test('tsv pastes cleanly into spreadsheet columns', () => {
	const lines = toTsv(headers, rows).split('\n');
	assert.equal(lines.length, 4);
	assert.ok(lines.every((line) => line.split('\t').length === 3), 'every row has exactly 3 columns');
	assert.equal(lines[2], "'=SUM(A1)\t'+91 98\tline1 line2 x");
});

test('xlsx is a ZIP with the parts a spreadsheet app needs, text cells, escaped XML', async () => {
	const buffer = await toXlsx(headers, rows, 'Leads');
	assert.equal(buffer.subarray(0, 2).toString(), 'PK');
	const text = buffer.toString('latin1');
	for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(text.includes(part), part);
	assert.ok(text.includes('&lt;tag&gt; &amp; more'));
	assert.ok(text.includes('9876543210'));
	assert.ok(text.includes("'=SUM(A1)"));
	assert.ok(text.includes('name="Leads"'));
});

test('format parameter: default csv, only csv/xlsx/tsv allowed', () => {
	assert.equal(exportFormat({ query: {} }), 'csv');
	assert.equal(exportFormat({ query: { format: 'xlsx' } }), 'xlsx');
	assert.throws(() => exportFormat({ query: { format: 'pdf' } }), (e) => e.statusCode === 400 && e.code === 'INVALID_FORMAT');
});
