import { defaults } from 'custom-defaults';
import { safeAwait, CatchFirst } from 'catch-first';
import { RequiredPick } from './helper';

export type Plugin = { onState: StateHandler };
class Plugins {
  plugins: (Plugin | undefined)[] = [];
  onState(state: TraceState, thread: Thread) {
    this.plugins.forEach((plugin) => {
      if (plugin) plugin.onState(state, thread);
    });
  }
  add(plugin: Plugin) {
    const i = this.plugins.indexOf(plugin);
    if (i < 0) this.plugins.push(plugin);
    else throw new Error('[safe-flow] This plugin has been added.');
  }
  remove(plugin: Plugin) {
    const i = this.plugins.indexOf(plugin);
    if (i >= 0) this.plugins[i] = undefined;
    else throw new Error('[safe-flow] Cannot remove unadded plugin.');
  }
}
export const plugins = new Plugins();

export type FlowOptions = {
  name?: string;
} & Omit<FlowupOptions, 'filter' | 'names'>;

export type FlowupOptions = {
  token?: any;
  names?: { [key: string]: true | FlowOptions };
  plugins?: Plugin[];
} & Config;

export type FlowResult<
  TReturn = any,
  TThis = any,
  TParam extends any[] = any[],
  TErrf extends boolean = false
> = TErrf extends false
  ? [Canceled<TReturn, TThis, TParam>] | [null, TReturn]
  :
      | [unknown]
      | [null, Canceled<TReturn, TThis, TParam>]
      | [null, null, TReturn];

export type SafeFlowCreator<
  TReturn = any,
  TThis = any,
  TParam extends any[] = any,
  TErrf extends boolean = false,
  TOnCancel extends boolean = false
> = (
  ...args: TParam
) => Promise<FlowResult<TReturn, TThis, TParam, TErrf>> &
  (TErrf extends false
    ? TOnCancel extends false
      ? {
          safe_flow_promise: true;
          canceled: () => boolean;
          cancel: (reason?: any) => void;
          state: () => PromiseState;
          errf: () => ReturnType<SafeFlowCreator<TReturn, TThis, TParam, true>>;
          onCancel: (
            handler: CancelHandler
          ) => ReturnType<SafeFlowCreator<TReturn, TThis, TParam, false, true>>;
        }
      : {
          safe_flow_promise: true;
          canceled: () => boolean;
          cancel: (reason?: any) => void;
          state: () => PromiseState;
          errf: () => ReturnType<
            SafeFlowCreator<TReturn, TThis, TParam, true, true>
          >;
        }
    : TOnCancel extends false
    ? {
        safe_flow_promise: true;
        canceled: () => boolean;
        cancel: (reason?: any) => void;
        state: () => PromiseState;
        onCancel: (
          handler: CancelHandler
        ) => ReturnType<SafeFlowCreator<TReturn, TThis, TParam, true, true>>;
      }
    : {
        safe_flow_promise: true;
        canceled: () => boolean;
        cancel: (reason?: any) => void;
        state: () => PromiseState;
      });

type Canceler = (reason: any, isThrow?: boolean, batching?: boolean) => any;

/* istanbul ignore next */
function report() {
  return new Error('[safe-flow] Please report this bug to the author.');
}

const outOfControlMsg =
  '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.';
function outOfControl() {
  return new Error(outOfControlMsg);
}

export enum FlowState {
  canceled = 1,
  done,
}

export enum ErrfState {
  error = 1,
  canceled,
  done,
}

export enum PromiseState {
  pending,
  fulfilled,
  rejected,
  canceled,
}

type CancelHandler = (reason: any) => any;

export class Thread {
  promiseState: PromiseState = PromiseState.pending;
  canceled = false;
  state?: TraceState;
  canceler?: Canceler;
  cancellation?: Canceled;
  children: Thread[] = [];

  get hasChildren() {
    return Boolean(this.children.length);
  }

  _completed = false;
  get completed() {
    return this._completed;
  }

  _disposed = false;
  get disposed() {
    return this._disposed;
  }

  _level = -1;
  // get level() {
  //   return this._level;
  // }
  levelup() {
    this._level++;
  }

