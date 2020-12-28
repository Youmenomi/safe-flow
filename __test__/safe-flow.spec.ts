import {
  flow,
  flowable,
  flowup,
  Canceled,
  cancel,
  cancelAll,
  flowed,
  cancelSelf,
  __debug_enable,
  __debug_live_threads,
  configure,
  __debug_logger,
  __debug_clear_names,
  PromiseState,
  FlowState,
  TraceState,
  __debug_clear_threads,
  isSafeFlowPromise,
} from '../src';
import {
  checkType,
  delay,
  EFR,
  errfSimplify,
  error,
  fetch,
  FR,
  simplify,
  timeout,
  verify,
} from './helper';

//注意事項
// 子flow一定要加await
//不要trycatch(promise.catch)子flow
//Promis.all 不要用flow包

//mobx!!! next 要在 action中

//內存測試
//es3環境測看看
//ES3 run test 看看
//檢查 優化  test

//TODO flowable 有給參數 跟沒有給參數  路線不同
//class 和 function 是不同路線

__debug_enable(true);

enum CancelMethod {
  cancelSelf,
  cancelToken,
  cancelCreator,
  cancelAll,
  promiseCancel,
}
describe('safe-flow', () => {
  let print = false;
  let i = 0;
  const originalLog = __debug_logger.log;
  const log = jest
    .spyOn(__debug_logger, 'log')
    .mockImplementation((...args: any[]) => {
      if (print) originalLog(...args);
    });

  beforeEach(() => {
    print = false;
    configure();
    i = 0;
    log.mockClear();
    __debug_clear_names();
  });

  afterEach(async () => {
    verify();
    await delay(50);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('errf', async () => {
    class Store {
      @flowable
      async foo1(t: number) {
        await flow(delay)(5);
        return t.toString();
      }

      foo2 = flow(async (t: number) => {
        return await flow(fetch)(t.toString());
      });

      foo3 = flow(async (t: number) => {
        return await flow(fetch)(t.toString()).errf();
      });

      foo4 = flow(async (t: number) => {
        return await this.foo1(t);
      });

      foo5 = flow(async (t: number) => {
        return await flowed(this.foo1)(t).errf();
      });
    }
    const store = flowup(new Store());

    expect(await flowed(store.foo1)(5)).toEqual([null, '5']);
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(await flowed(store.foo1)(5).errf()).toEqual([null, null, '5']);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    expect(await flowed(store.foo2)(5)).toEqual([null, [null, '5']]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(await flowed(store.foo2)(5).errf()).toEqual([
      null,
      null,
      [null, '5'],
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    expect(await flowed(store.foo3)(5)).toEqual([null, [null, null, '5']]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(await flowed(store.foo3)(5).errf()).toEqual([
      null,
      null,
      [null, null, '5'],
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    expect(await flowed(store.foo4)(5)).toEqual([null, [null, '5']]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(await flowed(store.foo4)(5).errf()).toEqual([
      null,
      null,
      [null, '5'],
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    expect(await flowed(store.foo5)(5)).toEqual([null, [null, null, '5']]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(await flowed(store.foo5)(5).errf()).toEqual([
      null,
      null,
      [null, null, '5'],
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  describe('Cancel immediately cancel after the main thread starts', () => {
    immediately_after_the_main_thread_starts(CancelMethod.cancelSelf);
    immediately_after_the_main_thread_starts(CancelMethod.cancelToken);
    immediately_after_the_main_thread_starts(CancelMethod.cancelCreator);
    immediately_after_the_main_thread_starts(CancelMethod.cancelAll);
  });

  describe('Cancel immediately after the child thread ends', () => {
    immediately_after_the_child_thread_ends(CancelMethod.cancelSelf);
    immediately_after_the_child_thread_ends(CancelMethod.cancelToken);
    immediately_after_the_child_thread_ends(CancelMethod.cancelCreator);
    immediately_after_the_child_thread_ends(CancelMethod.cancelAll);
  });

  describe('Cancel outside the thread', () => {
    outside_the_thread(CancelMethod.cancelToken);
    outside_the_thread(CancelMethod.cancelCreator);
    outside_the_thread(CancelMethod.cancelAll);
    outside_the_thread(CancelMethod.promiseCancel);
  });

  it('flowup', async () => {
    class Store {
      foo1() {
        return flow(fetch)('foo1');
      }
      foo2() {
        return flow(fetch)('foo2');
      }

      @flowable
      async foo3() {
        await flow(delay)(5);
        return await flow(fetch)('foo3');
      }

      @flowable({ standalone: true })
      async foo4() {
        await flow(delay)(5);
        return await flow(fetch)('foo4');
      }

      @flowable
      async foo5() {
        await flow(delay)(5);
        return await flow(fetch)('foo5');
      }

      async foo6() {
        await flow(delay)(5);
        return await flow(fetch)('foo6');
      }
    }
    const store = new Store();
    flowup(store, {
      names: { foo1: true, foo5: true },
      filter: (name) => name === 'foo2' || name === 'foo5',
    });

    expect(store.foo1.name.includes('safe_flow_creator')).toBeTruthy();
    expect(store.foo2.name.includes('safe_flow_creator')).toBeTruthy();
    expect(store.foo3.name.includes('safe_flow_creator')).toBeTruthy();
    expect(store.foo4.name.includes('safe_flow_creator')).toBeTruthy();
    expect(store.foo5.name.includes('safe_flow_creator')).toBeTruthy();
    expect(store.foo6.name).toBe('foo6');
    expect(await store.foo1()).toEqual([null, [null, 'foo1']]);
    expect(await store.foo2()).toEqual([null, [null, 'foo2']]);
    expect(await store.foo3()).toEqual([null, [null, 'foo3']]);
    expect(await store.foo4()).toEqual([null, [null, 'foo4']]);
    expect(await store.foo5()).toEqual([null, [null, 'foo5']]);
    expect(await store.foo6()).toEqual([null, 'foo6']);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    expect(() => {
      flowup(store, {
        names: {
          foo7: true,
        },
      });
    }).toThrow(
      new ReferenceError(
        '[safe-flow] The specified attribute "foo7" found through the names option is not a function.'
      )
    );
  });

  describe('complete a thread', () => {
    complete_a_thread();
    complete_a_thread_return_values();
  });

  it('try/catch and .catch() on the child thread', async () => {
    const func = jest.fn();
    let breakMsg = '';
    class Store {
      @flowable({ token: 'token' })
      async foo1() {
        try {
          await flow(fetch)(1);
        } catch (error) {
          breakMsg = error;
        }
        func();
      }

      @flowable({ token: 'token' })
      async foo2() {
        await flow(fetch)(1).catch((error) => {
          breakMsg = error;
        });
        func();
      }

      @flowable({ token: 'token' })
      async foo3() {
        try {
          await Promise.all([flow(fetch)(1), flow(fetch)(2), flow(fetch)(3)]);
        } catch (error) {
          breakMsg = error;
        }
        func();
      }

      @flowable({ token: 'token' })
      async foo4() {
        await Promise.all([
          flow(fetch)(1),
          flow(fetch)(2),
          flow(fetch)(3),
        ]).catch((error) => {
          breakMsg = error;
        });
        func();
      }
    }
    const store = flowup(new Store());

    const flows = [store.foo1];
    for (let i = 0; i < flows.length; i++) {
      timeout(() => {
        cancel('token');
      }, 5);
      await flow(async () => {
        await flows[i]();
      })();
      expect(breakMsg).toBe(
        '[safe-flow] Do not use try/catch and .catch() on threads. It causes the parent thread to not be interrupted as expected when cancelled. Use .errf() to receive exceptions instead.'
      );
      expect(func).toBeCalled();
      verify();
      expect(__debug_live_threads.length).toBe(0);
    }
  });

  it('use flowup names to set name', async () => {
    configure({ trace: true });
    class Store {
      foo1() {
        return flow(fetch)('foo1');
      }
      foo2() {
        return flow(fetch)('foo1');
      }
    }
    const store = new Store();
    flowup(store, {
      names: { foo1: true, foo2: 'fooooo2' },
    });

    expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');
    expect(log).nthCalledWith(++i, '[safe-flow] [fooooo2] Creator is created.');
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('also set options in flowup names and flowable', async () => {
    configure({ trace: true });
    class Store {
      @flowable({ name: 'nameFlowable', token: 'tokenFlowable' })
      foo1() {
        return flow(fetch)('foo1');
      }
    }
    const store = new Store();
    flowup(store, {
      names: { foo1: 'nameFlowup' },
      token: 'tokenFlowup',
    });

    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] [nameFlowable] Creator is created.'
    );
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('flowable ES3', async () => {
    const foo1 = {
      f1: async () => {
        await flow(delay)(5);
      },
    };
    flowable(foo1, 'f1');
    //@ts-expect-error
    expect(foo1.f1.__safe_flow_flowable).toBeTruthy();

    const foo2 = {
      f2: async () => {
        await flow(delay)(5);
      },
    };
    flowable({})(foo2, 'f2');
    //@ts-expect-error
    expect(foo2.f2.__safe_flow_flowable).toBeTruthy();
  });

  it('standalone', async () => {
    const f1 = flow(
      async () => {
        await flow(delay)(5);
      },
      { standalone: true }
    );

    await f1();
    await f1();
    verify();

    await expect(async () => {
      await Promise.all([f1(), f1(), f1()]);
    }).rejects.toThrowError(
      '[safe-flow] Standalone mode flow only allows one process to execute.'
    );

    await delay(10);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('when disposing store, cancel the running thread to avoid subsequent exceptions.', async () => {
    const func = jest.fn();
    class Store {
      _disposed = false;
      throw() {
        if (this._disposed) throw new Error('Error occurred!');
      }

      @flowable
      async foo(t: number) {
        func();
        await flow(delay)(t);
        func();
        this.throw();
        func();
        return 'foo';
      }

      dispose() {
        this._disposed = true;
        cancel(this, { baz: 'baz' });
      }
    }
    const store = new Store();
    flowup(store);

    timeout(() => {
      store.dispose();
    }, 5);
    const [, canceled] = await flowed(store.foo)(10).errf();
    expect(func).toBeCalledTimes(1);
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(canceled).toBeInstanceOf(Canceled);
    if (canceled) {
      func.mockClear();
      const { thisArg, args, reason } = canceled;
      expect([thisArg, args, reason]).toStrictEqual([
        store,
        [10],
        { baz: 'baz' },
      ]);

      const [err] = await canceled.retry().errf();
      expect(err).toEqual(new Error('Error occurred!'));
      expect(func).toBeCalledTimes(2);
      verify();
      expect(__debug_live_threads.length).toBe(0);
    }
  });

  it('cancel one of the parallel threads by creator', async () => {
    const func = jest.fn();
    const f1 = flow(async () => {
      await flow(delay)(10);
      func();
    });
    const f2 = flow(async () => {
      await flow(delay)(10);
      func();
    });

    timeout(() => {
      cancel(f1);
    }, 5);
    expect(simplify(await Promise.all([f1(), f2()]))).toEqual([
      FR.canceled,
      FR.fulfilled,
    ]);
    expect(func).toBeCalledTimes(1);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel all child threads in the main thread', async () => {
    class Store {
      @flowable
      async foo() {
        await Promise.all([
          flow(fetch, { token: 'token' })(1),
          flow(fetch, { token: 'token' })(2),
          flow(fetch, { token: 'token' })(3),
        ]);
        return 'foo';
      }
    }
    const store = new Store();
    flowup(store);

    timeout(() => {
      cancel('token');
    }, 5);
    await store.foo();
    verify();
    expect(__debug_live_threads.length).toBe(0);

    await delay(10);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel by unused token or creator', async () => {
    cancel('unused token');

    const f1 = flow(async () => {
      return await flow(fetch)('foo1');
    });
    cancel(f1);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel parallel threads using various tokens', async () => {
    class Store {
      @flowable
      async foo() {
        await flow(delay)(10);
        return 'foo';
      }

      bar() {
        return flow(async () => {
          await flow(delay)(10);
          return 'foo';
        })();
      }

      cancel() {
        cancel(this);
      }
    }
    const store = new Store();
    flowup(store);

    const f1 = flow(
      async () => {
        await flow(delay)(10);
        return 'foo';
      },
      { token: store }
    );
    const f2 = flow(async () => {
      await flow(delay)(10);
      return 'foo';
    });
    const f3 = flow(
      async () => {
        await flow(delay)(10);
        return 'foo';
      },
      { token: 'token' }
    );

    expect(
      simplify(
        await Promise.all([flowed(store.foo)(), f1(), f2(), f3(), store.bar()])
      )
    ).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    const ms = 5;
    timeout(() => store.cancel(), ms);
    expect(
      simplify(
        await Promise.all([flowed(store.foo)(), f1(), f2(), f3(), store.bar()])
      )
    ).toEqual([
      FR.canceled,
      FR.canceled,
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => cancel(), ms);
    expect(
      simplify(
        await Promise.all([flowed(store.foo)(), f1(), f2(), f3(), store.bar()])
      )
    ).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.canceled,
      FR.fulfilled,
      FR.canceled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => cancel('token'), ms);
    expect(
      simplify(
        await Promise.all([flowed(store.foo)(), f1(), f2(), f3(), store.bar()])
      )
    ).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
      FR.canceled,
      FR.fulfilled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => cancelAll(), ms);
    expect(
      simplify(
        await Promise.all([flowed(store.foo)(), f1(), f2(), f3(), store.bar()])
      )
    ).toEqual([
      FR.canceled,
      FR.canceled,
      FR.canceled,
      FR.canceled,
      FR.canceled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel parallel threads of the same creator', async () => {
    const f1 = flow(async () => {
      await flow(delay)(10);
      return 'foo';
    });

    expect(simplify(await Promise.all([f1(), f1(), f1()]))).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => cancel(f1), 5);
    expect(simplify(await Promise.all([f1(), f1(), f1()]))).toEqual([
      FR.canceled,
      FR.canceled,
      FR.canceled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => cancelAll(), 5);
    expect(simplify(await Promise.all([f1(), f1(), f1()]))).toEqual([
      FR.canceled,
      FR.canceled,
      FR.canceled,
    ]);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel parallel threads in the thread', async () => {
    const func = jest.fn();
    const f1 = flow(async () => {
      await flow(delay)(10);
      func();
    });
    const f2 = flow(async () => {
      await flow(delay)(10);
      func();
    });
    const f3 = flow(async () => {
      await flow(delay)(5);
      cancelAll();
      func();
      throw Error('Error occurred!');
    });
    const f4 = flow(
      async () => {
        cancel('token');
        func();
        throw Error('Error occurred!');
      },
      { token: 'token' }
    );
    const f5 = flow(async () => {
      cancel(f5);
      func();
      throw Error('Error occurred!');
    });

    expect(simplify(await Promise.all([f1(), f2(), f3()]))).toEqual([
      FR.canceled,
      FR.canceled,
      FR.canceled,
    ]);
    expect(func).toBeCalledTimes(0);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    func.mockClear();
    expect(simplify(await Promise.all([f1(), f2(), f4()]))).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.canceled,
    ]);
    expect(func).toBeCalledTimes(2);
    verify();
    expect(__debug_live_threads.length).toBe(0);

    func.mockClear();
    expect(simplify(await Promise.all([f1(), f2(), f5()]))).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.canceled,
    ]);
    expect(func).toBeCalledTimes(2);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel with reason', async () => {
    const f1 = flow(
      async () => {
        await flow(delay)(10);
      },
      { token: 'token' }
    );

    timeout(() => {
      cancelAll('foo');
    }, 5);
    let [canceled] = await f1();
    if (canceled) expect(canceled.reason).toBe('foo');
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => {
      cancel('token', 'foo');
    }, 5);
    [canceled] = await f1();
    if (canceled) expect(canceled.reason).toBe('foo');
    verify();
    expect(__debug_live_threads.length).toBe(0);

    timeout(() => {
      cancel(f1, 'foo');
    }, 5);
    [canceled] = await f1();
    if (canceled) expect(canceled.reason).toBe('foo');
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancelSelf', async () => {
    const func = jest.fn();

    class Store {
      @flowable
      async foo() {
        await flow(delay)(10);
        cancelSelf();
        func();
      }
    }
    const store = flowup(new Store());

    timeout(() => {
      expect(() => cancelSelf()).toThrowError(
        '[safe-flow] The cancelSelf method must be invoked in the currently running flow thread. Don not call it in other asynchronous callback.'
      );
    }, 5);
    let [canceled] = await flowed(store.foo)();
    expect(canceled).toBeInstanceOf(Canceled);
    expect(func).not.toBeCalled();
    verify();
    expect(__debug_live_threads.length).toBe(0);

    func.mockClear();
    const f1 = flow(
      async () => {
        await flow(delay)(5);
        cancelSelf('stop');
        func();
      },
      { token: 'token' }
    );

    [canceled] = await f1();
    expect(canceled).toBeDefined();
    if (canceled) expect(canceled.reason).toBe('stop');
    expect(func).not.toBeCalled();
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('cancel the terminated thread', async () => {
    const func = jest.fn();

    const f1 = flow(
      async () => {
        await flow(fetch)('123');
        func();
      },
      { token: 'token' }
    );

    {
      const promise = f1();
      await promise;
      verify();
      expect(__debug_live_threads.length).toBe(0);
      expect(promise.state()).toBe(PromiseState.fulfilled);

      cancelAll();
      cancel(f1);
      cancel('token');

      expect(() => promise.cancel()).toThrowError(
        '[safe-flow] Unable to cancel a thread that has ended.'
      );
    }

    {
      const promise = f1();
      await promise;
      verify();
      expect(__debug_live_threads.length).toBe(0);
      expect(() => promise.cancel('stop')).toThrowError(
        '[safe-flow] Unable to cancel a thread that has ended.'
      );
    }

    {
      func.mockClear();
      const promise = f1();
      timeout(() => {
        promise.cancel('stop');
      }, 5);
      const [canceled] = await promise;
      expect(canceled).toBeDefined();
      if (canceled) expect(canceled.reason).toBe('stop');
      expect(func).not.toBeCalled();
      verify();
      expect(__debug_live_threads.length).toBe(0);
      expect(() => promise.cancel('stop')).toThrowError(
        '[safe-flow] Unable to cancel a thread that has ended.'
      );
    }
  });

  it('Unable to detect illegal call to child thread', async () => {
    const func = jest.fn();

    class Store {
      @flowable
      async foo1() {
        const foo2 = flow(fetch, { token: 'foo2' });
        foo2('foo2').errf();
        foo2('foo2').errf();
        await foo2('foo2').errf();
        func();
        return 'foo1';
      }
    }
    const store = flowup(new Store());

    const [, done] = await flowed(store.foo1)();
    expect(done).toBe('foo1');
    expect(func).toBeCalledTimes(1);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('invoke child flow thread without the await operator', async () => {
    const func = jest.fn();

    {
      class Store {
        @flowable
        async foo1() {
          const foo2 = flow(fetch, { token: 'foo2' });
          foo2('foo2').errf();
          foo2('foo2').errf();
          foo2('foo2').errf();
          func();
        }
      }
      const store = flowup(new Store());

      await expect(async () => {
        await flowed(store.foo1)().errf();
      }).rejects.toThrowError(
        '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.'
      );
      expect(func).toBeCalledTimes(1);
    }

    {
      func.mockClear();
      class Store {
        @flowable
        async foo1() {
          const foo2 = flow(fetch, { token: 'foo2' });
          foo2('foo2').errf();
          cancelSelf();
          func();
        }
      }
      const store = flowup(new Store());

      await expect(async () => {
        await flowed(store.foo1)();
      }).rejects.toThrowError(
        '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.'
      );
      expect(func).toBeCalledTimes(0);
    }

    {
      func.mockClear();
      class Store {
        @flowable
        async foo1() {
          const foo2 = flow(fetch, { token: 'foo2' });
          Promise.all([foo2('foo2'), foo2('foo2'), foo2('foo2')]);
          cancel(this);
          func();
        }
      }
      const store = flowup(new Store());

      await expect(async () => {
        await flowed(store.foo1)();
      }).rejects.toThrowError(
        '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.'
      );
      expect(func).toBeCalledTimes(0);
    }

    {
      func.mockClear();
      class Store {
        @flowable
        async foo1() {
          const foo2 = flow(fetch, { token: 'foo2' });
          foo2('foo2');
          cancel(foo2);
          func();
        }
      }
      const store = flowup(new Store());

      await expect(async () => {
        await flowed(store.foo1)();
      }).rejects.toThrowError(
        '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.'
      );
      expect(func).toBeCalledTimes(0);
    }

    {
      func.mockClear();
      class Store {
        @flowable
        async foo1() {
          const foo2 = flow(fetch, { token: 'foo2' });
          Promise.all([foo2('foo2'), foo2('foo2'), foo2('foo2')]);
          cancelAll();
          func();
        }
      }
      const store = flowup(new Store());

      await expect(async () => {
        await flowed(store.foo1)();
      }).rejects.toThrowError(
        '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.'
      );
      expect(func).toBeCalledTimes(0);
    }

    {
      func.mockClear();
      class Store {
        @flowable
        async foo1() {
          const foo2 = flow(fetch, { token: 'foo2' });
          await foo2('foo2');
          foo2('foo2');
          cancel('foo2');
          func();
        }
      }
      const store = flowup(new Store());

      await expect(async () => {
        await flowed(store.foo1)();
      }).rejects.toThrowError(
        '[safe-flow] There are child threads out of control. The flow thread in another thread can only be used with the await operator.'
      );
      expect(func).toBeCalledTimes(0);
    }

    await delay(10);
    verify(false);
    __debug_clear_threads();
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('passing non-promise parameters', async () => {
    await expect(async () => {
      //@ts-expect-error
      await flow(undefined)();
    }).rejects.toThrowError(
      new ReferenceError('[safe-flow] The func is not a function.')
    );

    //@ts-expect-error
    const f1 = flow(() => undefined);
    const result = await f1();
    expect(result.length).toBe(FlowState.done);
    if (result.length === FlowState.done) {
      const [, done] = result;
      expect(done).toBe(undefined);
    }

    {
      class Store {
        @flowable
        foo1(value: string) {
          return value;
        }
      }
      const store = flowup(new Store());
      const result = await store.foo1('test');
      expect(result.length).toBe(FlowState.done);
      if (result.length === FlowState.done) {
        const [, done] = result;
        expect(done).toBe('test');
      }
    }
    {
      class Store {
        @flowable({ standalone: true })
        foo1(value: string) {
          return value;
        }
      }
      const store = flowup(new Store());
      const result = await store.foo1('test');
      expect(result.length).toBe(FlowState.done);
      if (result.length === FlowState.done) {
        const [, done] = result;
        expect(done).toBe('test');
      }
    }
    {
      class Store {
        foo1(value: string) {
          return value;
        }
      }
      const store = flowup(new Store(), {
        names: { foo1: true },
      });
      //@ts-expect-error
      const result = await flowed(store).foo1('test');
      expect(result.length).toBe(FlowState.done);
      if (result.length === FlowState.done) {
        const [, done] = result;
        expect(done).toBe('test');
      }
    }
    {
      class Store {
        foo1(value: string) {
          return value;
        }
      }
      const store = flowup(new Store(), {
        filter: (name) => name === 'foo1',
      });
      //@ts-expect-error
      const result = await flowed(store).foo1('test');
      expect(result.length).toBe(FlowState.done);
      if (result.length === FlowState.done) {
        const [, done] = result;
        expect(done).toBe('test');
      }
    }

    {
      expect(() => {
        class Store {
          @flowable({ standalone: true })
          foo1 = '123';
        }
        Store;
      }).toThrow(
        new ReferenceError(
          '[safe-flow] Cannot get the target function to be flowed. The "flowable" method decorator may not be used correctly.'
        )
      );
    }
    {
      expect(() => {
        class Store {
          @flowable
          foo1 = '123';
        }
        Store;
      }).toThrow(
        new ReferenceError(
          '[safe-flow] Cannot get the target function to be flowed. The "flowable" method decorator may not be used correctly.'
        )
      );
    }
    {
      expect(() => {
        class Store {
          foo1 = '123';
        }
        flowup(new Store(), {
          names: { foo1: true },
        });
      }).toThrow(
        new ReferenceError(
          '[safe-flow] The specified attribute "foo1" found through the names option is not a function.'
        )
      );
    }
    {
      class Store {
        foo1 = '123';
      }
      const store = flowup(new Store(), {
        filter: (name) => name === 'foo1',
      });
      expect(store.foo1).toBe('123');
    }
  });

  it('an error occurred in the thread', async () => {
    const f1 = flow(
      async () => {
        await flow(error)(5);
      },
      { standalone: true }
    );

    await expect(async () => await f1()).rejects.toThrowError(
      'Error occurred!'
    );

    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('an error occurred in the thread with trace', async () => {
    configure({ trace: true });

    const f1 = flow(
      async () => {
        throw new Error('Error occurred!');
      },
      { name: 'foo1' }
    );
    expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');

    const [caught] = await f1().errf();
    expect(caught).toEqual(new Error('Error occurred!'));
    verify();
    expect(__debug_live_threads.length).toBe(0);

    expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): start');
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Change the current thread pointer to [foo1].'
    );
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Clear the current thread pointer.'
    );
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] [foo1](1): error Error: Error occurred!'
    );
    expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): terminated');
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Clear the current thread pointer.'
    );
    expect(log).toBeCalledTimes(i);
  });

  it('error in Parallel threads', async () => {
    const func = jest.fn();
    let i = 0;
    const f1 = flow(async () => {
      if (++i === 2) throw new Error('Error occurred!');
      await flow(delay)(5);
      func();
    });
    const f2 = flow(async () => {
      await delay(5);
      func();
    });

    expect(
      errfSimplify(await Promise.all([f1().errf(), f1().errf(), f2().errf()]))
    ).toEqual([EFR.fulfilled, EFR.error, EFR.fulfilled]);
    expect(func).toBeCalledTimes(2);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('flow an asynchronous function without asynchronous operation', async () => {
    const f1 = flow(async () => {
      return 'foo';
    });

    const [, done] = await f1();
    expect(done).toBe('foo');
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('duplicate flow name', async () => {
    configure({ trace: true });
    class Store {
      @flowable({ name: 'foo' })
      foo1(value: string) {
        return value;
      }

      @flowable({ name: 'foo' })
      foo2(value: string) {
        return value;
      }
    }

    expect(() => flowup(new Store())).toThrowError(
      '[safe-flow] Duplicate flow name "foo".'
    );
  });

  it('isSafeFlowPromise', async () => {
    const f1 = flow(async () => {
      await flow(fetch)(1);
    });

    {
      const promise = f1();
      expect(isSafeFlowPromise(promise)).toBeTruthy();
      await promise;
    }

    {
      const promise = f1().errf();
      expect(isSafeFlowPromise(promise)).toBeTruthy();
      await promise;
    }

    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('canceled value of safe flow romise', async () => {
    const f1 = flow(async () => {
      await flow(fetch)(1);
    });

    {
      const promise = f1();
      await promise;
      expect(promise.canceled()).toBeFalsy();
    }

    {
      const promise = f1();
      timeout(() => {
        promise.canceled();
      }, 5);
      await promise;
      expect(promise.canceled()).toBeFalsy();
    }

    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('type', async () => {
    class Store {
      @flowable
      async foo1(this: Store, t: number) {
        return t.toString();
      }

      foo2 = flow(async (t: number) => {
        return await flow(fetch)(t.toString());
      });

      foo3 = flow(async (t: number) => {
        return await flow(fetch)(t.toString()).errf();
      });
    }
    const store = flowup(new Store());

    checkType<[Canceled] | [null, string]>(await flowed(store.foo1)(5));

    {
      const result = await flowed(store.foo1)(5);
      checkType<[Canceled] | [null, string]>(result);
      if (result.length === 1) {
        const [canceled] = result;
        checkType<Store>(canceled.thisArg);
      }
    }
    {
      const result = await flowed(store.foo1)(5).errf();
      checkType<[unknown] | [null, Canceled] | [null, null, string]>(result);
      if (result.length === 2) {
        const [, canceled] = result;
        checkType<Store>(canceled.thisArg);
      }
    }

    checkType<[Canceled] | [null, [Canceled] | [null, string]]>(
      await store.foo2(5)
    );
    checkType<
      [unknown] | [null, Canceled] | [null, null, [Canceled] | [null, string]]
    >(await store.foo2(5).errf());

    checkType<
      [Canceled] | [null, [unknown] | [null, Canceled] | [null, null, string]]
    >(await store.foo3(5));
    checkType<
      | [unknown]
      | [null, Canceled]
      | [null, null, [unknown] | [null, Canceled] | [null, null, string]]
    >(await store.foo3(5).errf());
  });

  it('nested flow', async () => {
    const func1 = jest.fn();
    const func2 = jest.fn();
    const func3 = jest.fn();
    const func = jest.fn();
    class Store {
      @flowable
      async f1(t: number) {
        await flow(delay)(t);
        func();
      }
    }
    const store = flowup(new Store());

    const f2 = flow(async () => {
      await Promise.all([flowed(store.f1)(5), flow(delay)(30)]);
      cancelAll();
      func1();
    });
    const f3 = flow(async () => {
      await flow(delay)(10);
      await f2();
      func2();
    });
    const f4 = flow(async () => {
      await Promise.all([flowed(store.f1)(50), f3(), f2()]);
      func3();
    });

    await f4();
    verify();
    expect(__debug_live_threads.length).toBe(0);
    expect(func).toBeCalledTimes(2);
    expect(func1).not.toBeCalled();
    expect(func2).not.toBeCalled();
    expect(func3).not.toBeCalled();
  });

  it('custom trace', async () => {
    // print = true;
    configure({
      trace: (event) => {
        __debug_logger.log(event.name, event.state);
      },
      standalone: true,
    });

    class Store {
      @flowable({ name: 'foo1' })
      async foo1() {
        await flow(fetch, { name: 'foo2' })('foo1');
        cancelSelf();
      }
    }
    const store = flowup(new Store());
    expect(log).nthCalledWith(++i, 'foo1', TraceState.creator_created);

    await flowed(store.foo1)();
    verify();

    expect(log).nthCalledWith(++i, 'foo1', TraceState.thread_start);
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Change the current thread pointer to [foo1].'
    );
    expect(log).nthCalledWith(++i, 'foo2', TraceState.creator_created);
    expect(log).nthCalledWith(++i, 'foo2', TraceState.thread_start);
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Change the current thread pointer to [foo2].'
    );
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Change the current thread pointer to [foo1].'
    );
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Clear the current thread pointer.'
    );
    expect(log).nthCalledWith(++i, 'foo2', TraceState.thread_completed);
    expect(log).nthCalledWith(++i, 'foo2', TraceState.thread_terminated);
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Change the current thread pointer to [foo1].'
    );
    expect(log).nthCalledWith(++i, 'foo1', TraceState.thread_canceled);
    expect(log).nthCalledWith(
      ++i,
      '[safe-flow] Clear the current thread pointer.'
    );
    expect(log).toBeCalledTimes(i);

    await delay(10);
    expect(log).nthCalledWith(
      ++i,
      'foo1',
      TraceState.thread_completed_canceled
    );
    expect(log).nthCalledWith(++i, 'foo1', TraceState.thread_terminated);
    expect(log).toBeCalledTimes(i);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  it('verify', async () => {
    verify();
    await delay(100);
    verify();
  });

  it('Turn off debug enable', async () => {
    __debug_enable(false);
    const [, done] = await flow(fetch)(1);
    expect(done).toBe(1);
    verify();
    expect(__debug_live_threads.length).toBe(0);
  });

  function immediately_after_the_main_thread_starts(
    method: CancelMethod,
    isTrace = true
  ) {
    if (isTrace) immediately_after_the_main_thread_starts(method, false);

    const name = (() => {
      switch (method) {
        case CancelMethod.cancelSelf:
          return 'cancel itself by cancelSelf';
        case CancelMethod.cancelToken:
          return 'cancel itself by token';
        case CancelMethod.cancelCreator:
          return 'cancel itself by creator';
        case CancelMethod.cancelAll:
          return 'cancel itself by cancelAll';
        default:
          throw new RangeError(`This parameter is not supported.`);
      }
    })();
    it(`${name}${isTrace ? ' with trace' : ''}`, async () => {
      // print = true;
      configure({ trace: isTrace });
      const func = jest.fn();

      const foo1 = flow(
        async (t: number) => {
          switch (method) {
            case CancelMethod.cancelSelf:
              cancelSelf('stop');
              break;
            case CancelMethod.cancelToken:
              cancel('token', 'stop');
              break;
            case CancelMethod.cancelCreator:
              cancel(foo1, 'stop');
              break;
            case CancelMethod.cancelAll:
              cancelAll('stop');
              break;
          }
          func();
          return t.toString();
        },
        { name: 'foo1', token: 'token' }
      );

      const [canceled] = await flowed(foo1)(5);
      verify();
      expect(canceled).toBeInstanceOf(Canceled);
      if (canceled) {
        expect(canceled.reason).toBe('stop');
      }
      expect(func).toBeCalledTimes(0);

      if (!isTrace) {
        expect(__debug_live_threads.length).toBe(0);
        return;
      }

      expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): canceled stop');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).toBeCalledTimes(i);
      expect(__debug_live_threads.length).toBe(1);
      await delay(10);
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] [foo1](1): completed (canceled)'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): terminated');
      expect(log).toBeCalledTimes(i);
      verify();
      expect(__debug_live_threads.length).toBe(0);
    });
  }

  function immediately_after_the_child_thread_ends(
    method: CancelMethod,
    isTrace = true
  ) {
    if (isTrace) immediately_after_the_child_thread_ends(method, false);

    const name = (() => {
      switch (method) {
        case CancelMethod.cancelSelf:
          return 'cancel itself by cancelSelf';
        case CancelMethod.cancelToken:
          return 'cancel itself by token';
        case CancelMethod.cancelCreator:
          return 'cancel itself by creator';
        case CancelMethod.cancelAll:
          return 'cancel itself by cancelAll';
        default:
          throw new RangeError(`This parameter is not supported.`);
      }
    })();
    it(`${name}${isTrace ? ' with trace' : ''}`, async () => {
      // print = true;
      configure({ trace: isTrace });
      const func = jest.fn();

      const foo1 = flow(
        async (t: number) => {
          await flow(fetch, { name: 'foo2' })('123');
          switch (method) {
            case CancelMethod.cancelSelf:
              cancelSelf('stop');
              break;
            case CancelMethod.cancelToken:
              cancel('token', 'stop');
              break;
            case CancelMethod.cancelCreator:
              cancel(foo1, 'stop');
              break;
            case CancelMethod.cancelAll:
              cancelAll('stop');
              break;
          }
          func();
          return t.toString();
        },
        { name: 'foo1', token: 'token' }
      );

      const [canceled] = await flowed(foo1)(5);
      verify();
      expect(canceled).toBeInstanceOf(Canceled);
      if (canceled) {
        expect(canceled.reason).toBe('stop');
      }
      expect(func).toBeCalledTimes(0);

      if (!isTrace) {
        expect(__debug_live_threads.length).toBe(0);
        return;
      }

      expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo2].'
      );
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2](1): completed 123');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2](1): terminated');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): canceled stop');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).toBeCalledTimes(i);
      expect(__debug_live_threads.length).toBe(1);
      await delay(10);
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] [foo1](1): completed (canceled)'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): terminated');
      expect(log).toBeCalledTimes(i);
      verify();
      expect(__debug_live_threads.length).toBe(0);
    });
  }

  function outside_the_thread(method: CancelMethod, isTrace = true) {
    if (isTrace) outside_the_thread(method, false);

    const name = (() => {
      switch (method) {
        case CancelMethod.cancelToken:
          return 'cancel itself by token';
        case CancelMethod.cancelCreator:
          return 'cancel itself by creator';
        case CancelMethod.cancelAll:
          return 'cancel itself by cancelAll';
        case CancelMethod.promiseCancel:
          return 'cancel itself by promise.cancel';
        default:
          throw new RangeError(`This parameter is not supported.`);
      }
    })();
    it(`${name}${isTrace ? ' with trace' : ''}`, async () => {
      // print = true;
      configure({ trace: isTrace });
      const func = jest.fn();

      const foo1 = flow(
        async (t: number) => {
          await flow(fetch, { name: 'foo2' })('123');
          func();
          return t.toString();
        },
        { name: 'foo1', token: 'token' }
      );

      const promise = flowed(foo1)(5);
      timeout(() => {
        switch (method) {
          case CancelMethod.cancelToken:
            cancel('token');
            break;
          case CancelMethod.cancelCreator:
            cancel(foo1);
            break;
          case CancelMethod.cancelAll:
            cancelAll();
            break;
          case CancelMethod.promiseCancel:
            promise.cancel();
            break;
        }
      }, 5);
      const [canceled] = await promise;
      verify();
      expect(canceled).toBeInstanceOf(Canceled);
      if (canceled) {
        expect(canceled.reason).toBeUndefined();
      }
      expect(func).toBeCalledTimes(0);

      if (!isTrace) {
        expect(__debug_live_threads.length).toBe(0);
        return;
      }

      expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo2].'
      );
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2](1): canceled');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): canceled');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(__debug_live_threads.length).toBe(2);
      await delay(1);
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] [foo1](1): completed (canceled)'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): terminated');
      expect(__debug_live_threads.length).toBe(1);
      await delay(10);
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] [foo2](1): completed (canceled) 123'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo2](1): terminated');
      expect(log).toBeCalledTimes(i);
      verify();
      expect(__debug_live_threads.length).toBe(0);
    });
  }

  function complete_a_thread(isTrace = true) {
    if (isTrace) complete_a_thread(false);

    it(`${isTrace ? ' with trace' : 'without trace'}`, async () => {
      // print = true;
      configure({ trace: isTrace });

      const foo1 = flow(delay, { name: 'foo1' });
      const [, done] = await foo1(5);
      expect(done).toBeUndefined();
      verify();
      expect(__debug_live_threads.length).toBe(0);

      if (!isTrace) {
        expect(__debug_live_threads.length).toBe(0);
        return;
      }

      expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): completed');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): terminated');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).toBeCalledTimes(i);
      verify();
      expect(__debug_live_threads.length).toBe(0);
    });
  }

  function complete_a_thread_return_values(isTrace = true) {
    if (isTrace) complete_a_thread_return_values(false);

    it(`return values${isTrace ? ' with trace' : ''}`, async () => {
      // print = true;
      configure({ trace: isTrace });

      const foo1 = flow(fetch, { name: 'foo1' });
      const [, done] = await foo1('123', 5);
      expect(done).toBe('123');
      verify();
      expect(__debug_live_threads.length).toBe(0);

      if (!isTrace) {
        expect(__debug_live_threads.length).toBe(0);
        return;
      }

      expect(log).nthCalledWith(++i, '[safe-flow] [foo1] Creator is created.');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): start');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Change the current thread pointer to [foo1].'
      );
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): completed 123');
      expect(log).nthCalledWith(++i, '[safe-flow] [foo1](1): terminated');
      expect(log).nthCalledWith(
        ++i,
        '[safe-flow] Clear the current thread pointer.'
      );
      expect(log).toBeCalledTimes(i);
      verify();
      expect(__debug_live_threads.length).toBe(0);
    });
  }
});
