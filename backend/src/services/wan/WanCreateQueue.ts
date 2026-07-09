// Hàng đợi tạo PPPoE — cho phép enqueue liên tục, xử lý tuần tự từng job
import { randomUUID } from 'crypto';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { realtimeHub } from '../../realtime/hub';
import { audit } from '../audit';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { enablePppoeAndApply } from './WanEnableService';

export interface WanCreateJob {
  id: string;
  enable: boolean;
  createProxy: boolean;
  preferredIdx?: number;
  userId: number;
  username: string;
  ip: string;
  enqueuedAt: number;
}

export interface WanCreateQueueStatus {
  pending: number;
  processing: boolean;
  current: { jobId: string; name?: string; pppoeIdx?: number; enable: boolean } | null;
  queueSize: number;
}

export interface WanCreateEnqueueResult {
  accepted: boolean;
  queued: boolean;
  jobId: string;
  position: number;
  queueSize: number;
}

class WanCreateQueue {
  private queue: WanCreateJob[] = [];
  private processing = false;
  private current: WanCreateJob | null = null;
  private currentName: string | undefined;
  private currentIdx: number | undefined;

  getStatus(): WanCreateQueueStatus {
    return {
      pending: this.queue.length,
      processing: this.processing,
      current: this.current
        ? {
          jobId: this.current.id,
          enable: this.current.enable,
          name: this.currentName,
          pppoeIdx: this.currentIdx,
        }
        : null,
      queueSize: this.queue.length + (this.processing ? 1 : 0),
    };
  }

  private broadcastQueue(): void {
    realtimeHub.broadcast({ type: 'wan.create.queue', payload: this.getStatus() });
  }

  enqueue(
    job: Omit<WanCreateJob, 'id' | 'enqueuedAt'>,
  ): WanCreateEnqueueResult {
    const entry: WanCreateJob = {
      ...job,
      id: randomUUID(),
      enqueuedAt: Date.now(),
    };
    this.queue.push(entry);
    const position = this.queue.length + (this.processing ? 1 : 0);
    const queueSize = position;

    realtimeHub.broadcast({
      type: 'wan.create.queued',
      payload: { jobId: entry.id, position, enable: entry.enable, queueSize },
    });
    this.broadcastQueue();
    void this.drain();

    return {
      accepted: true,
      queued: true,
      jobId: entry.id,
      position,
      queueSize,
    };
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    const job = this.queue.shift();
    if (!job) return;

    this.processing = true;
    this.current = job;
    this.currentName = undefined;
    this.currentIdx = undefined;
    this.broadcastQueue();

    realtimeHub.broadcast({
      type: 'wan.create.processing',
      payload: { jobId: job.id, enable: job.enable, pending: this.queue.length },
    });

    const mik = getMikrotikService();
    const maxIdx = config.hub.maxPppoeOut;

    try {
      const created = await mik.createPppoeOut(job.preferredIdx, maxIdx);
      this.currentName = created.name;
      this.currentIdx = created.index;

      realtimeHub.broadcast({
        type: 'wan.created',
        payload: {
          pppoeIdx: created.index,
          name: created.name,
          created: created.created,
          jobId: job.id,
        },
      });

      realtimeHub.broadcast({
        type: 'wan.create.processing',
        payload: {
          jobId: job.id,
          name: created.name,
          pppoeIdx: created.index,
          enable: job.enable,
          pending: this.queue.length,
        },
      });

      if (job.enable || job.createProxy) {
        const enableResult = await enablePppoeAndApply(
          created.index,
          job.userId,
          job.username,
          job.ip,
          { justCreated: created.created },
        );
        if (enableResult.error) {
          throw new Error(enableResult.error);
        }
      }

      await audit({
        userId: job.userId,
        username: job.username,
        action: 'wan-create',
        resource: 'wan',
        resourceId: created.index,
        ip: job.ip,
        details: { ...created, queued: true, jobId: job.id, enable: job.enable },
      });

      realtimeHub.broadcast({
        type: 'wan.create.done',
        payload: {
          jobId: job.id,
          index: created.index,
          name: created.name,
          created: created.created,
          enable: job.enable,
        },
      });
    } catch (e: any) {
      const error = e.message?.slice(0, 200) || 'Unknown error';
      logger.warn({ err: error, jobId: job.id }, 'WanCreateQueue job failed');
      realtimeHub.broadcast({
        type: 'wan.create.error',
        payload: { jobId: job.id, error },
      });
    } finally {
      this.processing = false;
      this.current = null;
      this.currentName = undefined;
      this.currentIdx = undefined;
      this.broadcastQueue();
      void this.drain();
    }
  }
}

export const wanCreateQueue = new WanCreateQueue();