  constructor(
    public func: Function,
    public creator: SafeFlowCreator,
    public parent: Thread | undefined,
    public token: any,
    public trace: boolean | Trace,
    public name?: string,
    public id?: number,
    public onState?: StateHandler,
    public plugins?: Plugin[]
  ) {
    this.levelup();
    if (__debug_enable_value) __debug_live_threads.push(this);
  }

  changeState(state: TraceState.thread_start): void;
  changeState(state: TraceState.thread_idle): void;
  changeState(state: TraceState.thread_canceled, reason: unknown): void;
  changeState(state: TraceState.thread_error, error: unknown): void;
  changeState(state: TraceState.thread_done, value: unknown): void;
  changeState(state: TraceState.thread_completed): void;
  changeState(state: TraceState.thread_done_canceled, value: unknown): void;
  changeState(state: TraceState.thread_disposed): void;
  changeState(state: TraceState, ...args: any) {
    this.state = state;
    if (state === TraceState.thread_canceled) {
      this.promiseState = PromiseState.canceled;
    } else if (state === TraceState.thread_completed) {
      this.promiseState = PromiseState.fulfilled;
    } else if (state === TraceState.thread_error) {
      this.promiseState = PromiseState.rejected;
    }

    plugins.onState(state, this);
    if (this.plugins)
      this.plugins.forEach((plugin) => {
        plugin.onState(state, this);
      });
    if (this.onState) this.onState(state, this);

    if (this.trace && this.name) {
      /* istanbul ignore else */
      if (
        state === TraceState.thread_start ||
        state === TraceState.thread_idle ||
        state === TraceState.thread_completed ||
        state === TraceState.thread_disposed
      ) {
        tracing(this.trace, { state, name: this.name, id: this.id });
      } else if (state === TraceState.thread_canceled) {
        tracing(this.trace, {
          state,
          name: this.name,
          id: this.id,
          reason: args[0],
        });
      } else if (state === TraceState.thread_error) {
        tracing(this.trace, {
          state,
          name: this.name,
          id: this.id,
          error: args[0],
        });
      } else if (state === TraceState.thread_done) {
        tracing(this.trace, {
          state,
          name: this.name,
          id: this.id,
          value: args[0],
        });
      } else if (state === TraceState.thread_done_canceled) {
        tracing(this.trace, {
          state,
          name: this.name,
          id: this.id,
          value: args[0],
        });
      } else {
        throw report();
      }
    }
  }

  addChild(thread: Thread) {
    this.children.push(thread);
  }

  removeChild(thread: Thread) {
    this.children.splice(this.children.indexOf(thread), 1);
  }

  complete(dispose = true) {
    /* istanbul ignore next */
    if (this.completed) throw report();

    this._completed = true;
    this.changeState(TraceState.thread_completed);
    if (this.parent && !this.parent.hasChildren) {
      this.parent.levelup();
    }

    //@ts-expect-error
    this.func = undefined;
    //@ts-expect-error
    this.creator = undefined;
    this.parent = undefined;
    this.token = undefined;
    this.canceler = undefined;
    this.cancellation = undefined;
    this.onState = undefined;

    this.children.length = 0;
    //@ts-expect-error
    this.children = undefined;

    if (dispose) this.dispose();
  }

  dispose() {
    /* istanbul ignore next */
    if (!this.completed || this.disposed) throw report();

    this._disposed = true;
    this.changeState(TraceState.thread_disposed);

    //@ts-expect-error
    this.trace = undefined;

    if (__debug_enable_value) {
      __debug_live_threads.splice(__debug_live_threads.indexOf(this), 1);
    }
  }
}

export class Canceled<TReturn = any, TThis = any, TParam extends any[] = any> {
  constructor(
    public creator: SafeFlowCreator<TReturn, TThis, TParam>,
    public thisArg: TThis,
    public args: TParam,
    public reason: any
  ) {}
  retry() {
    return this.creator.apply(this.thisArg, this.args);
  }
}

export type Filter = (name: string) => boolean;
export type StateHandler = (state: TraceState, thread: Thread) => any;
type Config = {
  trace?: boolean | Trace;
  standalone?: boolean;
  filter?: Filter;
  onState?: StateHandler;
};

const defConfig: RequiredPick<Config, 'trace' | 'standalone' | 'filter'> = {
  trace: false,
  standalone: false,
  filter: () => false,
} as const;
let config = defConfig;
export function configure(options?: Config) {
  if (options) config = defaults(options, config);
  else config = defConfig;
}

