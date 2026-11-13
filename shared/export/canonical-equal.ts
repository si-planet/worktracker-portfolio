import { ExportError } from '../schema/export-dataset';
import { compareCodeUnits } from './dataset';

/** Same JSON domain and ordering as canonicalJson, without materializing either JSON string. */
export function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftActive = new Set<object>(),
    rightActive = new Set<object>();
  const invalid = (): never => {
    throw new ExportError('DATASET_CORRUPT');
  };
  function keys(value: object): string[] {
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (!array && proto !== Object.prototype && proto !== null) invalid();
    if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) invalid();
    const result = Object.keys(value);
    if (array && (result.length !== value.length || result.some((key, i) => key !== String(i))))
      invalid();
    for (const key of result) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    }
    return array ? result : result.sort(compareCodeUnits);
  }
  function primitive(v: unknown) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
    if (typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0)) return;
    if (typeof v !== 'object') invalid();
  }

  function walk(a: unknown, b: unknown): boolean {
    primitive(a);
    primitive(b);
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (leftActive.has(a) || rightActive.has(b)) invalid();
    const ak = keys(a),
      bk = keys(b);
    if (Array.isArray(a) !== Array.isArray(b) || ak.length !== bk.length) return false;
    leftActive.add(a);
    rightActive.add(b);
    for (let i = 0; i < ak.length; i++) {
      const key = ak[i]!;
      if (
        key !== bk[i] ||
        !walk(
          Object.getOwnPropertyDescriptor(a, key)!.value,
          Object.getOwnPropertyDescriptor(b, key)!.value,
        )
      )
        return false;
    }
    leftActive.delete(a);
    rightActive.delete(b);
    return true;
  }
  return walk(left, right);
}
