import { defaults } from 'custom-defaults';
import { safeCall, safeAwait, SafeCatched } from 'safe-catched';
import { isGeneratorFunction, Dictionary, RequiredPick } from './helper';

export type FlowOptions = {
  token?: any;
  trace?: boolean | Trace;
  name?: string;
  standalone?: boolean;
};

export type FlowupOptions = {
  token?: any;
  names?: { [key: string]: string | true };
} & Config;

export type FlowResult<T = any> = [Canceled] | [null, T];

export type SafeFlowResult<T = any> =
  | [unknown]
  | [null, Canceled]
  | [null, null, T];

export type SafeFlowRun<
  TReturn = FlowResult,
  TParam extends Array<any> = any[]
> = (this: any, ...args: TParam) => Promise<TReturn>;

type OnCancel = (reason: any) => any;
type State = {
  canceled: boolean;
  token: any;
  on: OnCancel[];
};

export class Canceled {
  constructor(
    public run: SafeFlowRun,
    public thisArg: any,
    public args: any,
    public reason: any
  ) {}
  async retry() {
    return this.run.apply(this.thisArg, this.args);
  }
}

export type Filter = (name: string) => boolean;
type Config = {
  trace?: boolean | Trace;
  standalone?: boolean;
  filter?: Filter;
};
const defConfig: Required<Config> = {
  trace: false,
  standalone: false,
  filter: () => true,
} as const;
let config: Required<Config> = defConfig;
export function configure(options?: Config) {
  if (options) config = defaults(options, config);
  else config = defConfig;
}

const tokenMap = new Map<any, SafeFlowRun[]>();
const runMap = new Map<SafeFlowRun, State>();
let running: OnCancel | undefined;

export const __debug_tokenMap = tokenMap;
export const __debug_runMap = runMap;
export function __debug_get_running() {
  return running;
}
let __debug_id: string | undefined;
export function __debug_set_id(id?: string) {
  __debug_id = id;
}

export enum FlowState {
  created,
  start,
  canceled,
  error,
  awaitStart,
  awaitEnded,
  completed,
}

export type TraceEvent =
  | {
      name: string;
      state: FlowState.created;
    }
  | {
      name: string;
      id: string | null;
      state: FlowState.canceled;
      reason?: any;
    }
  | {
      name: string;
      id: string | null;
      state: FlowState.error;
      error: unknown;
    }
  | {
      name: string;
      id: string | null;
      state: FlowState.awaitEnded;
      canceled?: boolean;
      error?: unknown;
      return?: unknown;
    }
  | {
      name: string;
      id: string | null;
      state: FlowState.completed;
      return: unknown;
    }
  | {
      name: string;
      id: string | null;
      state: FlowState.start | FlowState.awaitStart;
    };

export type Trace = (event: TraceEvent) => void;

const defTrace: Trace = (event) => {
  const { name, state } = event;
  let status = 'none';
  if (event.state === FlowState.canceled) {
    status =
      'canceled' + (event.reason === undefined ? '' : ` ${event.reason}`);
  } else if (event.state === FlowState.error) {
    status = 'error' + ` ${event.error}`;
  } else if (event.state === FlowState.awaitEnded) {
    status =
      'await-ended' +
      (event.return ? ` ${event.return}` : '') +
      (event.canceled ? ' (canceled)' : event.error ? ' (error)' : '');
  } else if (event.state === FlowState.completed) {
    status = 'completed' + (event.return ? ` ${event.return}` : '');
  } else {
    switch (state) {
      case FlowState.created:
        status = 'created';
        break;
      case FlowState.start:
        status = 'start';
        break;
      case FlowState.awaitStart:
        status = 'await-start';
        break;
    }
  }

  console.log(
    `[safe-flow] [${name}]${
      event.state === FlowState.created ? '' : event.id ? `(${event.id})` : ''
    }: ` + status
  );
};

function tracing(trace: true | Trace, event: TraceEvent) {
  if (trace === true) {
    defTrace(event);
  } else {
    trace(event);
  }
}

