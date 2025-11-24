export function checkNotNull<T>(val: T, msg?: string): NonNullable<T> {
  if (val == null) throw new Error(msg || "Unexpected null value");
  return val as NonNullable<T>;
}
