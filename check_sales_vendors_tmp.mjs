import { prisma } from './src/lib/prisma.js';

const salesUser = await prisma.user.findFirst({ where: { usernameMobile: 'sales@solarium.local' } });
console.log('Sales user id:', salesUser.id);

const allUnassigned = await prisma.vendor.findMany({
  where: { status: 'ACTIVE', assignments: { none: { unassignedAt: null } } },
  select: { id: true, businessName: true, salesUserId: true },
});
console.log('All unassigned-QR-eligible vendors (company-wide):', allUnassigned.length);
console.log(allUnassigned);

const scoped = allUnassigned.filter(v => v.salesUserId === salesUser.id);
console.log('Visible to this sales user (salesUserId match):', scoped.length);
process.exit(0);
