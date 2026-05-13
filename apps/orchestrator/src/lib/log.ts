import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'faka-orchestrator', phase: 1 },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
