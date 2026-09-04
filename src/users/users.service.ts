import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { hashPassword } from '../auth/password.util';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto, businessId: string) {
    if (dto.role !== Role.STAFF && dto.role !== Role.ACCOUNTANT) {
      throw new BadRequestException('Team members must be staff or accountants');
    }
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role !== dto.role) {
        throw new ConflictException('This email already belongs to a user with a different role');
      }
      await this.prisma.businessMember.upsert({
        where: { businessId_userId: { businessId, userId: existing.id } },
        update: { isActive: true },
        create: { businessId, userId: existing.id },
      });
      return this.toPublicUser(existing, existing.isActive);
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash,
        role: dto.role,
        businessMemberships: { create: { businessId } },
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    return user;
  }

  async findAll(businessId: string, { limit, offset }: PaginationQueryDto) {
    const members = await this.prisma.businessMember.findMany({
      where: { businessId },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return members.map((member) =>
      this.toPublicUser(member.user, member.isActive && member.user.isActive),
    );
  }

  async deactivate(id: string, actorUserId: string, businessId: string) {
    if (id === actorUserId) throw new BadRequestException('You cannot deactivate your own account');
    const member = await this.prisma.businessMember.update({
      where: { businessId_userId: { businessId, userId: id } },
      data: { isActive: false },
    });
    return { id, isActive: member.isActive };
  }

  private toPublicUser<
    T extends { id: string; name: string; email: string; role: unknown; createdAt: Date },
  >(user: T, isActive: boolean) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive,
      createdAt: user.createdAt,
    };
  }
}
