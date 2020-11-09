export type Dictionary<T = any> = {
  [key: string]: T;
};

export type RequiredOmit<T, R extends keyof T> = Required<Omit<T, R>> &
  Pick<T, R>;
export type RequiredPick<T, R extends keyof T> = Omit<T, R> &
  Required<Pick<T, R>>;

export function isGeneratorFunction(value: any) {
  return (
    typeof value === 'function' &&
    (value.constructor.name === 'GeneratorFunction' ||
      value.toString().includes('return __generator'))
  );
}
