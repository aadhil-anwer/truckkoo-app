import { render, screen, fireEvent } from '@testing-library/react-native';

import { PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/primitives';
import { color, font } from '@/theme/tokens';

describe('PrimaryButton', () => {
  it('renders its label and fires', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton label="Find me a truck" onPress={onPress} />);
    await fireEvent.press(screen.getByText('Find me a truck'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton label="Send me the code" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByText('Send me the code'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is exposed to assistive tech as a button, with its disabled state', async () => {
    await render(<PrimaryButton label="Accept" onPress={jest.fn()} disabled />);
    const node = screen.getByRole('button', { name: 'Accept' });
    expect(node.props.accessibilityState.disabled).toBe(true);
  });

  it('carries the accent on ink and ink on cream', async () => {
    const ink = await render(<PrimaryButton label="Go" onPress={jest.fn()} ground="ink" />);
    expect(ink.getByTestId('primary-surface').props.style).toEqual(
      expect.objectContaining({ backgroundColor: color.accent }),
    );
    await ink.unmount();

    const cream = await render(<PrimaryButton label="Go" onPress={jest.fn()} ground="cream" />);
    expect(cream.getByTestId('primary-surface').props.style).toEqual(
      expect.objectContaining({ backgroundColor: color.inkText }),
    );
  });

  it('uses the >=18.66px label token, which is an accessibility floor', async () => {
    await render(<PrimaryButton label="Accept 96 OMR" onPress={jest.fn()} />);
    const label = screen.getByText('Accept 96 OMR');
    expect(label.props.style).toEqual(
      expect.objectContaining({ fontSize: font.button.fontSize }),
    );
    expect(font.button.fontSize).toBeGreaterThanOrEqual(18.66);
  });

  it('does not fire while loading, so a commit cannot be double-posted', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton label="Accept 96 OMR" onPress={onPress} loading />);
    await fireEvent.press(screen.getByTestId('primary-surface'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('SecondaryButton', () => {
  it('renders and fires', async () => {
    const onPress = jest.fn();
    await render(<SecondaryButton label="Ask a question" onPress={onPress} />);
    await fireEvent.press(screen.getByText('Ask a question'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('TertiaryButton', () => {
  it('renders and fires', async () => {
    const onPress = jest.fn();
    await render(<TertiaryButton label="Skip — I do not know the weight" onPress={onPress} />);
    await fireEvent.press(screen.getByText('Skip — I do not know the weight'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
