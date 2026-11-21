type Statement = { sql?: unknown };
type PipelineRequest = { type?: unknown; stmt?: Statement; batch?: { steps?: { stmt?: Statement }[] } };

const isRead = (statement: Statement | undefined) => typeof statement?.sql === 'string' && /^\s*select\b/i.test(statement.sql);

// A timed-out SELECT outside an interactive transaction changed nothing, so it is safe to send again. Anything else may have committed, and a baton ties the exchange to a transaction that a second attempt cannot rejoin.
export function isRetryableRead(body: string): boolean {
  let pipeline: unknown;
  try { pipeline = JSON.parse(body); } catch { return false; }
  if (!pipeline || typeof pipeline !== 'object' || !('requests' in pipeline) || !Array.isArray(pipeline.requests)) return false;
  if ('baton' in pipeline && pipeline.baton != null) return false;
  const requests: PipelineRequest[] = pipeline.requests;
  return requests.some((request) => request.type !== 'close') && requests.every((request) => request.type === 'close'
    || (request.type === 'execute' && isRead(request.stmt))
    || (request.type === 'batch' && Array.isArray(request.batch?.steps) && request.batch.steps.length > 0 && request.batch.steps.every((step) => isRead(step.stmt))));
}
