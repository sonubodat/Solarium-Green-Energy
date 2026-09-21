// Minimal streaming ZIP writer (store only, no compression: the entries are PDFs, which are
// already compressed). One entry is written at a time, so memory is bounded by the largest entry.
// No dependency, no ZIP64 (entries < 4 GB, < 65,535 files: far beyond what a print batch needs).
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(buffer) {
	let crc = 0xffffffff;
	for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
	const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
	const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { time, day };
}

// entries: async iterable of { name, buffer }. write: async (Buffer) => void (may apply backpressure).
// shouldStop: optional () => boolean, checked between entries (client went away). Returns the number of
// entries written; the central directory is only written when every entry was.
export async function writeZip(entries, write, shouldStop = () => false) {
	const central = [];
	let offset = 0;
	const { time, day } = dosDateTime(new Date());

	for await (const { name, buffer } of entries) {
		if (shouldStop()) return { complete: false, count: central.length };
		const nameBytes = Buffer.from(name, 'utf8');
		const crc = crc32(buffer);
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0);
		header.writeUInt16LE(20, 4); // version needed
		header.writeUInt16LE(0x0800, 6); // UTF-8 names
		header.writeUInt16LE(0, 8); // method: store
		header.writeUInt16LE(time, 10);
		header.writeUInt16LE(day, 12);
		header.writeUInt32LE(crc, 14);
		header.writeUInt32LE(buffer.length, 18);
		header.writeUInt32LE(buffer.length, 22);
		header.writeUInt16LE(nameBytes.length, 26);
		header.writeUInt16LE(0, 28);
		await write(header);
		await write(nameBytes);
		await write(buffer);
		central.push({ nameBytes, crc, size: buffer.length, offset });
		offset += 30 + nameBytes.length + buffer.length;
	}

	const directoryStart = offset;
	let directorySize = 0;
	for (const entry of central) {
		const record = Buffer.alloc(46);
		record.writeUInt32LE(0x02014b50, 0);
		record.writeUInt16LE(20, 4); // version made by
		record.writeUInt16LE(20, 6); // version needed
		record.writeUInt16LE(0x0800, 8);
		record.writeUInt16LE(0, 10);
		record.writeUInt16LE(time, 12);
		record.writeUInt16LE(day, 14);
		record.writeUInt32LE(entry.crc, 16);
		record.writeUInt32LE(entry.size, 20);
		record.writeUInt32LE(entry.size, 24);
		record.writeUInt16LE(entry.nameBytes.length, 28);
		record.writeUInt32LE(entry.offset, 42);
		await write(record);
		await write(entry.nameBytes);
		directorySize += 46 + entry.nameBytes.length;
	}
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(central.length, 8);
	end.writeUInt16LE(central.length, 10);
	end.writeUInt32LE(directorySize, 12);
	end.writeUInt32LE(directoryStart, 16);
	await write(end);
	return { complete: true, count: central.length };
}
