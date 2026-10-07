import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { PERMISSION_SCREENS, findUnknownPermissions, normalizePermissions } from '../lib/permissions.js';

// Admin-defined back-office roles (super-admin only, and not delegable): a name, a description and the list of
// permission keys from lib/permissions.js. Registered on adminRoutes from routes/admin.js. Editing a role takes
// effect on its users' very next request, because requireAuth reads the role from the database every time.

const roleSchema = z.object({
	name: z.string().trim().min(2).max(60),
	description: z.string().trim().max(300).nullish(),
	permissions: z.array(z.string()).max(100),
});

function httpError(statusCode, code, message, details) {
	const error = new Error(message);
	error.statusCode = statusCode;
	error.code = code;
	if (details) error.details = details;
	return error;
}

// The permissions stored for a role: unknown keys are refused, dependencies (view, edit) are added.
function cleanPermissions(permissions) {
	const unknown = findUnknownPermissions(permissions);
	if (unknown.length) throw httpError(400, 'UNKNOWN_PERMISSION', 'Some permissions are not recognised.', { unknown });
	return normalizePermissions(permissions);
}

const catalogView = () => PERMISSION_SCREENS.map((screen) => ({
	key: screen.key,
	label: screen.label,
	permissions: screen.permissions.map(([key, label]) => ({ key, label })),
}));

function roleView(role, userCount) {
	return { id: role.id, name: role.name, description: role.description, permissions: role.permissions, userCount, createdAt: role.createdAt, updatedAt: role.updatedAt };
}

function audit(transaction, request, action, roleId, metadata = {}) {
	return transaction.auditLog.create({
		data: { actorUserId: request.auth.user.id, actorRole: request.auth.user.role, action, entity: 'AccessRole', entityId: roleId, metadata },
	});
}

function nameTaken(error) {
	if (error.code !== 'P2002') return error;
	return httpError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists.');
}

export function registerRoleRoutes(router) {
	router.get('/roles', requireAuth, requireAdmin, async (_request, response, next) => {
		try {
			const roles = await prisma.accessRole.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
			return response.json({ success: true, roles: roles.map((role) => roleView(role, role._count.users)), catalog: catalogView() });
		} catch (error) {
			return next(error);
		}
	});

	router.post('/roles', requireAuth, requireAdmin, async (request, response, next) => {
		try {
			const input = roleSchema.parse(request.body);
			const permissions = cleanPermissions(input.permissions);
			const role = await prisma.$transaction(async (transaction) => {
				const created = await transaction.accessRole.create({
					data: { name: input.name, description: input.description || null, permissions, createdById: request.auth.user.id },
				});
				await audit(transaction, request, 'ROLE_CREATED', created.id, { name: created.name, permissions });
				return created;
			});
			return response.status(201).json({ success: true, role: roleView(role, 0) });
		} catch (error) {
			return next(nameTaken(error));
		}
	});

	router.patch('/roles/:roleId', requireAuth, requireAdmin, async (request, response, next) => {
		try {
			const input = roleSchema.parse(request.body);
			const permissions = cleanPermissions(input.permissions);
			const role = await prisma.$transaction(async (transaction) => {
				const current = await transaction.accessRole.findUnique({ where: { id: request.params.roleId }, select: { id: true } });
				if (!current) throw httpError(404, 'ROLE_NOT_FOUND', 'Role was not found.');
				const updated = await transaction.accessRole.update({
					where: { id: current.id },
					data: { name: input.name, description: input.description || null, permissions },
					include: { _count: { select: { users: true } } },
				});
				await audit(transaction, request, 'ROLE_UPDATED', updated.id, { name: updated.name, permissions });
				return updated;
			});
			return response.json({ success: true, role: roleView(role, role._count.users) });
		} catch (error) {
			return next(nameTaken(error));
		}
	});

	router.delete('/roles/:roleId', requireAuth, requireAdmin, async (request, response, next) => {
		try {
			await prisma.$transaction(async (transaction) => {
				const current = await transaction.accessRole.findUnique({ where: { id: request.params.roleId }, include: { _count: { select: { users: true } } } });
				if (!current) throw httpError(404, 'ROLE_NOT_FOUND', 'Role was not found.');
				if (current._count.users > 0) {
					throw httpError(409, 'ROLE_IN_USE', `This role is used by ${current._count.users} user(s). Move them to another role first.`);
				}
				await transaction.accessRole.delete({ where: { id: current.id } });
				await audit(transaction, request, 'ROLE_DELETED', current.id, { name: current.name });
			});
			return response.json({ success: true });
		} catch (error) {
			// A user was given this role between the count and the delete: the foreign key refuses it.
			if (error.code === 'P2003') return next(httpError(409, 'ROLE_IN_USE', 'This role is used by a user. Move them to another role first.'));
			return next(error);
		}
	});
}