export function flow<
  TReturn = any,
  T extends (...args: any[]) => Generator = (
    ...args: any[]
  ) => Generator<unknown, TReturn, unknown>
>(
  generatorFunc: T & ((...args: any) => Generator<any, TReturn, any>),
  options?: FlowOptions
): SafeFlowRun<FlowResult<TReturn>, Parameters<T>> {
  if (!isGeneratorFunction(generatorFunc)) {
    throw new Error(
      '[safe-flow] The target method is not a GeneratorFunction.'
    );
  }

  const opts = defaults(options, config);
  let { token } = opts;
  const { trace, name, standalone } = opts;
  if (trace && name) tracing(trace, { name, state: FlowState.created });

  return async function safe_flow_run(this: any, ...args: any[]) {
    const id = trace && !standalone && name ? uid() : null;
    if (trace && name) tracing(trace, { name, id, state: FlowState.start });

    token === undefined && (token = this);
    !tokenMap.has(token) && tokenMap.set(token, []);
    //Expected warning. Through the above code, the following variable "runs" will get an array.
    const runs = tokenMap.get(token)!;
    if (!runs.includes(safe_flow_run)) {
      runs.push(safe_flow_run);
    } else if (standalone) {
      const error = new Error(
        '[safe-flow] Standalone mode only allows one flow to run alone.'
      );
      if (trace && name)
        tracing(trace, { name, id, state: FlowState.error, error });
      throw error;
    }

    !runMap.has(safe_flow_run) &&
      runMap.set(safe_flow_run, { canceled: false, token, on: [] });
    //Expected warning. Through the above code, the following variable "state" will get the value anyway.
    const state = runMap.get(safe_flow_run)!;

    //The variable "onCanceled" is definitely used after being assigned.
    let onCanceled!: OnCancel;
    return await Promise.race<any>([
      new Promise((resolve) => {
        const cb: OnCancel = (reason) => {
          if (trace && name)
            tracing(trace, {
              name,
              id,
              state: FlowState.canceled,
              reason,
            });
          resolve([new Canceled(safe_flow_run, this, args, reason)]);
        };
        state.on.push(cb);
        onCanceled = cb;
      }),
      (async () => {
        const result = generatorFunc.apply(this, args);
        running = onCanceled;
        let [catched, next] = safeCall(result, result.next);
        running = undefined;
        if (state.canceled) return;
        if (catched) {
          if (trace && name)
            tracing(trace, {
              name,
              id,
              state: FlowState.error,
              error: catched.error,
            });
          dropout(state, safe_flow_run, runs, onCanceled);
          throw catched.error;
        }
        //Expected warning. When the variable "catched" does not exist, the variable "next" below must exist.
        let { done, value } = next!;
        while (!done) {
          if (value instanceof Promise) {
            if (trace && name)
              tracing(trace, { name, id, state: FlowState.awaitStart });
            [catched, value] = await safeAwait(value);
            if (trace && name) {
              if (state.canceled) {
                tracing(trace, {
                  name,
                  id,
                  state: FlowState.awaitEnded,
                  canceled: state.canceled,
                  return: value,
                });
              } else if (catched) {
                tracing(trace, {
                  name,
                  id,
                  state: FlowState.awaitEnded,
                  error: catched.error,
                });
              } else {
                tracing(trace, {
                  name,
                  id,
                  state: FlowState.awaitEnded,
                  return: value,
                });
              }
            }
            if (state.canceled) return;
            if (catched) {
              [catched, next] = safeCall(result, result.throw, catched.error);
              if (catched) {
                if (trace && name)
                  tracing(trace, {
                    name,
                    id,
                    state: FlowState.error,
                    error: catched.error,
                  });
                dropout(state, safe_flow_run, runs, onCanceled);
                throw catched.error;
              }
              //Expected warning. When the variable "catched" does not exist, the variable "next" below must exist.
              value = next!.value;
              if (next!.done) break;
            }
          }
          running = onCanceled;
          [catched, next] = safeCall(result, result.next, value);
          running = undefined;
          if (state.canceled) return;
          if (catched) {
            if (trace && name)
              tracing(trace, {
                name,
                id,
                state: FlowState.error,
                error: catched.error,
              });
            dropout(state, safe_flow_run, runs, onCanceled);
            throw catched.error;
          }
          //Expected warning. When the variable "catched" does not exist, the variable "next" below must exist.
          done = next!.done;
          value = next!.value;
        }

        if (trace && name)
          tracing(trace, {
            name,
            id,
            state: FlowState.completed,
            return: value,
          });
        dropout(state, safe_flow_run, runs, onCanceled);
        return [null, value];
      })(),
    ]);
  };
}

