import { render, screen, fireEvent } from '@testing-library/react-native';

import { SelectRow, SelectCard } from '@/components/primitives';
import { color } from '@/theme/tokens';
import { flat } from '../helpers/style';

/**
 * Selection is signalled THREE ways at once — border, fill, and a filled radio.
 * The handoff calls this deliberate redundancy for reading in bright sun through
 * a windscreen. It looks like over-design in a code review, which is why it is
 * asserted here.
 */
describe('SelectRow selection signalling', () => {
  it('shows all three signals when selected', async () => {
    await render(
      <SelectRow title="Tomorrow" subtitle="Most trucks run this day" selected onPress={jest.fn()} />,
    );
    const surface = flat(screen.getByTestId('select-surface').props.style);

    // 1. border
    expect(surface.borderColor).toBe(color.accent);
    expect(surface.borderWidth).toBeGreaterThanOrEqual(2);
    // 2. fill
    expect(surface.backgroundColor).toBe(color.accentTint);
    // 3. the filled radio
    expect(screen.getByTestId('select-radio-dot')).toBeTruthy();
  });

  it('shows none of them when unselected', async () => {
    await render(<SelectRow title="Friday" selected={false} onPress={jest.fn()} />);
    const surface = flat(screen.getByTestId('select-surface').props.style);

    expect(surface.backgroundColor).not.toBe(color.accentTint);
    expect(surface.borderColor).not.toBe(color.accent);
    expect(screen.queryByTestId('select-radio-dot')).toBeNull();
  });

  it('reports its selected state to assistive tech', async () => {
    await render(<SelectRow title="Tomorrow" selected onPress={jest.fn()} />);
    const node = screen.getByRole('radio', { name: /Tomorrow/ });
    expect(node.props.accessibilityState.selected).toBe(true);
  });

  it('fires on press', async () => {
    const onPress = jest.fn();
    await render(<SelectRow title="Friday" selected={false} onPress={onPress} />);
    await fireEvent.press(screen.getByTestId('select-surface'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

/**
 * SelectCard is the larger two-up choice. The three-signal rule is the entire
 * point of this task, so it applies here too, not just to SelectRow.
 */
describe('SelectCard selection signalling', () => {
  it('shows all three signals when selected', async () => {
    await render(
      <SelectCard
        title="Full load"
        body="One shipper, one truck"
        icon="truck"
        selected
        onPress={jest.fn()}
      />,
    );
    const surface = flat(screen.getByTestId('select-surface').props.style);

    // 1. border
    expect(surface.borderColor).toBe(color.accent);
    expect(surface.borderWidth).toBeGreaterThanOrEqual(2);
    // 2. fill
    expect(surface.backgroundColor).toBe(color.accentTint);
    // 3. the filled radio
    expect(screen.getByTestId('select-radio-dot')).toBeTruthy();
  });

  it('shows none of them when unselected', async () => {
    await render(
      <SelectCard
        title="Part load"
        body="Shared with other cargo"
        icon="truck"
        selected={false}
        onPress={jest.fn()}
      />,
    );
    const surface = flat(screen.getByTestId('select-surface').props.style);

    expect(surface.backgroundColor).not.toBe(color.accentTint);
    expect(surface.borderColor).not.toBe(color.accent);
    expect(screen.queryByTestId('select-radio-dot')).toBeNull();
  });

  it('reports its selected state to assistive tech', async () => {
    await render(
      <SelectCard title="Full load" body="One shipper" icon="truck" selected onPress={jest.fn()} />,
    );
    const node = screen.getByRole('radio', { name: /Full load/ });
    expect(node.props.accessibilityState.selected).toBe(true);
  });

  it('fires on press', async () => {
    const onPress = jest.fn();
    await render(
      <SelectCard
        title="Part load"
        body="Shared with other cargo"
        icon="truck"
        selected={false}
        onPress={onPress}
      />,
    );
    await fireEvent.press(screen.getByTestId('select-surface'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
