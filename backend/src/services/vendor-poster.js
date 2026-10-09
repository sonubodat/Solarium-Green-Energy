import { prisma } from '../lib/prisma.js';

// The template a Solar Mitra's own poster download uses: the one Admin chose (vendorPoster) if it is still
// published, otherwise the newest published template, so a retired choice can never break the download.
// The Admin Auto-QR posters screen starts from the same answer, so the two always agree.
export async function resolveVendorPosterTemplate(client = prisma) {
	return (await client.qrPrintTemplate.findFirst({ where: { status: 'PUBLISHED', vendorPoster: true } }))
		|| client.qrPrintTemplate.findFirst({ where: { status: 'PUBLISHED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}

// Makes one published template the Solar Mitra poster template (clears the flag everywhere else) inside the caller's
// transaction. Returns null when the template is missing, or 'NOT_PUBLISHED'.
export async function setVendorPosterTemplate(transaction, templateId) {
	const template = await transaction.qrPrintTemplate.findUnique({ where: { id: templateId }, select: { id: true, status: true, name: true } });
	if (!template) return null;
	if (template.status !== 'PUBLISHED') return 'NOT_PUBLISHED';
	await transaction.qrPrintTemplate.updateMany({ where: { vendorPoster: true, id: { not: templateId } }, data: { vendorPoster: false } });
	await transaction.qrPrintTemplate.update({ where: { id: templateId }, data: { vendorPoster: true } });
	return template;
}
