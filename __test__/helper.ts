import {
  FlowResult,
  SafeFlowResult,
  __debug_runMap,
  __debug_get_running,
  __debug_tokenMap,
} from '../src';

export function delay(t: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, t);
  });
}

export async function fetch<T = any>(r: T, t = 10): Promise<T> {
  await delay(t);
  return r;
}

export async function error(t = 10) {
  await delay(t);
  throw new Error('Error occurred!');
}

export function checkType<T>(value: T) {
  value;
}

export function simplify(results: FlowResult[]) {
  return results.map((arr) => {
    return arr.length;
  });
}
export function safeSimplify(results: (SafeFlowResult | void)[]) {
  return results.map((arr) => {
    return arr ? arr.length : 0;
  });
}

export function verify() {
  expect(__debug_tokenMap.size).toBe(0);
  expect(__debug_runMap.size).toBe(0);
  expect(__debug_get_running()).toBeUndefined();
}

export enum FR {
  none,
  canceled = 1,
  fulfilled,
}
export enum SFR {
  none,
  error,
  canceled,
  fulfilled,
}
