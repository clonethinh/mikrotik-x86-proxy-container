import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { routerQueue } from '../../lib/queue';
import { realtimeHub } from '../../realtime/hub';
import { logger } from '../../lib/logger';
import {
  isValidIpv4,
  isValidMac,
  normalizeMac,
  pppoeIdxSchema,
  sanitizeNote,
  safePppoeName,
} from '../../lib/validation';

export const createDeviceRouteSchema = z.object({
  name: z.string().min(1).max(64),
  matchType: z.enum(['ip', 'mac', 'dhcp']),
  ipAddress: z.string().optional(),
  macAddress: z.string().optional(),
  dhcpHostName: z.string().max(128).optional(),
  pppoeIdx: pppoeIdxSchema,
  note: z.string().max(255).optional(),
});

export const updateDeviceRouteSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  matchType: z.enum(['ip', 'mac', 'dhcp']).optional(),
  ipAddress: z.string().optional().nullable(),
  macAddress: z.string().optional().nullable(),
  dhcpHostName: z.string().max(128).optional().nullable(),
  pppoeIdx: pppoeIdxSchema.optional(),
  enabled: z.boolean().optional(),
  note: z.string().max(255).optional().nullable(),
});

function resolveMatch(input: {
  matchType: string;
  ipAddress?: string | null;
  macAddress?: string | null;
}) {
  const ip = input.ipAddress?.trim() || null;
  const mac = input.macAddress ? normalizeMac(input.macAddress) : null;

  if (input.matchType === 'ip') {
    if (!ip || !isValidIpv4(ip)) throw new Error('IP không hợp lệ');
    return { ipAddress: ip, macAddress: mac };
  }
  if (input.matchType === 'mac' || input.matchType === 'dhcp') {
    if (!mac || !isValidMac(mac)) throw new Error('MAC không hợp lệ');
    if (input.matchType === 'dhcp' && ip && !isValidIpv4(ip)) {
      throw new Error('IP DHCP không hợp lệ');
    }
    return { ipAddress: ip, macAddress: mac };
  }
  throw new Error('matchType không hợp lệ');
}

class DeviceRoutingService {
  async list() {
    return prisma.deviceRoute.findMany({ orderBy: { id: 'asc' } });
  }

  async getById(id: number) {
    return prisma.deviceRoute.findUnique({ where: { id } });
  }

  async create(input: z.infer<typeof createDeviceRouteSchema>) {
    const parsed = createDeviceRouteSchema.parse(input);
    const match = resolveMatch(parsed);
    const pppoeName = `pppoe-out${parsed.pppoeIdx}`;
    if (!safePppoeName(pppoeName)) throw new Error('pppoeIdx không hợp lệ');

    const row = await prisma.deviceRoute.create({
      data: {
        name: parsed.name,
        matchType: parsed.matchType,
        ipAddress: match.ipAddress,
        macAddress: match.macAddress,
        dhcpHostName: parsed.dhcpHostName || null,
        pppoeIdx: parsed.pppoeIdx,
        pppoeName,
        enabled: true,
        applied: false,
        statusMessage: 'queued',
        note: parsed.note ? sanitizeNote(parsed.note) : null,
      },
    });

    realtimeHub.broadcast({ type: 'device.created', payload: { id: row.id } });
    void routerQueue.enqueue(() => this.apply(row.id));
    return row;
  }

  async update(id: number, input: z.infer<typeof updateDeviceRouteSchema>) {
    const existing = await prisma.deviceRoute.findUnique({ where: { id } });
    if (!existing) throw new Error('Not found');

    const parsed = updateDeviceRouteSchema.parse(input);
    const matchType = parsed.matchType || existing.matchType;
    const match = resolveMatch({
      matchType,
      ipAddress: parsed.ipAddress !== undefined ? parsed.ipAddress : existing.ipAddress,
      macAddress: parsed.macAddress !== undefined ? parsed.macAddress : existing.macAddress,
    });

    const pppoeIdx = parsed.pppoeIdx ?? existing.pppoeIdx;
    const pppoeName = `pppoe-out${pppoeIdx}`;

    const row = await prisma.deviceRoute.update({
      where: { id },
      data: {
        name: parsed.name ?? existing.name,
        matchType,
        ipAddress: match.ipAddress,
        macAddress: match.macAddress,
        dhcpHostName: parsed.dhcpHostName !== undefined ? parsed.dhcpHostName : existing.dhcpHostName,
        pppoeIdx,
        pppoeName,
        enabled: parsed.enabled ?? existing.enabled,
        applied: false,
        statusMessage: 'queued',
        note: parsed.note !== undefined
          ? (parsed.note ? sanitizeNote(parsed.note) : null)
          : existing.note,
      },
    });

    realtimeHub.broadcast({ type: 'device.updated', payload: { id } });
    void routerQueue.enqueue(() => this.apply(id));
    return row;
  }

  async delete(id: number) {
    const existing = await prisma.deviceRoute.findUnique({ where: { id } });
    if (!existing) throw new Error('Not found');

    await routerQueue.enqueue(async () => {
      const mik = getMikrotikService();
      await mik.removeDeviceRoute(id);
    });

    await prisma.deviceRoute.delete({ where: { id } });
    realtimeHub.broadcast({ type: 'device.deleted', payload: { id } });
  }

  async apply(id: number) {
    const row = await prisma.deviceRoute.findUnique({ where: { id } });
    if (!row) return;

    try {
      const mik = getMikrotikService();
      await mik.ensureDeviceRoute({
        id: row.id,
        matchType: row.matchType as 'ip' | 'mac' | 'dhcp',
        ipAddress: row.matchType === 'mac' ? null : row.ipAddress,
        macAddress: row.macAddress,
        pppoeIdx: row.pppoeIdx,
        enabled: row.enabled,
      });

      await prisma.deviceRoute.update({
        where: { id },
        data: { applied: true, statusMessage: row.enabled ? 'applied' : 'disabled' },
      });
      realtimeHub.broadcast({
        type: 'device.applied',
        payload: { id, pppoeIdx: row.pppoeIdx, enabled: row.enabled },
      });
    } catch (e: any) {
      logger.error({ err: e.message, id }, 'device route apply failed');
      await prisma.deviceRoute.update({
        where: { id },
        data: { applied: false, statusMessage: e.message?.slice(0, 200) },
      });
      realtimeHub.broadcast({ type: 'device.error', payload: { id, error: e.message } });
      throw e;
    }
  }

  async listDhcpLeases() {
    return getMikrotikService().getDhcpLeases();
  }

  async repairAll(): Promise<void> {
    const rows = await prisma.deviceRoute.findMany({ where: { enabled: true } });
    await getMikrotikService().repairAllDeviceRoutes(rows);
    for (const row of rows) {
      await prisma.deviceRoute.update({
        where: { id: row.id },
        data: { applied: true, statusMessage: 'applied' },
      }).catch(() => {});
    }
  }
}

export const deviceRoutingService = new DeviceRoutingService();