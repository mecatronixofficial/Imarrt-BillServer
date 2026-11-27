import { ConflictException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ActionSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string) {
    const record = await this.prisma.actionSecurity.findUnique({ where: { userId } });
    return { enabled: record?.enabled ?? false };
  }

  async verify(userId: string, passcode?: string) {
    const record = await this.prisma.actionSecurity.findUnique({ where: { userId } });
    if (!record?.enabled) return;
    if (!record.passcodeHash) throw new ForbiddenException('Passcode settings are unavailable. Contact your administrator.');
    if (record.lockedUntil && record.lockedUntil > new Date()) {
      throw new HttpException('Too many incorrect passcodes. Try again in 5 minutes.', 429);
    }
    if (!passcode) throw new ForbiddenException('PASSCODE_REQUIRED');
    const valid = /^[0-9]{6,12}$/.test(passcode) && await compare(passcode, record.passcodeHash);
    if (!valid) {
      // Expired lockouts begin a new attempt window. The increment is atomic.
      if (record.lockedUntil) await this.prisma.actionSecurity.updateMany({
        where: { userId, lockedUntil: record.lockedUntil }, data: { failedAttempts: 0, lockedUntil: null },
      });
      const failed = await this.prisma.actionSecurity.update({ where: { userId }, data: { failedAttempts: { increment: 1 } } });
      if (failed.failedAttempts >= 5) {
        await this.prisma.actionSecurity.update({ where: { userId }, data: { lockedUntil: new Date(Date.now() + 5 * 60_000) } });
        throw new HttpException('Too many incorrect passcodes. Try again in 5 minutes.', 429);
      }
      throw new ForbiddenException('PASSCODE_INVALID');
    }
    await this.prisma.actionSecurity.update({ where: { userId }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  async update(userId: string, enabled: boolean, passcode?: string, currentPasscode?: string) {
    const previous = await this.prisma.actionSecurity.findUnique({ where: { userId } });
    // Verify again here to protect a rotation if settings changed after the guard ran.
    await this.verify(userId, currentPasscode);
    const data = { enabled, passcodeHash: enabled ? await hash(passcode!, 12) : null, failedAttempts: 0, lockedUntil: null };
    await this.prisma.$transaction(async (tx) => {
      if (previous) {
        const changed = await tx.actionSecurity.updateMany({ where: { userId, passcodeHash: previous.passcodeHash, enabled: previous.enabled }, data });
        if (!changed.count) throw new ConflictException('Passcode settings changed. Reload and try again.');
      } else {
        await tx.actionSecurity.create({ data: { userId, ...data } });
      }
      await tx.auditLog.create({ data: { userId, action: enabled ? 'ACTION_PASSCODE_ENABLED' : 'ACTION_PASSCODE_DISABLED', entityType: 'ActionSecurity', entityId: userId } });
    });
    return { enabled };
  }
}