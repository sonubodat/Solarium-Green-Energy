export function isValidQrCode(code) {
  return /^V-\d{4,}$/.test(String(code || '').trim());
}

export function normalizeQrCode(code) {
  const value = String(code || '').trim().toUpperCase();
  const match = value.match(/^V-(\d+)$/);
  return match ? `V-${match[1].padStart(4, '0')}` : value;
}

export function parseQrRange(startCode, endCode) {
  const start = String(startCode || '').trim();
  const end = String(endCode || '').trim();

  if (!isValidQrCode(start) || !isValidQrCode(end)) {
    throw new Error('QR range must be valid codes like V-0001 to V-0100.');
  }

  const startNumber = Number.parseInt(start.replace(/^V-/, ''), 10);
  const endNumber = Number.parseInt(end.replace(/^V-/, ''), 10);

  if (startNumber > endNumber) {
    throw new Error('The start QR must be before or equal to the end QR.');
  }

  return { start, end, startNumber, endNumber };
}

export function buildQrCodeSequence(startCode, endCode) {
  const { startNumber, endNumber } = parseQrRange(startCode, endCode);
  const codes = [];
  for (let current = startNumber; current <= endNumber; current += 1) {
    codes.push(`V-${String(current).padStart(4, '0')}`);
  }
  return codes;
}
