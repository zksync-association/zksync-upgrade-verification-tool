export function getFirstOrThrow<T>(value: T[]) {
  const firstValue = getFirst(value);
  if (firstValue === undefined) {
    throw new Error("First element is undefined");
  }
  return firstValue;
}

export function getFirst<T>(value: T[]) {
  return value[0];
}
