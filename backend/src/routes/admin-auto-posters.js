import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { maxBatchPages, batchTooLargeError } from '../lib/qr-artwork-limits.js';
import { AUTO_CREATED_ASSIGNMENT_WHERE, POSTER_PRODUCED_JOB_STATUSES } from '../lib/qr-provisioning.js';
import { buildTemplateSnapshot, normalizeQrCodeList, proofPreviewCodes, qrCodeNumber } from '../lib/auto-poster.js';
import { publicReferralUrl } from '../services/qr-image.js';
import { resolveVendorPosterTemplate } from '../services/vendor-poster.js';

// Admin "Auto-QR posters": print files for the Solar Mitras whose QR was created automatically at
// login (see services/qr.js ensureVendorQr). It adds two routes and reuses the existing print-batch
// proof / approve / download routes unchanged: a batch made here is an ordinary QrPrintJob whose items
// are an explicit list of codes instead of a continuous range. Registered on adminRoutes from
// routes/admin.js, so it sits behind the same Admin authentication and portal handling.

const batchSchema = z.object({
	template_id: z.string().trim().min(1),
	codes: z.array(z.string().trim().min(1)).min(1).max(500),
	idempotency_key: z.string().trim().min(1).optional(),
});

// Currently-automatic QR assignments (oldest number first) with whether a poster was already produced.
async function loadAutoQrs() {
	const rows = await prisma.qrAssignment.findMany({
		where: {
			unassignedAt: null,
			...AUTO_CREATED_ASSIGNMENT_WHERE,
			qrCode: { ...AUTO_CREATED_ASSIGNMENT_WHERE.qrCode, status: 'ACTIVE' },
			vendor: { ...AUTO_CREATED_ASSIGNMENT_WHERE.vendor, status: 'ACTIVE' },
		},
		select: {
			qrCode: {
				select: {
					code: true,
					printJobItems: { where: { printJob: { status: { in: POSTER_PRODUCED_JOB_STATUSES } } }, select: { id: true }, take: 1 },
				},
			},
			vendor: { select: { businessName: true } },
		},
	});
	return rows
		.map((row) => ({ code: row.qrCode.code, businessName: row.vendor.businessName, prepared: row.qrCode.printJobItems.length > 0 }))
		.sort((first, second) => qrCodeNumber(first.code) - qrCodeNumber(second.code));
}

export function registerAutoPosterRoutes(router) {
	router.get('/auto-posters/summary', requireAuth, requireAdmin, async (request, response, next) => {
		try {
			const includePrepared = request.query.include_prepared === 'true';
			const all = await loadAutoQrs();
			const posterTemplate = await resolveVendorPosterTemplate();
			const pending = all.filter((item) => !item.prepared);
			const selected = includePrepared ? all : pending;
			return response.json({
				success: true,
				total: all.length,
				prepared: all.length - pending.length,
				pending: pending.length,
				includePrepared,
				vendorPosterTemplateId: posterTemplate?.id ?? null,
				batchSize: maxBatchPages(),
				codes: selected.map((item) => item.code),
				sample: selected.slice(0, 5).map(({ code, businessName }) => ({ code, businessName })),
			});
		} catch (error) {
			return next(error);
		}
	});

	router.post('/auto-posters/batch', requireAuth, requireAdmin, async (request, response, next) => {
		try {
			const input = batchSchema.parse(request.body);
			const template = await prisma.qrPrintTemplate.findUnique({ where: { id: input.template_id } });
			if (!template) {
				return response.status(404).json({ success: false, error: { code: 'QR_TEMPLATE_NOT_FOUND', message: 'QR template was not found.' } });
			}
			if (template.status !== 'PUBLISHED') {
				return response.status(409).json({ success: false, error: { code: 'QR_TEMPLATE_NOT_PUBLISHED', message: 'Only published templates can be used to print QR codes.' } });
			}

			const codes = normalizeQrCodeList(input.codes);
			if (codes.length > maxBatchPages()) throw batchTooLargeError(codes.length, maxBatchPages());

			// Only automatic Solar Mitra QRs belong in this flow; anything else is refused, so a stale or
			// hand-made request can never put an inventory QR on a poster batch from here.
			const eligible = await prisma.qrAssignment.findMany({
				where: {
					unassignedAt: null,
					...AUTO_CREATED_ASSIGNMENT_WHERE,
					qrCode: { ...AUTO_CREATED_ASSIGNMENT_WHERE.qrCode, code: { in: codes }, status: 'ACTIVE' },
				},
				select: { qrCode: { select: { id: true, code: true } } },
			});
			const idByCode = new Map(eligible.map((row) => [row.qrCode.code, row.qrCode.id]));
			const notEligible = codes.filter((code) => !idByCode.has(code));
			if (notEligible.length) {
				return response.status(409).json({
					success: false,
					error: {
						code: 'AUTO_POSTER_NOT_ELIGIBLE',
						message: `These codes are not automatic Solar Mitra QRs any more (assigned, replaced or removed since the list was loaded): ${notEligible.slice(0, 10).join(', ')}${notEligible.length > 10 ? '...' : ''}. Reload the list and try again.`,
					},
				});
			}

			const idempotencyKey = (input.idempotency_key || `auto-poster-${randomUUID()}`).trim();
			const existing = await prisma.qrPrintJob.findUnique({ where: { idempotencyKey } });
			if (existing) return response.status(200).json({ success: true, job: existing, duplicate: true });

			const job = await prisma.$transaction(async (transaction) => {
				const created = await transaction.qrPrintJob.create({
					data: {
						templateId: template.id,
						createdById: request.auth.user.id,
						idempotencyKey,
						status: 'PENDING_APPROVAL',
						rangeStart: codes[0],
						rangeEnd: codes[codes.length - 1],
						itemCount: codes.length,
						templateSnapshot: buildTemplateSnapshot(template),
						proofSummary: { previewCodes: proofPreviewCodes(codes), decoded: false, source: 'AUTO_POSTERS' },
					},
				});
				await transaction.qrPrintJobItem.createMany({
					data: codes.map((code, index) => ({
						printJobId: created.id,
						qrCodeId: idByCode.get(code),
						sequence: index + 1,
						expectedCode: code,
						expectedUrl: publicReferralUrl(code),
						status: 'PROOF_READY',
					})),
				});
				return created;
			}, { timeout: 20000, maxWait: 10000 });

			return response.status(201).json({ success: true, job });
		} catch (error) {
			if (error.code === 'P2002' && request.body?.idempotency_key) {
				// Lost the race to an identical request: hand back the batch it created.
				const existing = await prisma.qrPrintJob.findUnique({ where: { idempotencyKey: String(request.body.idempotency_key).trim() } }).catch(() => null);
				if (existing) return response.status(200).json({ success: true, job: existing, duplicate: true });
			}
			return next(error);
		}
	});
}