function dropout(
  state: State,
  safe_flow_run: SafeFlowRun,
  runs: SafeFlowRun[],
  onCanceled: OnCancel
) {
  state.on.splice(state.on.indexOf(onCanceled), 1);
  if (state.on.length === 0) {
    runMap.delete(safe_flow_run);
    const i = runs.indexOf(safe_flow_run);
    runs.splice(i, 1);
    if (runs.length === 0) {
      tokenMap.delete(state.token);
      state.token = undefined;
      //@ts-expect-error
      state.on = undefined;
    }
  }
}

export function cancel(run: SafeFlowRun, reason?: any): void;
export function cancel(token?: any, reason?: any): void;
export function cancel(tokenOrRun: any, reason?: any) {
  internalCancel(tokenOrRun, reason, true);
}

export function cancelAll(reason?: any) {
  let isThrow = false;
  tokenMap.forEach((_run, token) => {
    const matched = internalCancel(token, reason);
    if (!isThrow && matched) isThrow = true;
  });
  if (isThrow) {
    throw '[safe-flow] Stop the flow thread immediately.';
  }
}

function internalCancel(tokenOrRun: any, reason?: any, isThrow = false) {
  let matched = false;
  if (typeof tokenOrRun === 'function' && tokenOrRun.name === 'safe_flow_run') {
    const state = runMap.get(tokenOrRun);
    if (state) {
      const token = state.token;
      state.canceled = true;
      state.token = undefined;
      state.on.forEach((cb) => {
        if (!matched && running === cb) matched = true;
        cb(reason);
      });
      state.on.length = 0;
      //@ts-expect-error
      state.on = undefined;
      runMap.delete(tokenOrRun);
      //Expected warning. When the variable "state" exists, the variable "runs" below must also exist.
      const runs = tokenMap.get(token)!;
      const i = runs.indexOf(tokenOrRun);
      runs.splice(i, 1);
      if (runs.length === 0) {
        tokenMap.delete(token);
      }
    }
  } else {
    const runs = tokenMap.get(tokenOrRun);
    if (runs) {
      runs.forEach((run) => {
        //Expected warning. When the variable "runs" exists, the variable "state" below must also exist.
        const state = runMap.get(run)!;
        state.canceled = true;
        state.token = undefined;
        state.on.forEach((cb) => {
          if (!matched && running === cb) matched = true;
          cb(reason);
        });
        state.on.length = 0;
        //@ts-expect-error
        state.on = undefined;
        runMap.delete(run);
      });
      tokenMap.delete(tokenOrRun);
    }
  }
  if (isThrow && matched) {
    throw '[safe-flow] Stop the flow thread immediately.';
  }
  return matched;
}

export function flowed<
  TReturn = any,
  T extends (...args: any[]) => Generator = (
    ...args: any[]
  ) => Generator<unknown, TReturn, unknown>
>(
  generatorFunc: T & ((...args: any) => Generator<unknown, TReturn, unknown>)
): (...args: Parameters<T>) => Promise<FlowResult<TReturn>> {
  return generatorFunc as any;
}

