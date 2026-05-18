type Level = 'debug' | 'info' | 'warn' | 'error';
type Ctx = Record<string, unknown>;

const isProd = process.env.NODE_ENV === 'production';

function emit(level: Level, msg: string, ctx?: Ctx) {
  const entry = { level, time: new Date().toISOString(), msg, ...(ctx || {}) };
  const line = isProd
    ? JSON.stringify(entry)
    : `[${level.toUpperCase()}] ${msg}${ctx && Object.keys(ctx).length > 0 ? ' ' + JSON.stringify(ctx) : ''}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, ctx?: Ctx): void;
  info(msg: string, ctx?: Ctx): void;
  warn(msg: string, ctx?: Ctx): void;
  error(msg: string, ctx?: Ctx): void;
  child(base: Ctx): Logger;
}

function makeLogger(base: Ctx = {}): Logger {
  return {
    debug: (msg, ctx) => emit('debug', msg, { ...base, ...(ctx || {}) }),
    info: (msg, ctx) => emit('info', msg, { ...base, ...(ctx || {}) }),
    warn: (msg, ctx) => emit('warn', msg, { ...base, ...(ctx || {}) }),
    error: (msg, ctx) => emit('error', msg, { ...base, ...(ctx || {}) }),
    child: (childBase) => makeLogger({ ...base, ...childBase }),
  };
}

export const logger = makeLogger();
