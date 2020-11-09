import { SafeCatched } from 'safe-catched';
import {
  flow,
  flowable,
  flowup,
  Canceled,
  cancel,
  flowed,
  cancelAll,
  FlowResult,
  safeFlow,
  configure,
  __debug_set_id,
  FlowState,
} from '../src';
import { isGeneratorFunction } from '../src/helper';
import {
  checkType,
  delay,
  error,
  fetch,
  FR,
  safeSimplify,
  SFR,
  simplify,
  verify,
} from './helper';

//mobx!!! next 要在 action中

describe('safe-flow', () => {
  it('isGeneratorFunction', async () => {
    expect(
      isGeneratorFunction(function* () {
        //
      })
    ).toBeTruthy();
    expect(
      isGeneratorFunction(() => {
        //
      })
    ).toBeFalsy();
    expect(isGeneratorFunction({})).toBeFalsy();
  });

  it('flow', async () => {
    class Store {
      foo1 = flow(function* () {
        yield delay(5);
        return yield fetch('foo1');
      });
      foo2 = function* () {
        yield delay(5);
        return yield fetch('foo2');
      };
    }
    const store = new Store();
    expect(await store.foo1()).toEqual([null, 'foo1']);
    expect(await flow(store.foo2)()).toEqual([null, 'foo2']);
    verify();
  });

  it('flowup', async () => {
    class Store {
      *foo1() {
        yield delay(5);
        return yield fetch('foo1');
      }

      @flowable
      *foo2() {
        yield delay(5);
        return yield fetch('foo2');
      }

      *foo3() {
        yield delay(5);
        return yield fetch('foo3');
      }
    }
    const store = new Store();
    flowup(store, { filter: (name) => name === 'foo1' });

    expect(isGeneratorFunction(store.foo1)).toBeFalsy();
    expect(isGeneratorFunction(store.foo2)).toBeFalsy();
    expect(isGeneratorFunction(store.foo3)).toBeTruthy();
    expect(await store.foo1()).toEqual([null, 'foo1']);
    expect(await store.foo2()).toEqual([null, 'foo2']);
    verify();

    expect(() => {
      flowup(store, {
        names: {
          foo4: true,
        },
      });
    }).toThrowError(
      '[safe-flow] The attribute "foo4" provided in the names option does not exist on the target to be flowed up.'
    );
  });

  it('flowable ES3', async () => {
    const foo1 = {
      f1: function* () {
        yield delay(5);
      },
    };
    flowable(foo1, 'f1');
    //@ts-expect-error
    expect(foo1.f1.__safe_flow_flowable).toBeTruthy();

    const foo2 = {
      f2: function* () {
        yield delay(5);
      },
    };
    flowable({})(foo2, 'f2');
    //@ts-expect-error
    expect(foo2.f2.__safe_flow_flowable).toBeTruthy();
  });

  it('standalone', async () => {
    const f1 = flow(
      function* () {
        yield delay(5);
      },
      { standalone: true }
    );

    await f1();
    await f1();
    verify();

    expect(
      safeSimplify(
        await Promise.all([safeFlow(f1()), safeFlow(f1()), safeFlow(f1())])
      )
    ).toEqual([SFR.fulfilled, SFR.error, SFR.error]);
    verify();
  });

  it('cancel', async () => {
    const func = jest.fn();
    class Store {
      _disposed = false;
      throw() {
        if (this._disposed) throw new Error('Error occurred!');
      }

      @flowable
      *foo(t: number) {
        func();
        yield delay(t);
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

    setTimeout(() => {
      store.dispose();
    }, 5);
    const [, canceled] = await safeFlow(flowed(store.foo)(10));
    expect(func).toBeCalledTimes(1);
    verify();
    expect(canceled).toBeInstanceOf(Canceled);
    if (canceled) {
      func.mockClear();
      const { thisArg, args, reason } = canceled;
      expect([thisArg, args, reason]).toStrictEqual([
        store,
        [10],
        { baz: 'baz' },
      ]);

      const [err] = await safeFlow(canceled.retry());
      expect(err).toEqual(new SafeCatched(new Error('Error occurred!')));
      expect(func).toBeCalledTimes(2);
      verify();
    }
  });

  it('cancel one of flows', async () => {
    const func = jest.fn();
    const f1 = flow(function* () {
      yield delay(10);
      func();
    });
    const f2 = flow(function* () {
      yield delay(10);
      func();
    });

    setTimeout(() => {
      cancel(f1);
    }, 5);
    expect(simplify(await Promise.all([f1(), f2()]))).toEqual([
      FR.canceled,
      FR.fulfilled,
    ]);
    expect(func).toBeCalledTimes(1);
    verify();
  });

  it('cancel by unused token or flow', async () => {
    cancel('unused token');

    const f1 = flow(function* () {
      return yield fetch('foo1');
    });
    cancel(f1);
  });

  it('cancel by token', async () => {
    class Store {
      @flowable
      *foo() {
        yield delay(10);
        return 'foo';
      }

      async bar() {
        return flow(function* () {
          yield delay(10);
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
      function* () {
        yield delay(10);
        return 'foo';
      },
      { token: store }
    );
    const f2 = flow(function* () {
      yield delay(10);
      return 'foo';
    });
    const f3 = flow(
      function* () {
        yield delay(10);
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

    const ms = 5;
    setTimeout(() => store.cancel(), ms);
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

    setTimeout(() => cancel(), ms);
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

    setTimeout(() => cancel('token'), ms);
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

    setTimeout(() => cancelAll(), ms);
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
  });

  it('cancel by run', async () => {
    const f1 = flow(function* () {
      yield delay(10);
      return 'foo';
    });

    expect(simplify(await Promise.all([f1(), f1(), f1()]))).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.fulfilled,
    ]);
    verify();

    setTimeout(() => cancel(f1), 5);
    expect(simplify(await Promise.all([f1(), f1(), f1()]))).toEqual([
      FR.canceled,
      FR.canceled,
      FR.canceled,
    ]);
    verify();

    setTimeout(() => cancelAll(), 5);
    expect(simplify(await Promise.all([f1(), f1(), f1()]))).toEqual([
      FR.canceled,
      FR.canceled,
      FR.canceled,
    ]);
    verify();
  });

  it('cancel in flow', async () => {
    const func = jest.fn();
    const f1 = flow(function* () {
      yield delay(10);
      func();
    });
    const f2 = flow(function* () {
      yield delay(10);
      func();
    });
    const f3 = flow(function* () {
      yield delay(5);
      cancelAll();
      func();
      throw Error('Error occurred!');
    });
    const f4 = flow(
      function* () {
        cancel('token');
        func();
        throw Error('Error occurred!');
      },
      { token: 'token' }
    );
    const f5 = flow(function* () {
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

    func.mockClear();
    expect(simplify(await Promise.all([f1(), f2(), f4()]))).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.canceled,
    ]);
    expect(func).toBeCalledTimes(2);
    verify();

    func.mockClear();
    expect(simplify(await Promise.all([f1(), f2(), f5()]))).toEqual([
      FR.fulfilled,
      FR.fulfilled,
      FR.canceled,
    ]);
    expect(func).toBeCalledTimes(2);
    verify();
  });

  it('cancel with reason', async () => {
    const f1 = flow(
      function* () {
        yield delay(10);
      },
      { token: 'token' }
    );

    setTimeout(() => {
      cancelAll('foo');
    }, 5);
    let [canceled] = await f1();
    if (canceled) expect(canceled.reason).toBe('foo');

    setTimeout(() => {
      cancel('token', 'foo');
    }, 5);
    [canceled] = await f1();
    if (canceled) expect(canceled.reason).toBe('foo');

    setTimeout(() => {
      cancel(f1, 'foo');
    }, 5);
    [canceled] = await f1();
    if (canceled) expect(canceled.reason).toBe('foo');
  });

  it('error validated', async () => {
    const f1 = () => undefined;
    //@ts-expect-error
    expect(() => flow(f1)).toThrowError(
      '[safe-flow] The target method is not a GeneratorFunction.'
    );

    try {
      class Store {
        @flowable
        async foo1() {
          return fetch('foo1');
        }
      }
      Store;
    } catch (error) {
      expect(error).toEqual(
        new Error('[safe-flow] Only GeneratorFunction can be flowable.')
      );
    }

    try {
      class Store2 {
        @flowable({ standalone: true })
        async foo2() {
          return fetch('foo2');
        }
      }
      Store2;
    } catch (error) {
      expect(error).toEqual(
        new Error('[safe-flow] Only GeneratorFunction can be flowable.')
      );
    }
  });

  it('error occurred', async () => {
    const func = jest.fn();
    const f1 = flow(function* () {
      try {
        throw new Error('Error occurred!');
      } catch (err) {
        return 'foo';
      }
    });
    let [, data] = (await f1()) as [unknown, any];
    expect(data).toBe('foo');
    expect(func).not.toBeCalled();
    verify();

    func.mockClear();
    const f2 = flow(function* () {
      try {
        yield error();
      } catch (err) {
        return 'foo';
      }
      func();
    });

    [, data] = await f2();
    expect(data).toBe('foo');
    expect(func).not.toBeCalled();
    verify();

    func.mockClear();
    const f3 = flow(function* () {
      try {
        yield error();
      } catch (err) {
        err;
      }
      func();
      yield delay(5);
      return 'foo';
    });

    [, data] = await f3();
    expect(data).toBe('foo');
    expect(func).toBeCalledTimes(1);
    verify();

    const f4 = flow(
      function* () {
        yield error(5);
      },
      { trace: true, standalone: true }
    );

    await safeFlow(f4());
    verify();
  });

  it('error in Parallel flows', async () => {
    const func = jest.fn();
    let i = 0;
    const f1 = flow(function* () {
      if (++i === 2) throw new Error('Error occurred!');
      yield delay(5);
      func();
    });
    const f2 = flow(function* () {
      yield delay(5);
      func();
    });

    expect(
      safeSimplify(
        await Promise.all([safeFlow(f1()), safeFlow(f1()), safeFlow(f2())])
      )
    ).toEqual([SFR.fulfilled, SFR.error, SFR.fulfilled]);
    expect(func).toBeCalledTimes(2);
    verify();
  });

  it('yield without promise', async () => {
    const f1 = flow(function* () {
      return yield 'foo';
    });

    const [, data] = await f1();
    expect(data).toBe('foo');
    verify();
  });

  it('type', async () => {
    class Store {
      @flowable
      *foo1(t: number) {
        yield delay(t);
        return 'foo1';
      }

      foo2 = flow(function* (t: number) {
        yield delay(t);
        return (yield fetch('foo2')) as string;
      });

      foo3 = flow(function* (t: number) {
        yield delay(t);
        return yield fetch('foo3');
      });
    }
    const store = new Store();

    checkType<FlowResult<string>>(await flowed(store.foo1)(5));
    checkType<FlowResult<string>>(await store.foo2(5));
    checkType<FlowResult<undefined>>(await store.foo3(5));
  });

  it('nested flow', async () => {
    const func1 = jest.fn();
    const func2 = jest.fn();
    const func3 = jest.fn();
    const func = jest.fn();

    class Store {
      @flowable
      *f1(t: number) {
        yield delay(t);
        func();
      }
    }
    const store = flowup(new Store());

    const f2 = flow(function* () {
      yield Promise.all([store.f1(5), delay(30)]);
      cancelAll();
      func1();
    });
    const f3 = flow(function* () {
      yield delay(10);
      yield f2();
      func2();
    });
    const f4 = flow(function* () {
      yield Promise.all([store.f1(50), f3(), f2()]);
      func3();
    });

    await f4();
    verify();
    expect(func).toBeCalledTimes(2);
    expect(func1).not.toBeCalled();
    expect(func2).not.toBeCalled();
    expect(func3).not.toBeCalled();
  });

  describe('trace', () => {
    let i = 0;
    const log = jest
      .spyOn(global.console, 'log')
      .mockImplementation(() => true);

    beforeEach(() => {
      configure();
      i = 0;
      log.mockClear();
      __debug_set_id();
    });

    it('uid', async () => {
      const f1 = flow(
        function* () {
          return yield 'foo';
        },
        { trace: true, name: 'f1' }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: created');

      __debug_set_id('00001');
      await f1();
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1](00001): start');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f1](00001): completed foo'
      );
      expect(console.log).toBeCalledTimes(i);

      __debug_set_id();
      await f1();
      verify();
      expect(console.log).not.nthCalledWith(
        ++i,
        '[safe-flow] [f1](00001): start'
      );
      expect(console.log).not.nthCalledWith(
        ++i,
        '[safe-flow] [f1](00001): completed foo'
      );
      expect(console.log).toBeCalledTimes(i);
      verify();
    });

    it('overwrite', async () => {
      configure({
        trace: true,
        standalone: true,
        filter: (name) => name === 'f005',
      });
      class Store {
        @flowable({ name: 'foo1', token: 'token' })
        *foo1() {
          yield delay(10);
        }

        *foo2() {
          yield delay(10);
        }

        @flowable({ name: 'f003', standalone: false })
        *foo3() {
          yield delay(10);
        }

        @flowable({ trace: false })
        *foo4() {
          yield delay(10);
        }

        @flowable
        *f005() {
          yield delay(10);
        }
      }
      const store = new Store();
      flowup(store, {
        filter: (name) => name.indexOf('foo') === 0,
        names: {
          foo2: true,
          foo3: 'foo3',
          foo4: true,
        },
      });
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo1]: created');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo2]: created');

      setTimeout(() => {
        cancel('token');
      }, 5);
      expect(
        safeSimplify(
          await Promise.all([
            safeFlow(flowed(store.foo1)()),
            safeFlow(flowed(store.foo2)()),
            safeFlow(flowed(store.foo2)()),
            (async () => {
              __debug_set_id('00001');
            })(),
            safeFlow(flowed(store.foo3)()),
            (async () => {
              __debug_set_id('00002');
            })(),
            safeFlow(flowed(store.foo3)()),
            (async () => {
              __debug_set_id();
            })(),
            safeFlow(flowed(store.foo4)()),
            safeFlow(flowed(store.f005)()),
          ])
        )
      ).toEqual([
        SFR.canceled,
        SFR.fulfilled,
        SFR.error,
        SFR.none,
        SFR.fulfilled,
        SFR.none,
        SFR.fulfilled,
        SFR.none,
        SFR.fulfilled,
        SFR.fulfilled,
      ]);
      verify();

      expect(console.log).nthCalledWith(++i, '[safe-flow] [f003]: created');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo1]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo1]: await-start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo2]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo2]: await-start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo2]: start');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [foo2]: error Error: [safe-flow] Standalone mode only allows one flow to run alone.'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00001): start'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00001): await-start'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00002): start'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00002): await-start'
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo1]: canceled');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [foo1]: await-ended (canceled)'
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo2]: await-ended');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [foo2]: completed');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00001): await-ended'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00001): completed'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00002): await-ended'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f003](00002): completed'
      );
      expect(console.log).toBeCalledTimes(i);
    });

    it('error', async () => {
      const f1 = flow(
        function* () {
          throw 123;
        },
        { trace: true, name: 'f1', standalone: true }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: created');

      await safeFlow(f1());
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: error 123');
      expect(console.log).toBeCalledTimes(i);

      const f2 = flow(
        function* () {
          yield delay(5);
          throw 123;
        },
        { trace: true, name: 'f2', standalone: true }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f2]: created');

      await safeFlow(f2());
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f2]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f2]: await-start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f2]: await-ended');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f2]: error 123');
      expect(console.log).toBeCalledTimes(i);

      const f3 = flow(
        function* () {
          try {
            yield error(5);
          } catch (error) {}
        },
        { trace: true, name: 'f3', standalone: true }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f3]: created');

      await safeFlow(f3());
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f3]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f3]: await-start');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f3]: await-ended (error)'
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f3]: completed');
      expect(console.log).toBeCalledTimes(i);

      const f4 = flow(
        function* () {
          yield error(5);
        },
        { trace: true, name: 'f4', standalone: true }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f4]: created');

      await safeFlow(f4());
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f4]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f4]: await-start');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f4]: await-ended (error)'
      );
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f4]: error Error: Error occurred!'
      );
      expect(console.log).toBeCalledTimes(i);
    });

    it('canceled', async () => {
      const f1 = flow(
        function* () {
          yield delay(10);
        },
        { trace: true, name: 'f1', standalone: true }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: created');

      setTimeout(() => {
        cancelAll('stop!');
      }, 5);
      await safeFlow(f1());
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: await-start');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f1]: canceled stop!'
      );
      expect(console.log).toBeCalledTimes(i);

      await delay(5);
      verify();
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f1]: await-ended (canceled)'
      );
      expect(console.log).toBeCalledTimes(i);
    });

    it('await', async () => {
      const f1 = flow(
        function* () {
          yield fetch('foo');
        },
        { trace: true, name: 'f1', standalone: true }
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: created');

      await safeFlow(f1());
      verify();
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: start');
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: await-start');
      expect(console.log).nthCalledWith(
        ++i,
        '[safe-flow] [f1]: await-ended foo'
      );
      expect(console.log).nthCalledWith(++i, '[safe-flow] [f1]: completed');
      expect(console.log).toBeCalledTimes(i);
    });

    it('customization', async () => {
      configure({
        trace: (event) => {
          console.log(event.name, event.state);
        },
        standalone: true,
      });
      class Store {
        @flowable({ name: 'foo1' })
        *foo1() {
          return 'foo1';
        }
      }
      const store = flowup(new Store());
      expect(console.log).nthCalledWith(++i, 'foo1', FlowState.created);

      await flowed(store.foo1)();
      verify();
      expect(console.log).nthCalledWith(++i, 'foo1', FlowState.start);
      expect(console.log).nthCalledWith(++i, 'foo1', FlowState.completed);
      expect(console.log).toBeCalledTimes(i);
    });
  });
});
