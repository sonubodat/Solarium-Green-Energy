import QRCode from 'qrcode';
import { env } from '../config/env.js';

export function publicReferralUrl(code) {
	return `${env.appBaseUrl}/v/${encodeURIComponent(code)}`;
}

export async function generateQrSvg(code) {
	return QRCode.toString(publicReferralUrl(code), { type: 'svg', margin: 2 });
}

export async function generateQrPng(code) {
	return QRCode.toBuffer(publicReferralUrl(code), { type: 'png', margin: 2, width: 512 });
}
