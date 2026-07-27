/**
 * Shared primitives — accessibility and state.
 *
 * The tap-target tests are not box-ticking. This app is used one-handed, in
 * gloves, in a moving truck cab: a 16pt target is not a smaller button, it is an
 * unusable one. `TextButton` exists specifically because `<Text onPress>` looks
 * identical on screen and ships a ~16pt target, and these tests are what stop it
 * regressing back.
 *
 * `render` and `fireEvent.press` both return Promises in
 * @testing-library/react-native v14 and must be awaited. Forgetting the await
 * does not fail loudly — `screen` simply reports that render was never called.
 */

import { render, screen, fireEvent } from '@testing-library/react-native';

import { Button, Choice, Input, Stamp, TextButton } from '@/components/primitives';
import { MIN_TARGET } from '@/theme/tokens';

/** Flatten RN's array-or-object style prop into one object. */
function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const s = node.props.style;
  const flat = Array.isArray(s) ? (s as unknown[]).flat(Infinity) : [s];
  return Object.assign({}, ...flat.filter(Boolean));
}

describe('Button', () => {
  it('clears the 44pt minimum target', async () => {
    await render(<Button label="Accept this load" onPress={() => {}} />);
    const style = styleOf(screen.getByRole('button'));
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('exposes its label to a screen reader', async () => {
    await render(<Button label="Accept this load" onPress={() => {}} />);
    expect(screen.getByLabelText('Accept this load')).toBeTruthy();
  });

  it('fires onPress', async () => {
    const onPress = jest.fn();
    await render(<Button label="Go" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Go" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire while loading — a double-tap must not double-submit', async () => {
    // Accepting the same offer twice is a real dispatch problem, not a UI glitch.
    const onPress = jest.fn();
    await render(<Button label="Go" onPress={onPress} loading />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('announces disabled and busy state', async () => {
    await render(<Button label="Go" onPress={() => {}} loading />);
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });

  it('hides the label while loading but keeps the accessible name', async () => {
    await render(<Button label="Sending" onPress={() => {}} loading />);
    expect(screen.queryByText('Sending')).toBeNull();
    expect(screen.getByLabelText('Sending')).toBeTruthy();
  });
});

describe('TextButton', () => {
  it('clears the 44pt minimum — the whole reason it exists', async () => {
    await render(<TextButton label="Back" onPress={() => {}} />);
    const style = styleOf(screen.getByRole('button'));
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('is announced as a button, not as text', async () => {
    await render(<TextButton label="Sign out" onPress={() => {}} />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('fires onPress', async () => {
    const onPress = jest.fn();
    await render(<TextButton label="Back" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Choice', () => {
  it('is announced as a radio with its selected state', async () => {
    await render(<Choice title="Empty" selected onPress={() => {}} />);
    expect(screen.getByRole('radio').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('folds the detail line into one accessible sentence', async () => {
    // Otherwise a screen reader reads two disconnected fragments.
    await render(
      <Choice title="I drive a truck" detail="Tell us your routes" selected={false} onPress={() => {}} />,
    );
    expect(screen.getByLabelText('I drive a truck. Tell us your routes')).toBeTruthy();
  });

  it('makes the whole row the target, not a small dot', async () => {
    await render(<Choice title="Empty" selected={false} onPress={() => {}} />);
    const style = styleOf(screen.getByRole('radio'));
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('fires onPress from anywhere in the row', async () => {
    const onPress = jest.fn();
    await render(<Choice title="Empty" selected={false} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('radio'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Stamp', () => {
  it('renders its text uppercased', async () => {
    await render(<Stamp tone="active">On the road</Stamp>);
    expect(screen.getByText('ON THE ROAD')).toBeTruthy();
  });

  // One render per tone rather than a loop with manual `unmount`. Unmounting and
  // re-rendering inside a single test overlaps React's act() calls, which left
  // the renderer broken for every test that followed in this file.
  it.each(['pending', 'active', 'done', 'stopped'] as const)('renders the %s tone', async (tone) => {
    await render(<Stamp tone={tone}>Status</Stamp>);
    expect(screen.getByText('STATUS')).toBeTruthy();
  });
});

describe('Input', () => {
  it('shows the error text when it carries an error', async () => {
    await render(<Input value="" onChangeText={() => {}} error="Please fill this in." />);
    expect(screen.getByText('Please fill this in.')).toBeTruthy();
  });

  it('announces the error politely rather than interrupting', async () => {
    await render(<Input value="" onChangeText={() => {}} error="Please fill this in." />);
    expect(screen.getByText('Please fill this in.').props.accessibilityLiveRegion).toBe('polite');
  });

  it('renders no error node when there is no error', async () => {
    await render(<Input value="x" onChangeText={() => {}} />);
    expect(screen.queryByText(/Please/)).toBeNull();
  });

  it('clears the 44pt minimum', async () => {
    await render(<Input value="" onChangeText={() => {}} placeholder="e.g. Muscat" />);
    const style = styleOf(screen.getByPlaceholderText('e.g. Muscat'));
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(MIN_TARGET);
  });
});
