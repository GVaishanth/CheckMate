import { assessMate } from '../education/mate';
import type { MateRequest } from '../education/mate';

self.onmessage = (event: MessageEvent<MateRequest & { id: number }>) => {
  const { id, ...request } = event.data;
  self.postMessage({ id, ...assessMate(request) });
};
