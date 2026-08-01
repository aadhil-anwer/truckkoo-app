import { render, screen, fireEvent } from '@testing-library/react-native';

import { PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/primitives';
import { DetailGroup, DetailRow, Segmented } from '@/components/ui';
import { initLanguage } from '@/i18n';
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

describe('Segmented', () => {
  const options = [
    { value: 'live', label: 'Moving', count: 2 },
    { value: 'past', label: 'Finished', count: 1 },
  ];

  afterEach(() => initLanguage('en'));

  it('puts the count in the visible label', async () => {
    await render(<Segmented options={options} value="live" onChange={() => {}} />);
    expect(screen.getByText('Moving (2)')).toBeTruthy();
  });

  it('announces the count with its referent, never as a loose number', async () => {
    // A bare "2" is read out with nothing to attach it to.
    await render(<Segmented options={options} value="live" onChange={() => {}} />);
    expect(screen.getByLabelText('Moving, 2')).toBeTruthy();
  });

  it('marks the active segment selected', async () => {
    await render(<Segmented options={options} value="live" onChange={() => {}} />);
    expect(screen.getByLabelText('Moving, 2').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Finished, 1').props.accessibilityState.selected).toBe(false);
  });

  it('renders the count in Arabic-Indic digits in Arabic', async () => {
    initLanguage('ar');
    await render(<Segmented options={options} value="live" onChange={() => {}} />);
    expect(screen.getByText('Moving (٢)')).toBeTruthy();
  });

  it('reports a tap', async () => {
    const onChange = jest.fn();
    await render(<Segmented options={options} value="live" onChange={onChange} />);
    fireEvent.press(screen.getByLabelText('Finished, 1'));
    expect(onChange).toHaveBeenCalledWith('past');
  });
});

describe('DetailRow', () => {
  it('shows a chevron only when it goes somewhere', async () => {
    const plain = await render(<DetailRow label="Mobile" value="+968 …" />);
    expect(plain.queryByTestId('detail-chevron')).toBeNull();

    const tappable = await render(
      <DetailRow label="Language" value="English" onPress={() => {}} />,
    );
    expect(tappable.queryByTestId('detail-chevron')).toBeTruthy();
  });

  it('announces label and value together', async () => {
    // "English" alone tells a screen reader nothing about what is English.
    await render(<DetailRow label="Language" value="English" onPress={() => {}} />);
    expect(screen.getByLabelText('Language, English')).toBeTruthy();
  });

  it('renders a value that does not act', async () => {
    await render(<DetailRow label="Mobile" value="+968 …" />);
    expect(screen.getByText('Mobile')).toBeTruthy();
    expect(screen.getByText('+968 …')).toBeTruthy();
  });
});

describe('DetailGroup', () => {
  it('divides rows with a hairline but does not rule the last one', async () => {
    // A rule under the final row reads as a border and makes one card look like
    // several.
    await render(
      <DetailGroup label="YOUR DETAILS">
        <DetailRow label="a" value="1" />
        <DetailRow label="b" value="2" />
        <DetailRow label="c" value="3" />
      </DetailGroup>,
    );
    expect(screen.getAllByTestId('detail-divider')).toHaveLength(2);
  });

  it('does not divide a single row at all', async () => {
    await render(
      <DetailGroup label="YOUR DETAILS">
        <DetailRow label="a" value="1" />
      </DetailGroup>,
    );
    expect(screen.queryByTestId('detail-divider')).toBeNull();
  });
});