const tokenCreators = new Map<any, SafeFlowCreator[]>();
const creatorProcesses = new Map<SafeFlowCreator, Thread[]>();

let currentThread: Thread | undefined;
function setCurrThread(thread?: Thread) {
  if (__debug_enable_value) {
    if (!thread) {
      logger.log('[safe-flow] Clear the current thread pointer.');
    } else if (thread && thread.name) {
      logger.log(
        `[safe-flow] Change the current thread pointer to [${thread.name}].`
      );
    } else {
      logger.log('[safe-flow] The current thread pointer has changed.');
    }
  }

  currentThread = thread;
}
function getCurrThread() {
  return currentThread;
}

/* istanbul ignore next */
const logger = {
  log: (...args: any[]) => {
    console.log(...args);
  },
};

export const __debug_logger = logger;

export const __debug_token_creators = tokenCreators;
export const __debug_creator_processes = creatorProcesses;
export const __debug_get_curr_thread = getCurrThread;
export function __debug_clear_names() {
  names = {};
}
export function __debug_clear_threads() {
  tokenCreators.clear();
  creatorProcesses.clear();
  __debug_live_threads.forEach((thread) => {
    thread.complete();
  });
  __debug_live_threads.length = 0;
  currentThread = undefined;
}

let __debug_enable_value = false;
export function __debug_enable(value: boolean) {
  __debug_enable_value = value;
}
export const __debug_live_threads: Thread[] = [];

export enum TraceState {
  creator_created,
  thread_start,
  thread_idle,
  thread_canceled,
  thread_error,
  thread_done,
  thread_done_canceled,
  thread_completed,
  thread_disposed,
}

export type TraceEvent =
  | {
      name: string;
      state: TraceState.creator_created;
    }
  | {
      name: string;
      id?: number;
      state: TraceState.thread_canceled;
      reason?: any;
    }
  | {
      name: string;
      id?: number;
      state: TraceState.thread_error;
      error: unknown;
    }
  | {
      name: string;
      id?: number;
      state: TraceState.thread_done;
      value: unknown;
    }
  | {
      name: string;
      id?: number;
      state: TraceState.thread_done_canceled;
      value?: unknown;
    }
  | {
      name: string;
      id?: number;
      state:
        | TraceState.thread_start
        | TraceState.thread_idle
        | TraceState.thread_completed
        | TraceState.thread_disposed;
    };

export type Trace = (event: TraceEvent) => void;

const defTrace: Trace = (event) => {
  const { name, state } = event;
  let status = 'none';
  if (event.state === TraceState.thread_canceled) {
    status =
      'canceled' + (event.reason === undefined ? '' : ` ${event.reason}`);
  } else if (event.state === TraceState.thread_error) {
    status = 'error' + ` ${event.error}`;
  } else if (event.state === TraceState.thread_done) {
    status = 'done' + (event.value ? ` ${event.value}` : '');
  } else if (event.state === TraceState.thread_done_canceled) {
    status = 'done (canceled)' + (event.value ? ` ${event.value}` : '');
  } else {
    switch (state) {
      case TraceState.thread_start:
        status = 'start';
        break;
      case TraceState.thread_idle:
        status = 'idle';
        break;
      case TraceState.thread_completed:
        status = 'completed';
        break;
      case TraceState.thread_disposed:
        status = 'disposed';
        break;
    }
  }

  if (event.state === TraceState.creator_created) {
    status = ' Creator is created.';
  } else {
    /* istanbul ignore if */
    if (!event.id) throw report();
    status = `(${event.id})` + ': ' + status;
  }

  logger.log(`[safe-flow] [${name}]` + status);
};

function tracing(trace: true | Trace, event: TraceEvent) {
  if (trace === true) {
    defTrace(event);
  } else {
    trace(event);
  }
}

const breakMsg =
  '[safe-flow] Do not use try/catch and .catch() on threads. This will cause the parent thread to fail to interrupt when it is cancelled. Use .errf() to receive exceptions instead.';
function getBreakMsg() {
  return breakMsg;
}

export function flow<TReturn = any, TParam extends any[] = any>(
  func: (...args: TParam) => Promise<TReturn>,
  options?: FlowOptions
): SafeFlowCreator<TReturn, ThisParameterType<typeof func>, TParam> {
  if (typeof func !== 'function') {
    throw new ReferenceError('[safe-flow] The func is not a function.');
  }
  return internalFlow(func, options);
}

