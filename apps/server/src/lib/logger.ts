// Minimal structured logger utilities for server-side usage
// These helpers avoid TypeScript errors when importing from './logger'

type LogContext = Record<string, any> | undefined;

export function logQueryError(message: string, error: any, context?: LogContext) {
  const payload = {
    level: 'error',
    message,
    error: normalizeError(error),
    ...(context ? { context } : {})
  };
  try {
    // Prefer console.error for visibility during development
    console.error(JSON.stringify(payload));
  } catch {
    // Fallback safe logging
    console.error('[logQueryError]', message, error, context);
  }
}

export function logValidationFailure(message: string, details: any, context?: LogContext) {
  const payload = {
    level: 'warn',
    message,
    details,
    ...(context ? { context } : {})
  };
  try {
    console.warn(JSON.stringify(payload));
  } catch {
    console.warn('[logValidationFailure]', message, details, context);
  }
}

function normalizeError(err: any) {
  if (!err) return null;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (typeof err === 'object') return err;
  return { message: String(err) };
}