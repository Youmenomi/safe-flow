export type Dictionary<T = any> = {
  [key: string]: T;
};

export type RequiredPick<T, R extends keyof T> = Omit<T, R> &
  Required<Pick<T, R>>;