function internalFlow<TReturn = any, TThis = any, TParam extends any[] = any>(
  func: (...args: TParam) => Promise<TReturn>,
  options?: FlowOptions,
  thisArg?: any
): SafeFlowCreator<TReturn, ThisParameterType<typeof func>, TParam> {
  const opts = defaults(options, config);
  let { token } = opts;
  const { trace, name, standalone, onState, plugins } = opts;
  if (trace && name) {
    registerName(name);
    tracing(trace, { name, state: TraceState.creator_created });
  }

  return function safe_flow_creator(this: TThis, ...args: TParam) {
    const parentThread = getCurrThread();

    const id = trace && !standalone && name ? takeNumber(name) : undefined;

    token === undefined && (token = thisArg);
    let creators = tokenCreators.get(token);
    if (creators) {
      if (!creators.includes(safe_flow_creator)) {
        creators.push(safe_flow_creator);
      } else if (standalone) {
        throw new Error(
          '[safe-flow] Standalone mode flow only allows one process to execute.'
        );
      }
    } else {
      creators = [];
      creators.push(safe_flow_creator);
      tokenCreators.set(token, creators);
    }

    !creatorProcesses.has(safe_flow_creator) &&
      creatorProcesses.set(safe_flow_creator, []);
    const process = creatorProcesses.get(safe_flow_creator);

    /* istanbul ignore if */
    if (!process) throw report();

    const thread = new Thread(
      func,
      safe_flow_creator,
      parentThread,
      token,
      trace,
      name,
      id,
      onState,
      plugins
    );
    process.push(thread);
    thread.changeState(TraceState.thread_start);
    setCurrThread(thread);

    let cancelHandler: undefined | CancelHandler = undefined;
    let errfPromise: undefined | any = undefined;
    const promise = new Promise((resolve, reject) => {
      thread.canceler = (reason, isThrow = false, batching = true) => {
        cancelChildren(thread, reason, true);
        if (parentThread) {
          parentThread.removeChild(thread);
        }

        const { creator, token } = thread;
        const process = creatorProcesses.get(creator);
        const creators = tokenCreators.get(token);
        /* istanbul ignore if */
        if (!process || !creators) throw report();
        if (!batching) dropout(thread, process, creator, creators);

        const cancellation = new Canceled(
          safe_flow_creator,
          thisArg,
          args,
          reason
        );
        thread.cancellation = cancellation;
        thread.canceled = true;
        thread.changeState(TraceState.thread_canceled, reason);
        if (cancelHandler) cancelHandler(reason);

        thread.complete(false);
        setCurrThread(parentThread);

        if (isThrow) reject(getBreakMsg());
        else resolve([cancellation]);
      };

      if (parentThread) parentThread.addChild(thread);
      safeAwait(func.call(thisArg, ...args)).then((result) => {
        if (thread.canceled) {
          thread.changeState(TraceState.thread_done_canceled, result[1]);
          thread.dispose();
          return;
        } else if (parentThread) {
          parentThread.removeChild(thread);
        }

        /* istanbul ignore if */
        if (!creators) throw report();
        /* istanbul ignore else */
        if (result.length === CatchFirst.caught) {
          cancelChildren(
            thread,
            'An error occurred in the parent thread.',
            false
          );
          const [caught] = result;
          thread.changeState(TraceState.thread_error, caught);
          dropout(thread, process, safe_flow_creator, creators);
          thread.complete();
          setCurrThread(parentThread);
          reject(caught);
        } else if (result.length === CatchFirst.done) {
          const [, done] = result;
          thread.changeState(TraceState.thread_done, done);
          dropout(thread, process, safe_flow_creator, creators);
          if (thread.hasChildren) {
            reject(outOfControl());
            return;
          }
          thread.complete();
          setCurrThread(parentThread);
          resolve([null, done]);
        } else {
          throw report();
        }
      });
      if (!thread.canceled) {
        thread.changeState(TraceState.thread_idle);
        setCurrThread(parentThread);
      }
    }) as ReturnType<SafeFlowCreator<TReturn, TThis, TParam>>;

    promise.safe_flow_promise = true;
    promise.cancel = (reason?: any) => {
      if (thread.completed)
        throw new Error(
          '[safe-flow] Unable to cancel a thread that has ended.'
        );

      internalCancelSelf(thread, reason);
    };
    promise.canceled = () => thread.canceled;
    promise.state = () => thread.promiseState;

    promise.onCancel = (handler: (reason: any) => any) => {
      cancelHandler = handler;
      if (errfPromise) {
        errfPromise.onCancel = undefined;
        return errfPromise;
      } else {
        //@ts-expect-error
        promise.onCancel = undefined;
        return promise;
      }
    };

    promise.errf = () => {
      errfPromise = promise
        .then(([canceled, data]) => {
          if (canceled === null)
            return [null, null, data] as [null, null, TReturn];
          return [null, canceled] as [null, Canceled];
        })
        .catch((error: any) => {
          if (error === breakMsg || error.message === outOfControlMsg)
            throw error;
          return [error] as [unknown];
        }) as any;
      errfPromise.safe_flow_promise = true;
      errfPromise.cancel = promise.cancel;
      errfPromise.canceled = promise.canceled;
      errfPromise.state = promise.state;
      errfPromise.onCancel = promise.onCancel;
      //@ts-expect-error
      promise.errf = undefined;
      return errfPromise;
    };

    return promise;
  } as any;
}

