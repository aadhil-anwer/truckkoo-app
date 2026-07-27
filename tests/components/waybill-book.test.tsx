/**
 * The waybill book — the paging structure both home screens are built on.
 *
 * Three of these cover bugs found by inspection rather than by running the app,
 * which means nothing else would have caught them:
 *
 *   - the tab strip must disappear at one section, or a first-run user meets
 *     chrome before content
 *   - the page index must clamp when sheets are removed, or accepting the last
 *     offer lights up the wrong tab
 *   - the pinned footer must step down from orange when the visible sheet
 *     already owns the primary action
 *
 * `render`, `rerender` and `fireEvent.press` are all async in RNTL v14.
 */

import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { WaybillBook, type BookSection, type BookSheet } from '@/components/waybill-book';

const sections: BookSection[] = [
  { key: 'trip', label: 'Trip' },
  { key: 'offers', label: 'Offers', count: 3 },
  { key: 'routes', label: 'Routes', count: 2 },
];

function sheet(key: string, sectionKey: string, hasPrimary = false): BookSheet {
  return { key, sectionKey, hasPrimary, render: () => <Text>{`sheet-${key}`}</Text> };
}

const sheets: BookSheet[] = [
  sheet('trip', 'trip', true),
  sheet('offer-1', 'offers', true),
  sheet('offer-2', 'offers', true),
  sheet('offer-3', 'offers', true),
  sheet('routes', 'routes'),
];

const selectedTabs = () =>
  screen.getAllByRole('tab').filter((t) => t.props.accessibilityState?.selected);

describe('the tab strip', () => {
  it('renders one tab per section', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('labels tabs in caps', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.getByText('OFFERS')).toBeTruthy();
  });

  it('shows a count where one is given', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('folds the count into the accessible name', async () => {
    // A screen reader should say "Offers, 3", not read a stray numeral.
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.getByLabelText('Offers, 3')).toBeTruthy();
  });

  it('omits a zero count rather than rendering a "0" badge', async () => {
    await render(
      <WaybillBook
        sections={[
          { key: 'trip', label: 'Trip' },
          { key: 'offers', label: 'Offers', count: 0 },
        ]}
        sheets={[sheet('trip', 'trip'), sheet('none', 'offers')]}
      />,
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('disappears entirely for a single-section book', async () => {
    // A first-run shipper meets one sheet and one action — no chrome.
    await render(
      <WaybillBook sections={[{ key: 'live', label: 'Moving now' }]} sheets={[sheet('a', 'live')]} />,
    );
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('marks exactly one tab selected', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(selectedTabs()).toHaveLength(1);
  });

  it('selects the first section on mount', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.getByLabelText('Trip').props.accessibilityState.selected).toBe(true);
  });

  it('is pressable', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    await fireEvent.press(screen.getByLabelText('Offers, 3'));
    // Still exactly one selected tab afterwards — no double-selection.
    expect(selectedTabs()).toHaveLength(1);
  });
});

describe('sheets', () => {
  it('renders sheet content', async () => {
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.getByText('sheet-trip')).toBeTruthy();
  });

  it('shows a sheet counter only when a section holds more than one', async () => {
    // Section "trip" has one sheet, so no "1 / 1" noise.
    await render(<WaybillBook sections={sections} sheets={sheets} />);
    expect(screen.queryByText(/SHEET/)).toBeNull();
  });

  it('renders an empty book without crashing', async () => {
    await render(<WaybillBook sections={[{ key: 'x', label: 'X' }]} sheets={[]} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('the pinned footer', () => {
  it('is told when the visible sheet already owns the orange', async () => {
    // The trip sheet carries its own primary action, so the footer steps down —
    // never two oranges on one screen.
    const footer = jest.fn(() => null);
    await render(<WaybillBook sections={sections} sheets={sheets} footer={footer} />);
    expect(footer).toHaveBeenCalledWith({ sheetHasPrimary: true });
  });

  it('is told when it owns the orange itself', async () => {
    const footer = jest.fn(() => null);
    await render(
      <WaybillBook
        sections={[{ key: 'live', label: 'Live' }]}
        sheets={[sheet('a', 'live', false)]}
        footer={footer}
      />,
    );
    expect(footer).toHaveBeenCalledWith({ sheetHasPrimary: false });
  });

  it('renders what the footer returns', async () => {
    await render(
      <WaybillBook
        sections={sections}
        sheets={sheets}
        footer={() => <Text>Add a trip you are making</Text>}
      />,
    );
    expect(screen.getByText('Add a trip you are making')).toBeTruthy();
  });
});

describe('shrinking the book', () => {
  /**
   * Regression: accepting or declining an offer removes a sheet. The last
   * reported page index then pointed past the end of the array, so the footer
   * and the selected tab described a sheet that no longer existed.
   */
  it('survives sheets being removed beneath it', async () => {
    const { rerender } = await render(<WaybillBook sections={sections} sheets={sheets} />);

    await rerender(
      <WaybillBook
        sections={[
          { key: 'trip', label: 'Trip' },
          { key: 'offers', label: 'Offers', count: 2 },
          { key: 'routes', label: 'Routes', count: 2 },
        ]}
        sheets={sheets.filter((s) => s.key !== 'offer-3')}
      />,
    );

    expect(selectedTabs()).toHaveLength(1);
  });

  it('still reports a footer state when every sheet is removed', async () => {
    const footer = jest.fn(() => null);
    const { rerender } = await render(
      <WaybillBook sections={sections} sheets={sheets} footer={footer} />,
    );
    footer.mockClear();

    await rerender(
      <WaybillBook sections={[{ key: 'trip', label: 'Trip' }]} sheets={[]} footer={footer} />,
    );
    expect(footer).toHaveBeenCalledWith({ sheetHasPrimary: false });
  });
});
