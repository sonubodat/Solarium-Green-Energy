import QRCode from 'qrcode';
import { env } from '../config/env.js';

export function publicReferralUrl(code) {
	return `${env.appBaseUrl}/v/${encodeURIComponent(code)}`;
}

// A QR image for a code never changes, and the Solar Mitra portal asks for it on every load: keep the last 500.
const svgCache = new Map();
export async function generateQrSvg(code) {
	const hit = svgCache.get(code);
	if (hit) return hit;
	const svg = await QRCode.toString(publicReferralUrl(code), { type: 'svg', margin: 2 });
	if (svgCache.size >= 500) svgCache.delete(svgCache.keys().next().value);
	svgCache.set(code, svg);
	return svg;
}

// width defaults to the 512 px every existing caller expects; the Solar Mitra's poster download asks for 2048.
export async function generateQrPng(code, width = 512) {
	return QRCode.toBuffer(publicReferralUrl(code), { type: 'png', margin: 2, width });
}
