import { randomUUID } from 'node:crypto';

export interface IdProvider {
  next(prefix: string): string;
}

// Deterministic, for tests and for anything compared exactly, such as artifacts.
export function createSequentialIds(): IdProvider {
  let counter = 0;

  return {
    next: (prefix) => {
      counter += 1;
      return `${prefix}_${String(counter).padStart(6, '0')}`;
    },
  };
}

export const systemIds: IdProvider = {
  next: (prefix) => `${prefix}_${randomUUID()}`,
};
