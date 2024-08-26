export function range(from: number, size: number) {
  return new Array(size).fill(0).map((_, i) => i + from)
}