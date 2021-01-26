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
  TErrf extends boolean = false
> = (
  ...args: TParam
) => Promise<FlowResult<TReturn, TThis, TParam, TErrf>> &
  (TErrf extends false
    ? {
        safe_flow_promise: true;
        canceled: () => boolean;
        cancel: (reason?: any) => void;
        state: () => PromiseState;
        errf: () => ReturnType<SafeFlowCreator<TReturn, TThis, TParam, true>>;
        onCancel: (
          handler: CancelHandler
        ) => ReturnType<SafeFlowCreator<TReturn, TThis, TParam>>;
      }
    : {
        safe_flow_promise: true;
        canceled: () => boolean;
        cancel: (reason?: any) => void;
        state: () => PromiseState;
        onCancel: (
          handler: CancelHandler
        ) => ReturnType<SafeFlowCreator<TReturn, TThis, TParam, true>>;
      });

type Canceler = (reason: any, isDropout?: boolean) => any;

/* istanbul ignore next */
function report() {
  return new Error('[safe-flow] Please report this bug to the author.');
}

const lostControlMsg =
  '[safe-flow] Some child threads have lost control. There should be no unfinished child threads in the completed parent thread.';
function lostControl() {
  return new Error(lostControlMsg);
}

const manualBreakMsg =
  '[safe-flow] In the cancelled thread, no new child threads should be started. When autoBreak is set to false, you must manually end function execution of the cancelled thread.';
function manualBreak() {
  return new Error(manualBreakMsg);
}

const cancelSelfErrMsg =
  '[safe-flow] The called cancelSelf method is not in the currently running thread, or the thread is cancelled when autoBreak is false. Don not call it in other asynchronous callback.';
function cancelSelfErr() {
  return new Error(cancelSelfErrMsg);
}