export function isSafeFlowPromise(promise: any) {
  return promise.safe_flow_promise === true;
}

export function isCreator(func: Function) {
  return typeof func === 'function' && func.name === 'safe_flow_creator';
}

function cancelChildren(thread: Thread, reason?: any, isThrow?: boolean) {
  const { children } = thread;
  children.concat().forEach((child) => {
    /* istanbul ignore else */
    if (!child.canceled) internalCancelSelf(child, reason, isThrow);
    else throw report();
  });
}

function dropout(
  thread: Thread,
  process: Thread[],
  creator: SafeFlowCreator,
  creators: SafeFlowCreator[]
) {
  process.splice(process.indexOf(thread), 1);
  if (process.length === 0) {
    creatorProcesses.delete(creator);
    creators.splice(creators.indexOf(creator), 1);
    if (creators.length === 0) {
      tokenCreators.delete(thread.token);
    }
  }
}

export function cancel(creator: SafeFlowCreator, reason?: any): void;
export function cancel(token?: any, reason?: any): void;
export function cancel(tokenOrCreator: any, reason?: any) {
  const currThread = getCurrThread();
  if (currThread && currThread.hasChildren) {
    throw outOfControl();
  }
  internalCancel(currThread, tokenOrCreator, reason);
}

export function cancelAll(reason?: any) {
  const currThread = getCurrThread();
  if (currThread && currThread.hasChildren) {
    throw outOfControl();
  }
  tokenCreators.forEach((_creator, token) => {
    internalCancel(currThread, token, reason);
  });
  if (currThread) {
    throw getBreakMsg();
  }
}

function internalCancel(
  currThread: Thread | undefined,
  tokenOrCreator: any,
  reason?: any
) {
  let isThrow = false;
  if (isCreator(tokenOrCreator)) {
    const process = creatorProcesses.get(tokenOrCreator);
    if (process) {
      const token = process[0].token;
      process.forEach((thread) => {
        /* istanbul ignore if */
        if (!thread.canceler) throw report();
        thread.canceler(reason);
        if (thread === currThread) isThrow = true;
      });
      process.length = 0;
      creatorProcesses.delete(tokenOrCreator);

      const creators = tokenCreators.get(token);
      /* istanbul ignore if */
      if (!creators) throw report();

      const i = creators.indexOf(tokenOrCreator);
      creators.splice(i, 1);
      if (creators.length === 0) {
        tokenCreators.delete(token);
      }
    }
  } else {
    const creators = tokenCreators.get(tokenOrCreator);
    if (creators) {
      creators.forEach((creator) => {
        const process = creatorProcesses.get(creator);

        /* istanbul ignore if */
        if (!process) throw report();

        process.forEach((thread) => {
          /* istanbul ignore if */
          if (!thread.canceler) throw report();

          thread.canceler(reason);

          if (thread === currThread) isThrow = true;
        });
        process.length = 0;
        creatorProcesses.delete(creator);
      });
      tokenCreators.delete(tokenOrCreator);
    }
  }
  if (isThrow && currThread) {
    throw getBreakMsg();
  }
}

