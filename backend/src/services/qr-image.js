import QRCode from 'qrcode';
import { env } from '../config/env.js';

export function publicReferralUrl(code) {
	return `${env.appBaseUrl}/v/${encodeURIComponent(code)}`;
}

export async function generateQrSvg(code) {
	return QRCode.toString(publicReferralUrl(code), { type: 'svg', margin: 2 });
}

// width defaults to the 512 px every existing caller expects; the Solar Mitra's poster download asks for 2048.
export async function generateQrPng(code, width = 512) {
	return QRCode.toBuffer(publicReferralUrl(code), { type: 'png', margin: 2, width });
}
