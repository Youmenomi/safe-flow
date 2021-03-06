import { IActionRunInfo, isAction, _startAction, _endAction } from 'mobx';
import {
  __debug_token_creators,
  __debug_creator_processes,
  __debug_get_curr_thread,
  FlowResult,
  Thread,
  TraceState,
  Plugin,
  flowup,
  FlowupOptions,
  flow,
  FlowOptions,
  SafeFlowCreator,
  __debug_in_thread,
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

export async function response<T = any>(r: T, t = 10): Promise<T> {
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
  expect(__debug_in_thread()).toBeFalsy();
}

class MobxPlugin implements Plugin {
  currInfo: IActionRunInfo | undefined = undefined;
  onState(state: TraceState, thread: Thread) {
    const { parent, name, func } = thread;
    if (state === TraceState.thread_starting) {
      this.endAction();
      if (!isAction(func)) {
        this.currInfo = _startAction(name ? name : 'unknow', false, undefined);
      }
    } else if (state === TraceState.thread_idle) {
      if (!isAction(func)) {
        this.endAction();
      }
    } else if (state === TraceState.thread_completed) {
      this.endAction();
      if (parent && !parent.hasChildren) {
        const { name } = parent;
        this.currInfo = this.startAction(
          name ? name : 'unknow',
          false,
          undefined
        );
      }
    }
  }
  startAction(...args: Parameters<typeof _startAction>) {
    return _startAction(...args);
  }
  endAction() {
    if (this.currInfo) {
      _endAction(this.currInfo);
      this.currInfo = undefined;
    }
  }
}
const plugin = new MobxPlugin();

export function xflowup<T = any>(target: T, options?: FlowupOptions) {
  if (options) {
    options.plugins = options.plugins
      ? [plugin as Plugin].concat(options.plugins)
      : [plugin];
  } else {
    options = { plugins: [plugin] };
  }
  return flowup(target, options);
}

export function xflow<TReturn = any, TParam extends any[] = any>(
  func: (...args: TParam) => Promise<TReturn>,
  options?: FlowOptions
): SafeFlowCreator<TReturn, ThisParameterType<typeof func>, TParam> {
  if (options) {
    options.plugins = options.plugins
      ? [plugin as Plugin].concat(options.plugins)
      : [plugin];
  } else {
    options = { plugins: [plugin] };
  }
  return flow(func, options);
}