export function cancelSelf(reason?: any) {
  const currThread = getCurrThread();
  if (currThread) {
    if (currThread.hasChildren) {
      throw outOfControl();
    }
    internalCancelSelf(currThread, reason);
    throw getBreakMsg();
  } else {
    throw new Error(
      '[safe-flow] The cancelSelf method must be invoked in the currently running flow thread. Don not call it in other asynchronous callback.'
    );
  }
}

function internalCancelSelf(thread: Thread, reason?: any, isThrow = false) {
  const { canceler } = thread;
  /* istanbul ignore if */
  if (!canceler) throw report();
  canceler(reason, isThrow, false);
}

export function flowed<TReturn = any, TThis = any, TParam extends any[] = any>(
  func: (this: TThis, ...args: TParam) => Promise<TReturn>
): SafeFlowCreator<TReturn, TThis, TParam> {
  return func as any;
}

export function isFlowupObject(target: any) {
  return target.__safe_flow_flowup === true;
}

export function flowup<T = any>(target: T, options?: FlowupOptions) {
  internalFlowup(target, options);
  return target;
}

export function internalFlowup(target: any, options?: FlowupOptions) {
  if (isFlowupObject(target))
    throw new Error(
      `[safe-flow] flowup can only be used on objects that have not yet flowup.`
    );

  const opts = defaults(options, config);
  const { names } = opts;
  if (names) {
    Object.keys(names).forEach((name) => {
      if (typeof target[name] !== 'function')
        throw new ReferenceError(
          `[safe-flow] The specified attribute "${name}" found through the names option is not a function.`
        );
    });
  }

  Object.getOwnPropertyNames(target).forEach((propertyKey) => {
    flowupProp(target, propertyKey, opts);
  });
  Object.getOwnPropertyNames(Object.getPrototypeOf(target)).forEach(
    (propertyKey) => {
      flowupProp(target, propertyKey, opts);
    }
  );

  target.__safe_flow_flowup = true;
}

function flowupProp(
  target: any,
  propertyKey: string,
  options: RequiredPick<FlowupOptions, 'filter'>
) {
  if (propertyKey === 'constructor') return;

  const isFlowable: undefined | FlowOptions | true =
    target.__safe_flow_flowable && target.__safe_flow_flowable[propertyKey];
  const isFlowup = options.names ? options.names[propertyKey] : undefined;
  if (!isFlowable && !isFlowup) {
    if (options.filter(propertyKey)) {
      if (typeof target[propertyKey] !== 'function') return;
    } else return;
  }

  const { names, token, trace, standalone, plugins } = options;
  let name: string | undefined;
  if (trace && names) {
    /* istanbul ignore else */
    if (isFlowup === true) {
      name = propertyKey;
    } else if (isFlowup) {
      name = isFlowup.name;
    } else {
      throw report();
    }
  }
  const flowOpts = {
    token,
    trace,
    name,
    standalone,
    plugins,
  };

  if (typeof isFlowable === 'object') {
    target[propertyKey] = internalFlow(
      target[propertyKey],
      defaults(isFlowable, flowOpts),
      target
    );
  } else {
    target[propertyKey] = internalFlow(target[propertyKey], flowOpts, target);
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
      internalFlowable(target, propertyKey, descriptor, targetOrOptions);
    };
  }
}

function internalFlowable(
  target: any,
  propertyKey: string,
  descriptor?: PropertyDescriptor, //The ? mark for ES3
  options?: FlowOptions
) {
  let func: Function;
  if (descriptor) {
    func = descriptor.value;
  } else {
    func = target[propertyKey];
  }
  if (typeof func !== 'function') {
    throw new ReferenceError(
      '[safe-flow] Cannot get the target function to be flowed. The "flowable" method decorator may not be used correctly.'
    );
  }

  if (!target.__safe_flow_flowable) target.__safe_flow_flowable = {};
  target.__safe_flow_flowable[propertyKey] = options ? options : true;
}

function takeNumber(name: string) {
  return ++names[name];
}

let names: { [key: string]: number } = {};
function registerName(name: string) {
  if (name in names) {
    throw new Error(`[safe-flow] Duplicate flow name "${name}".`);
  }
  names[name] = 0;
}
