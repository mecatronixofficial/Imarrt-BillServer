import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from './prisma.service.js';

describe('PrismaService startup', () => {
  let service: PrismaService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    service = new PrismaService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects immediately when the database is available', async () => {
    const connect = vi.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(Logger.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from temporary reachability failures with bounded backoff', async () => {
    const error = new Prisma.PrismaClientInitializationError('unreachable', '6.19.3', 'P1001');
    const connect = vi.spyOn(service, '$connect')
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const startup = service.onModuleInit();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await startup;

    expect(connect).toHaveBeenCalledTimes(3);
    expect(Logger.warn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the connection error after three failed attempts', async () => {
    const error = new Prisma.PrismaClientInitializationError('unreachable', '6.19.3', 'P1001');
    const connect = vi.spyOn(service, '$connect').mockRejectedValue(error);
    const rejected = expect(service.onModuleInit()).rejects.toBe(error);

    await vi.runAllTimersAsync();
    await rejected;

    expect(connect).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    new Prisma.PrismaClientInitializationError('authentication failed', '6.19.3', 'P1000'),
    new Prisma.PrismaClientInitializationError('invalid database', '6.19.3', 'P1003'),
    new Error('unexpected failure'),
  ])('fails immediately for errors other than database reachability: %s', async (error) => {
    const connect = vi.spyOn(service, '$connect').mockRejectedValue(error);

    await expect(service.onModuleInit()).rejects.toBe(error);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(Logger.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
