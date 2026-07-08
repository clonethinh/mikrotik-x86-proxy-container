// Pino logger setup
import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  transport: config.env === 'development' ? {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
  } : undefined,
  redact: {
    paths: ['password', 'pass', 'token', '*.password', '*.pass', '*.token', 'MIKROTIK_API_PASS', 'MIKROTIK_SSH_PASS'],
    censor: '[REDACTED]',
  },
});