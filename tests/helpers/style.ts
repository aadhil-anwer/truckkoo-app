import { StyleSheet, type ViewStyle, type TextStyle, type ImageStyle } from 'react-native';

/**
 * Flatten a (possibly nested/array) RN style prop into a plain object typed for
 * property access in assertions.
 *
 * `StyleSheet.flatten` is typed to return the same shape as its input, which for
 * `unknown` narrows to `{}` — every property access on the result is then a type
 * error even though the value is fine at runtime. This gives tests a stable,
 * indexable shape without touching any assertion.
 */
export function flat(style: unknown): ViewStyle & TextStyle & ImageStyle & Record<string, unknown> {
  return (StyleSheet.flatten(style as never) ?? {}) as ViewStyle &
    TextStyle &
    ImageStyle &
    Record<string, unknown>;
}