export const FlowState = { canceled: 1, done: 2 } as const;
export const ErrfState = { error: 1, canceled: 2, done: 3 } as const;

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
  willCancel = false;
  willBreak = false;

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
    public autoBreak = true,
    public name?: string,
    public id?: number,
    public onState?: StateHandler,
    public plugins?: Plugin[]
  ) {
    this.levelup();
    if (__debug_enable_value) __debug_live_threads.push(this);
  }

  changeState(state: TraceState.thread_starting): void;
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

    if (!this.disposed) plugins.onState(state, this);
    if (this.plugins)
      this.plugins.forEach((plugin) => {
        plugin.onState(state, this);
      });
    if (this.onState) this.onState(state, this);

    if (this.trace && this.name) {
      /* istanbul ignore else */
      if (
        state === TraceState.thread_starting ||
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

    inThread = Boolean(this.parent);
    //@ts-expect-error
    this.func = undefined;
    //@ts-expect-error
    this.creator = undefined;
    this.parent = undefined;
    this.token = undefined;
    this.canceler = undefined;
    this.cancellation = undefined;
    this.onState = undefined;
    this.plugins = undefined;

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
  autoBreak?: boolean;
  filter?: Filter;
  onState?: StateHandler;
  development?: 'auto' | 'development' | 'production';
};

const defConfig: RequiredPick<Config, 'trace' | 'standalone' | 'filter'> = {
  trace: false,
  standalone: false,
  filter: () => false,
  development: 'auto',
} as const;
let config = defConfig;

export function configure(options?: Config) {
  if (options) config = defaults(options, config);
  else config = defConfig;
}

const tokenCreators = new Map<any, SafeFlowCreator[]>();
const creatorThreads = new Map<SafeFlowCreator, Thread[]>();

let inDead = false;
let inThread = false;
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
function current() {
  return inThread ? currentThread : undefined;
}

/* istanbul ignore next */
const logger = {
  log: (...args: any[]) => {
    console.log(...args);
  },
};

export const __debug_logger = logger;

export const __debug_token_creators = tokenCreators;
export const __debug_creator_processes = creatorThreads;
export const __debug_get_curr_thread = () => {
  return currentThread;
};
export function __debug_clear_names() {
  names = {};
}
export function __debug_clear_threads() {
  tokenCreators.clear();
  creatorThreads.clear();
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

export function __debug_in_thread() {
  return inThread;
}

export enum TraceState {
  creator_created,
  thread_starting,
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
        | TraceState.thread_starting
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
      case TraceState.thread_starting:
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
  const { trace, autoBreak, name, standalone, onState, plugins } = opts;
  if (trace && name) {
    registerName(name);
    tracing(trace, { name, state: TraceState.creator_created });
  }

  return function safe_flow_creator(this: TThis, ...args: TParam) {
    if (inDead) {
      throw manualBreak();
    }
    const parentThread = current();
    const id = trace && !standalone && name ? takeNumber(name) : undefined;
    token === undefined && (token = thisArg);
    let creators = tokenCreators.get(token);
    if (creators) {
      if (!creators.includes(safe_flow_creator)) {
        creators.push(safe_flow_creator);
      } else if (standalone) {
        throw new Error(
          '[safe-flow] Standalone mode flow only allows one thread to execute for one creator.'
        );
      }
    } else {
      creators = [];
      creators.push(safe_flow_creator);
      tokenCreators.set(token, creators);
    }

    !creatorThreads.has(safe_flow_creator) &&
      creatorThreads.set(safe_flow_creator, []);
    const threads = creatorThreads.get(safe_flow_creator);

    /* istanbul ignore if */
    if (!threads) throw report();

    const thread = new Thread(
      func,
      safe_flow_creator,
      parentThread,
      token,
      trace,
      autoBreak,
      name,
      id,
      onState,
      plugins
    );
    threads.push(thread);
    thread.changeState(TraceState.thread_starting);
    setCurrThread(thread);

    Promise.resolve().then(() => {
      inThread = false;
    });
    inThread = true;

    let cancelHandlers: CancelHandler[] = [];
    const promise = new Promise((resolve, reject) => {
      thread.canceler = (reason, isDropout) => {
        if (thread.state === TraceState.thread_starting) {
          throw new Error(
            '[safe-flow] Do not cancel the thread while starting.'
          );
        }

        thread.willCancel = true;
        cancelChildren(thread, reason);
        if (parentThread) {
          parentThread.removeChild(thread);
        }

        const { creator, token } = thread;
        const threads = creatorThreads.get(creator);
        const creators = tokenCreators.get(token);
        /* istanbul ignore if */
        if (!threads || !creators) throw report();
        if (isDropout) dropout(thread, threads, creator, creators);

        const cancellation = new Canceled(
          safe_flow_creator,
          thisArg,
          args,
          reason
        );
        thread.cancellation = cancellation;
        thread.canceled = true;
        thread.changeState(TraceState.thread_canceled, reason);
        cancelHandlers.forEach((handler) => {
          handler(reason);
        });
        cancelHandlers.length = 0;
        //@ts-expect-error
        cancelHandlers = undefined;

        thread.complete(false);
        setCurrThread(parentThread);

        if (
          parentThread &&
          !parentThread.willBreak &&
          parentThread.willCancel &&
          parentThread.autoBreak
        )
          reject(getBreakMsg());
        else resolve([cancellation]);

        Promise.resolve().then(() => {
          inDead = false;
        });
        inDead = true;
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
          cancelChildren(thread, 'An error occurred in the parent thread.');
          const [caught] = result;
          thread.changeState(TraceState.thread_error, caught);
          dropout(thread, threads, safe_flow_creator, creators);
          thread.complete();
          setCurrThread(parentThread);
          reject(caught);
        } else if (result.length === CatchFirst.done) {
          const [, done] = result;
          thread.changeState(TraceState.thread_done, done);
          dropout(thread, threads, safe_flow_creator, creators);
          if (thread.hasChildren) {
            cancelChildren(thread, 'An error occurred in the parent thread.');
            thread.complete();
            setCurrThread(parentThread);
            reject(lostControl());
            return;
          }
          thread.complete();
          setCurrThread(parentThread);
          resolve([null, done]);
        } else {
          throw report();
        }
      });
      thread.changeState(TraceState.thread_idle);
      setCurrThread(parentThread);
      if (!thread.parent) inThread = false;
      inDead = false;
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
      cancelHandlers.push(handler);
      return promise;
    };

    promise.errf = () => {
      const errfPromise = promise
        .then(([canceled, data]) => {
          if (canceled === null)
            return [null, null, data] as [null, null, TReturn];
          return [null, canceled] as [null, Canceled];
        })
        .catch((error: unknown) => {
          if (
            error === breakMsg ||
            (error instanceof Error && error.message === lostControlMsg)
          )
            throw error;
          return [error] as [unknown];
        }) as any;
      errfPromise.safe_flow_promise = true;
      errfPromise.cancel = promise.cancel;
      errfPromise.canceled = promise.canceled;
      errfPromise.state = promise.state;
      errfPromise.onCancel = (handler: (reason: any) => any) => {
        cancelHandlers.push(handler);
        return errfPromise;
      };
      return errfPromise;
    };

    return promise;
  } as any;
}

export function isInvalid() {
  if (!inDead && !inThread)
    throw new Error(
      '[safe-flow] The called isInvalid method is not in the currently running thread. Don not call it in other asynchronous callback.'
    );
  return !current();
}

export function isSafeFlowPromise(promise: any) {
  return promise.safe_flow_promise === true;
}

export function isCreator(func: Function) {
  return typeof func === 'function' && func.name === 'safe_flow_creator';
}

function cancelChildren(thread: Thread, reason?: any) {
  const { children } = thread;
  children.concat().forEach((child) => {
    internalCancelSelf(child, reason);
  });
}

function dropout(
  thread: Thread,
  threads: Thread[],
  creator: SafeFlowCreator,
  creators: SafeFlowCreator[]
) {
  threads.splice(threads.indexOf(thread), 1);
  if (threads.length === 0) {
    creatorThreads.delete(creator);
    creators.splice(creators.indexOf(creator), 1);
    if (creators.length === 0) {
      tokenCreators.delete(thread.token);
    }
  }
}

export function cancel(creator: SafeFlowCreator, reason?: any): void;
export function cancel(token?: any, reason?: any): void;
export function cancel(tokenOrCreator: any, reason?: any) {
  const currThread = current();
  internalCancel(currThread, tokenOrCreator, reason);
}

export function cancelAll(reason?: any) {
  const currThread = current();
  if (currThread) currThread.willBreak = true;
  tokenCreators.forEach((_creator, token) => {
    internalCancel(currThread, token, reason, true);
  });
  if (currThread && currThread.autoBreak) {
    throw getBreakMsg();
  }
}

function internalCancel(
  currThread: Thread | undefined,
  tokenOrCreator: any,
  reason?: any,
  all = false
) {
  let isThrow = false;
  if (isCreator(tokenOrCreator)) {
    const threads = creatorThreads.get(tokenOrCreator);
    if (threads) {
      const token = threads[0].token;
      threads.forEach((thread) => {
        /* istanbul ignore if */
        if (!thread.canceler) throw report();
        if (!all && currThread && !isThrow)
          isThrow = currThread.willBreak = inTree(thread, currThread);
        thread.canceler(reason, false);
      });
      threads.length = 0;
      creatorThreads.delete(tokenOrCreator);

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
        const threads = creatorThreads.get(creator);
        /* istanbul ignore if */
        if (!threads) throw report();
        threads.forEach((thread) => {
          /* istanbul ignore if */
          if (!thread.canceler) throw report();
          if (!all && currThread && !isThrow)
            isThrow = currThread.willBreak = inTree(thread, currThread);
          thread.canceler(reason, false);
        });
        threads.length = 0;
        creatorThreads.delete(creator);
      });
      tokenCreators.delete(tokenOrCreator);
    }
  }
  if (isThrow && currThread && currThread.autoBreak) {
    throw getBreakMsg();
  }
}

function inTree(tree: Thread, target: Thread): boolean {
  if (tree === target) return true;
  const { children } = tree;
  return children.some((child) => {
    if (child !== target) {
      return inTree(target, child);
    } else {
      return true;
    }
  });
}

export function cancelSelf(reason?: any) {
  const currThread = current();
  if (currThread) {
    currThread.willBreak = true;
    internalCancelSelf(currThread, reason);
    if (currThread.autoBreak) throw getBreakMsg();
  } else {
    throw cancelSelfErr();
  }
}

function internalCancelSelf(thread: Thread, reason?: any) {
  const { canceler } = thread;
  /* istanbul ignore if */
  if (!canceler) throw report();
  canceler(reason, true);
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

  const norepeat: { [key: string]: true } = {};
  Object.getOwnPropertyNames(target).forEach((propertyKey) => {
    norepeat[propertyKey] = true;
  });
  Object.getOwnPropertyNames(Object.getPrototypeOf(target)).forEach(
    (propertyKey) => {
      norepeat[propertyKey] = true;
    }
  );
  Object.keys(norepeat).forEach((propertyKey) => {
    flowupProp(target, propertyKey, opts);
  });

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

  const { names, token, trace, autoBreak, standalone, plugins } = options;
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
    autoBreak,
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
