import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

const resetLifetimeMs = 1000 * 60 * 15;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPasswordResetToken({ userId, vendorId }) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);

  await prisma.passwordResetToken.deleteMany({
    where: { OR: [{ userId: userId || undefined }, { vendorId: vendorId || undefined }] },
  });
  await prisma.passwordResetToken.create({
    data: {
      userId,
      vendorId,
      tokenHash,
      expiresAt: new Date(Date.now() + resetLifetimeMs),
    },
  });
  return token;
}

export async function consumePasswordResetToken(token) {
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
    return null;
  }
  return resetToken;
}

export async function markPasswordResetTokenUsed(id) {
  await prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
}

export function resetTokenResponse(token, message) {
  const response = { success: true, message };
  if (process.env.NODE_ENV !== 'production') {
    response.reset_token = token;
  }
  return response;
}
