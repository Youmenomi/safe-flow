import {
  __debug_token_creators,
  __debug_creator_processes,
  __debug_get_curr_thread,
  FlowResult,
} from '../src';

let currTime = 0;
setInterval(() => {
  ++currTime;
}, 1);

export function timeout(func: Function, t: number) {
  if (t === 0) {
    func();
    return;
  }
  const goal = currTime + t;
  const id = setInterval(() => {
    if (currTime === goal) {
      clearInterval(id);
      func();
    }
  }, 1);
}

export function delay(t: number) {
  return new Promise<void>((resolve) => {
    if (t === 0) {
      resolve();
      return;
    }
    const goal = currTime + t;
    const id = setInterval(() => {
      if (currTime >= goal) {
        clearInterval(id);
        resolve();
      }
    }, 1);
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

export function simplify(results: (FlowResult | void)[]) {
  return results.map((arr) => {
    return arr ? arr.length : 0;
  });
}
export enum FR {
  canceled = 1,
  fulfilled,
}

export function errfSimplify(
  results: (FlowResult<any, any, any[], true> | void)[]
) {
  return results.map((arr) => {
    return arr ? arr.length : 0;
  });
}
export enum EFR {
  error = 1,
  canceled,
  fulfilled,
}

export function verify(currThread = true) {
  expect(__debug_creator_processes.size).toBe(0);
  expect(__debug_token_creators.size).toBe(0);
  if (currThread) expect(__debug_get_curr_thread()).toBeUndefined();
}
