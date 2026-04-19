// Lightweight logger using Node built-ins only
const SILENT = process.env.NODE_ENV === 'test' && process.env.LOG_TESTS !== 'true';
const level = process.env.LOG_LEVEL ?? 'info';
const levels: Record<string,number> = { debug:0, info:1, warn:2, error:3 };
const currentLevel = levels[level] ?? 1;

function log(lvl: string, msg: string, meta?: Record<string,unknown>) {
  if (SILENT || (levels[lvl] ?? 0) < currentLevel) return;
  const ts = new Date().toISOString();
  const m = meta ? ' ' + JSON.stringify(meta) : '';
  process.stderr.write(`${ts} [${lvl.toUpperCase()}] ${msg}${m}\n`);
}

export const logger = {
  debug: (msg: string, meta?: Record<string,unknown>) => log('debug', msg, meta),
  info:  (msg: string, meta?: Record<string,unknown>) => log('info',  msg, meta),
  warn:  (msg: string, meta?: Record<string,unknown>) => log('warn',  msg, meta),
  error: (msg: string, meta?: Record<string,unknown>) => log('error', msg, meta),
  child: (ctx: Record<string,unknown>) => ({
    debug: (msg: string, meta?: Record<string,unknown>) => log('debug', msg, { ...ctx, ...meta }),
    info:  (msg: string, meta?: Record<string,unknown>) => log('info',  msg, { ...ctx, ...meta }),
    warn:  (msg: string, meta?: Record<string,unknown>) => log('warn',  msg, { ...ctx, ...meta }),
    error: (msg: string, meta?: Record<string,unknown>) => log('error', msg, { ...ctx, ...meta }),
  }),
};
export const childLogger = (ctx: Record<string,unknown>) => logger.child(ctx);
