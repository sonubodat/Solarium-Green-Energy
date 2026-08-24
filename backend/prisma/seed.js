import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

dotenv.config({ path: '.env.local' });
dotenv.config();

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to run the seed.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
}

async function main() {
  const admin = await prisma.user.upsert({
    where: { usernameMobile: 'admin@solarium.local' },
    update: {},
    create: { name: 'Development Admin', usernameMobile: 'admin@solarium.local', passwordHash: await hashPassword('Admin@12345'), role: 'ADMIN' },
  });
  const sales = await prisma.user.upsert({
    where: { usernameMobile: 'sales@solarium.local' },
    update: {},
    create: { name: 'Development Sales', usernameMobile: 'sales@solarium.local', passwordHash: await hashPassword('Sales@12345'), role: 'SALES' },
  });
  const vendorA = await prisma.vendor.upsert({
    where: { loginIdentifier: 'ram-store' },
    update: { salesUserId: sales.id },
    create: { businessName: 'Ram Store', ownerName: 'Ram Kumar', loginIdentifier: 'ram-store', mobileNumber: '9876543210', passwordHash: await hashPassword('Vendor@12345'), mustChangePassword: false, salesUserId: sales.id },
  });
  const vendorB = await prisma.vendor.upsert({
    where: { loginIdentifier: 'abc-store' },
    update: { salesUserId: sales.id },
    create: { businessName: 'ABC Store', ownerName: 'Asha Sharma', loginIdentifier: 'abc-store', mobileNumber: '9876543211', passwordHash: await hashPassword('Vendor@12345'), mustChangePassword: false, salesUserId: sales.id },
  });
  const qrOne = await prisma.qrCode.upsert({ where: { code: 'V-0001' }, update: {}, create: { code: 'V-0001' } });
  const qrTwo = await prisma.qrCode.upsert({ where: { code: 'V-0002' }, update: {}, create: { code: 'V-0002' } });
  await prisma.qrCode.upsert({ where: { code: 'V-0003' }, update: {}, create: { code: 'V-0003' } });

  for (const [qr, vendor] of [[qrOne, vendorA], [qrTwo, vendorB]]) {
    const assignment = await prisma.qrAssignment.findFirst({ where: { qrCodeId: qr.id, unassignedAt: null } });
    if (!assignment) {
      await prisma.qrAssignment.create({ data: { qrCodeId: qr.id, vendorId: vendor.id, assignedById: admin.id } });
      await prisma.qrCode.update({ where: { id: qr.id }, data: { status: 'ACTIVE' } });
    }
  }
  console.log('Development seed completed.');
  console.log('Admin: admin@solarium.local / Admin@12345');
  console.log('Sales: sales@solarium.local / Sales@12345');
  console.log('Vendor: ram-store / Vendor@12345');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