export function flowup<T = any>(value: T, options?: FlowupOptions) {
  const opts = defaults(options, config);
  const target: Dictionary = value;

  if (options && options.names) {
    const propKeys: string[] = [];
    Object.getOwnPropertyNames(Object.getPrototypeOf(target)).forEach(
      (propertyKey) => {
        propKeys.push(propertyKey);
      }
    );
    Object.getOwnPropertyNames(value).forEach((propertyKey) => {
      propKeys.push(propertyKey);
    });
    Object.keys(options.names).forEach((name) => {
      if (!propKeys.includes(name))
        throw new Error(
          `[safe-flow] The attribute "${name}" provided in the names option does not exist on the target to be flowed up.`
        );
    });
  }

  Object.getOwnPropertyNames(Object.getPrototypeOf(target)).forEach(
    (propertyKey) => {
      internalFlowup(target, propertyKey, opts);
    }
  );
  Object.getOwnPropertyNames(value).forEach((propertyKey) => {
    internalFlowup(target, propertyKey, opts);
  });
  return value;
}

function internalFlowup(
  target: any,
  propertyKey: string,
  options: RequiredPick<FlowupOptions, 'filter'>
) {
  const flowable = target[propertyKey].__safe_flow_flowable;
  const filter = options.filter;
  if (!flowable && !filter(propertyKey)) return;

  const { names, token, trace, standalone } = options;
  let name: string | undefined;
  if (trace && names) {
    const prop = names[propertyKey];
    if (prop === true) {
      name = propertyKey;
    } else if (prop) {
      name = prop;
    }
  }
  const flowOpts = {
    token,
    trace,
    name,
    standalone,
  };

  if (flowable) {
    target[propertyKey] = flow(
      target[propertyKey],
      flowable === true ? flowOpts : defaults(flowable, flowOpts)
    ).bind(target);
  } else {
    if (isGeneratorFunction(target[propertyKey]))
      target[propertyKey] = flow(target[propertyKey], flowOpts).bind(target);
  }
}

export function flowable(
  options: FlowOptions
): (
  target: any,
  propertyKey: string,
  descriptor?: PropertyDescriptor //The ? mark for ES3
) => void;
export function flowable(
  target: any,
  propertyKey: string,
  descriptor?: PropertyDescriptor //The ? mark for ES3
): void;
export function flowable(
  targetOrOptions: any,
  propertyKey?: string,
  descriptor?: PropertyDescriptor //The ? mark for ES3
) {
  if (propertyKey) {
    internalFlowable(targetOrOptions, propertyKey, descriptor);
  } else {
    return (
      target: any,
      propertyKey: string,
      descriptor?: PropertyDescriptor //The ? mark for ES3
    ) => {
      let generatorFunc: GeneratorFunction;
      if (descriptor) {
        generatorFunc = descriptor.value;
      } else {
        generatorFunc = target[propertyKey];
      }
      if (!isGeneratorFunction(generatorFunc)) {
        throw new Error('[safe-flow] Only GeneratorFunction can be flowable.');
      }
      //@ts-expect-error
      generatorFunc.__safe_flow_flowable = targetOrOptions;
    };
  }
}

function internalFlowable(
  target: any,
  propertyKey: string,
  descriptor?: PropertyDescriptor //The ? mark for ES3
) {
  let generatorFunc: GeneratorFunction;
  if (descriptor) {
    generatorFunc = descriptor.value;
  } else {
    generatorFunc = target[propertyKey];
  }
  if (!isGeneratorFunction(generatorFunc)) {
    throw new Error('[safe-flow] Only GeneratorFunction can be flowable.');
  }
  //@ts-expect-error
  generatorFunc.__safe_flow_flowable = true;
}

export function safeFlow<T>(
  flow: ReturnType<SafeFlowRun<FlowResult<T>>>
): Promise<SafeFlowResult<T>> {
  return flow
    .then(([canceled, data]) => {
      if (canceled === null) return [null, null, data] as [null, null, T];
      return [null, canceled] as [null, Canceled];
    })
    .catch((error) => {
      return [new SafeCatched(error)] as [SafeCatched];
    });
}

function uid() {
  if (__debug_id) return __debug_id;
  return Math.floor(Math.random() * 100000000).toString();
}
