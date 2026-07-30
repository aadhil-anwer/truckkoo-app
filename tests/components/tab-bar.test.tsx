/**
 * The bottom tab bar.
 *
 * REGRESSION, and the reason this file exists. The layout hid the other role's
 * tabs with expo-router's `href: null` shortcut, and the custom bar checked
 * `options.href` to decide what to skip. That check can never fire: expo-router
 * *consumes* `href`, rewriting it into `tabBarItemStyle` and a null
 * `tabBarButton` before descriptors are built. So nothing was hidden — a shipper
 * saw the driver's Offers and Routes tabs and two tabs both labelled "Home".
 *
 * It was caught by looking at a screenshot of the running app, not by a test,
 * and not by the type checker: `options.href` type-checks fine because the cast
 * that read it invented the field. That is the shape of bug this file is here to
 * stop — a navigator contract that is only observable at runtime.
 */

import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { BottomTabBarProps } from 'expo-router/tabs';

import { TabBar } from '@/components/tab-bar';
import { initLanguage } from '@/i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Options = {
  tabBarLabel?: string;
  tabBarItemStyle?: unknown;
  tabBarBadge?: number;
};

const mockNavigate = jest.fn();
const mockEmit = jest.fn(() => ({ defaultPrevented: false }));

/**
 * The smallest thing that satisfies `BottomTabBarProps`. Built by hand rather
 * than by mounting a real navigator: the point is to assert what the bar does
 * with a given descriptor, and a real navigator would decide that for us.
 */
function propsFor(screens: { name: string; options: Options }[], index = 0) {
  return {
    state: {
      index,
      routes: screens.map((s, i) => ({ key: `${s.name}-${i}`, name: s.name, params: undefined })),
    },
    descriptors: Object.fromEntries(
      screens.map((s, i) => [`${s.name}-${i}`, { options: s.options }]),
    ),
    navigation: { emit: mockEmit, navigate: mockNavigate },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    // Cast rather than construct: the real props carry a full navigation object
    // this bar never touches, and faking all of it would test the fake.
  } as unknown as BottomTabBarProps;
}

const shipperTabs = [
  { name: 'customer', options: { tabBarLabel: 'Home' } },
  { name: 'loads', options: { tabBarLabel: 'Loads' } },
  { name: 'driver', options: { tabBarLabel: 'Home', tabBarItemStyle: { display: 'none' } } },
  { name: 'offers', options: { tabBarLabel: 'Offers', tabBarItemStyle: { display: 'none' } } },
  { name: 'routes', options: { tabBarLabel: 'Routes', tabBarItemStyle: { display: 'none' } } },
  { name: 'account', options: { tabBarLabel: 'Account' } },
];

describe('TabBar', () => {
  it('renders only the tabs for the current role', async () => {
    await render(<TabBar {...propsFor(shipperTabs)} />);

    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByText('Loads')).toBeTruthy();
    expect(screen.getByText('Account')).toBeTruthy();
  });

  it('never shows two tabs with the same label', async () => {
    // The visible symptom of the bug: "Home" twice, one of them the driver's.
    await render(<TabBar {...propsFor(shipperTabs)} />);
    expect(screen.getAllByText('Home')).toHaveLength(1);
  });

  it('hides a tab whose style arrives as an array', async () => {
    // React Navigation may hand the style through as a composed array; a naive
    // `style.display` read would miss it.
    await render(
      <TabBar
        {...propsFor([
          { name: 'customer', options: { tabBarLabel: 'Home' } },
          {
            name: 'offers',
            options: { tabBarLabel: 'Offers', tabBarItemStyle: [{ flex: 1 }, { display: 'none' }] },
          },
        ])}
      />,
    );
    expect(screen.queryByText('Offers')).toBeNull();
  });

  it('marks the current tab as selected', async () => {
    await render(<TabBar {...propsFor(shipperTabs, 1)} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1].props.accessibilityState).toMatchObject({ selected: true });
    expect(tabs[0].props.accessibilityState).toMatchObject({ selected: false });
  });

  it('navigates on press, and not to the tab already showing', async () => {
    await render(<TabBar {...propsFor(shipperTabs, 0)} />);

    await fireEvent.press(screen.getByText('Loads'));
    expect(mockNavigate).toHaveBeenCalledWith('loads', undefined);

    mockNavigate.mockClear();
    await fireEvent.press(screen.getByText('Home'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('carries a badge count into the accessible name', async () => {
    // The badge is white on #f1551f — 3.47:1 — so the count must also exist
    // somewhere a screen reader and a contrast-blind user can reach.
    await render(
      <TabBar
        {...propsFor([{ name: 'offers', options: { tabBarLabel: 'Offers', tabBarBadge: 3 } }])}
      />,
    );
    expect(screen.getByLabelText('Offers, 3 new')).toBeTruthy();
  });

  it('renders no badge at zero', async () => {
    await render(
      <TabBar
        {...propsFor([{ name: 'offers', options: { tabBarLabel: 'Offers', tabBarBadge: 0 } }])}
      />,
    );
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('the floating tab bar', () => {
  afterEach(() => initLanguage('en'));

  it('renders a visible badge dot when a count is present', async () => {
    await render(
      <TabBar
        {...propsFor([{ name: 'offers', options: { tabBarLabel: 'Offers', tabBarBadge: 2 } }])}
      />,
    );
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders no visible badge when the count is absent or zero', async () => {
    await render(<TabBar {...propsFor(shipperTabs)} />);
    expect(screen.queryByText('0')).toBeNull();

    await render(
      <TabBar
        {...propsFor([{ name: 'offers', options: { tabBarLabel: 'Offers', tabBarBadge: 0 } }])}
      />,
    );
    expect(screen.queryByText('0')).toBeNull();
  });

  it('localises the visible badge count under Arabic — not vacuously', async () => {
    // The count is composed in JS (`${badge}` would be Latin regardless of
    // locale); Arabic-Indic digits can only appear here via `formatNumber`.
    initLanguage('ar');
    await render(
      <TabBar
        {...propsFor([{ name: 'offers', options: { tabBarLabel: 'Offers', tabBarBadge: 2 } }])}
      />,
    );
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.getByText('٢')).toBeTruthy();
  });

  it('exposes a badge count inside the tab label, not as a loose node', async () => {
    // A separate badge node is announced out of context — "2" with no referent.
    await render(
      <TabBar
        {...propsFor([{ name: 'offers', options: { tabBarLabel: 'Offers', tabBarBadge: 2 } }])}
      />,
    );
    expect(screen.getByLabelText('Offers, 2 new')).toBeTruthy();
  });

  it('marks the focused tab as selected for assistive tech', async () => {
    await render(<TabBar {...propsFor(shipperTabs, 0)} />);
    expect(screen.getByLabelText('Home').props.accessibilityState.selected).toBe(true);
  });

  it('gives every tab at least the 44pt target', async () => {
    await render(<TabBar {...propsFor(shipperTabs)} />);
    for (const tab of screen.getAllByRole('tab')) {
      const style = StyleSheet.flatten(tab.props.style) ?? {};
      expect(style.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
