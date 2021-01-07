export type RequiredPick<T, R extends keyof T> = Omit<T, R> &
  Required<Pick<T, R>>;
