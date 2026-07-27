/**
 * THESIS: The two home screens are the driver's docket book, not a feed. Freight
 * already runs on a bound book of numbered sheets with printed tabs down the
 * side — one sheet per job, turned one at a time. This refuses the scrolling
 * card-stack every logistics app ships, where the day arrives as an undifferen-
 * tiated column and the thing needing a decision is whichever card you happen to
 * stop on.
 *
 * OWN-WORLD: Inherited from the consignment note (see primitives.tsx) and
 * unchanged — white paper, near-black ink, hairline #e8e8e8 rules, one orange
 * for the live stamp and the single primary action. The book adds exactly two
 * devices: a printed tab strip that is the index, and the visible edge of the
 * next sheet at the trailing margin.
 *
 * STORY: One decision fills the screen. The tabs say what else exists and how
 * much of it. The paper edge says there is another sheet. Nothing is hidden by
 * being below a fold, because there is no fold.
 *
 * FIRST VIEWPORT: Masthead rule, then the tab strip, then one full-width sheet
 * carrying its route pair at 22pt and its own action — with a 12pt sliver of the
 * next sheet showing at the end margin.
 *
 * FORM: Waybill book; candidate 7 of 7 on the grounded list (ledger, carbon
 * split, action queue, timeline rail, hero stack, pigeonhole, book); seed key
 * 94165cb3 (surface / operate), staging: the book's own page turn.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';

import { align, formatNumber, t } from '@/i18n';
import { color, doc, MIN_TARGET, motion, space } from '@/theme/tokens';

import { Rule } from './primitives';

/** A printed tab on the book's edge. One per section, never per sheet. */
export type BookSection = {
  key: string;
  label: string;
  /** Shown beside the label. Omit for sections where a count means nothing. */
  count?: number;
};

/** One sheet. Always exactly one document — never a list of cards. */
export type BookSheet = {
  key: string;
  sectionKey: string;
  /** True when this sheet carries its own orange action, so the pinned bar steps down. */
  hasPrimary?: boolean;
  render: () => ReactNode;
};

/**
 * How much of the next sheet shows past the current one. Small enough to read as
 * a page edge rather than a second column, large enough to be unmistakably
 * another piece of paper — this sliver is the whole "there is more" affordance
 * for someone who will never think to swipe.
 */
const PEEK = 12;

/** Module-level so its identity is stable across renders, as FlatList requires. */
const VIEWABILITY = { itemVisiblePercentThreshold: 55 };

/**
 * Lets a screen turn the book itself. The one caller that needs it is accepting
 * an offer: that sheet ceases to exist and the driver has to land somewhere
 * deliberate — on the trip they just took — rather than wherever the list
 * happens to collapse to.
 */
export type BookHandle = { goToSection: (sectionKey: string) => void };

type BookProps = {
  sections: BookSection[];
  sheets: BookSheet[];
  /** Pinned action bar. Receives whether the visible sheet already owns the orange. */
  footer?: (ctx: { sheetHasPrimary: boolean }) => ReactNode;
  refreshing?: boolean;
  /**
   * Pull-to-refresh lives on each sheet's own vertical scroller rather than on
   * the pager. On patchy signal a driver will pull down on whatever is in front
   * of them, and that is always a sheet.
   */
  onRefresh?: () => void;
};

export const WaybillBook = forwardRef<BookHandle, BookProps>(function WaybillBook(
  { sections, sheets, footer, refreshing = false, onRefresh },
  ref,
) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<BookSheet>>(null);
  const [current, setCurrent] = useState(0);

  const gutter = space.xl;
  const sheetWidth = Math.max(240, width - gutter * 2 - PEEK);
  const stride = sheetWidth + space.md;

  // Index comes from viewability, not from contentOffset arithmetic. Pixel maths
  // is the thing that breaks under RTL — the scroll origin moves to the other
  // edge and every platform reports it slightly differently. Item indices do not
  // move, so direction never enters the calculation.
  // Identity must be stable — FlatList throws if this prop changes after mount.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setCurrent(first.index);
  }, []);

  const reduce = useReduceMotion();

  const goToSection = useCallback(
    (sectionKey: string) => {
      const target = sheets.findIndex((s) => s.sectionKey === sectionKey);
      if (target < 0) return;
      // `viewOffset` accounts for the leading gutter, so the sheet lands with its
      // ruled edge on the margin rather than flush against the screen.
      listRef.current?.scrollToIndex({ index: target, animated: !reduce, viewOffset: gutter });
    },
    [sheets, reduce, gutter],
  );

  useImperativeHandle(ref, () => ({ goToSection }), [goToSection]);

  // Accepting or declining an offer removes a sheet, so the last-reported index
  // can point past the end of the book for a frame. Unclamped, that lights up
  // the wrong tab for whatever is actually on screen.
  const shown = Math.min(current, Math.max(0, sheets.length - 1));
  const activeSection = sheets[shown]?.sectionKey ?? sections[0]?.key;

  // A single-sheet book has nothing to index, and a tab strip over one tab is
  // furniture. First-run drivers and shippers see one sheet and no chrome.
  const showTabs = sections.length > 1;

  const sectionSheets = sheets.filter((s) => s.sectionKey === activeSection);
  const withinSection = sectionSheets.findIndex((s) => s.key === sheets[shown]?.key) + 1;

  return (
    <View style={styles.book}>
      {showTabs && (
        <TabStrip sections={sections} active={activeSection} onPress={goToSection} />
      )}

      <FlatList
        ref={listRef}
        data={sheets}
        keyExtractor={(s) => s.key}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={stride}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        // Logical properties, never left/right (CLAUDE.md §4). The trailing side
        // carries an extra PEEK so the final sheet can still reach its snap
        // position instead of stopping a sliver short of the margin.
        contentContainerStyle={{
          paddingStart: gutter,
          paddingEnd: gutter + PEEK,
          gap: space.md,
        }}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
        // Sheets are heavy and few. Keeping them all mounted means a page turn is
        // instant on the cheap Android hardware this is built for.
        initialNumToRender={4}
        windowSize={5}
        // Position in content coordinates, so it includes the leading gutter;
        // `scrollToIndex` subtracts it back out via `viewOffset`.
        getItemLayout={(_, i) => ({ length: stride, offset: gutter + stride * i, index: i })}
        renderItem={({ item }) => (
          <View style={{ width: sheetWidth }}>
            <ScrollView
              contentContainerStyle={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              refreshControl={
                onRefresh ? (
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor={color.orange}
                  />
                ) : undefined
              }
            >
              {item.render()}
            </ScrollView>
          </View>
        )}
      />

      {sectionSheets.length > 1 && (
        <Text style={styles.sheetCount} accessibilityLiveRegion="polite">
          {`${t('book.sheet').toUpperCase()} ${formatNumber(withinSection)} / ${formatNumber(
            sectionSheets.length,
          )}`}
        </Text>
      )}

      {footer?.({ sheetHasPrimary: !!sheets[shown]?.hasPrimary })}
    </View>
  );
});

/* ─── the printed tab strip ──────────────────────────────────────────────── */

/**
 * The book's index. Reads as printed tabs, not as a segmented control: labels
 * sit on the page, and the active one is underscored by the same 2px rule that
 * closes a masthead. Depth stays in the borders (DESIGN.md §3) — no pill, no
 * fill, no shadow.
 */
function TabStrip({
  sections,
  active,
  onPress,
}: {
  sections: BookSection[];
  active?: string;
  onPress: (key: string) => void;
}) {
  return (
    <View accessibilityRole="tablist">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {sections.map((s) => {
          const on = s.key === active;
          return (
            <Pressable
              key={s.key}
              onPress={() => onPress(s.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                s.count == null ? s.label : `${s.label}, ${formatNumber(s.count)}`
              }
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
            >
              <View style={styles.tabInner}>
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]} numberOfLines={1}>
                  {s.label.toUpperCase()}
                </Text>
                {s.count != null && s.count > 0 && (
                  <Text style={[styles.tabCount, on && styles.tabCountOn]}>
                    {formatNumber(s.count)}
                  </Text>
                )}
              </View>
              <TabRule on={on} />
            </Pressable>
          );
        })}
      </ScrollView>
      <Rule />
    </View>
  );
}

/**
 * The one authored motion in the book: the tab's rule inks in when it becomes
 * current, at the same 180ms the rest of the app uses for interactive change.
 * Everything else is the platform's own page snap.
 */
function TabRule({ on }: { on: boolean }) {
  const reduce = useReduceMotion();
  // `useState` initializer, not `useRef().current` — the latter reads a ref
  // during render, which React 19 flags as a real hazard.
  const [progress] = useState(() => new Animated.Value(on ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(on ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: on ? 1 : 0,
      duration: motion.interactive,
      useNativeDriver: false,
    }).start();
  }, [on, reduce, progress]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tabRule,
        {
          backgroundColor: on ? color.orange : color.line,
          height: progress.interpolate({ inputRange: [0, 1], outputRange: [doc.rule, doc.ruleStrong] }),
        },
      ]}
    />
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

const styles = StyleSheet.create({
  book: { flex: 1 },

  tabs: { paddingHorizontal: space.xl, gap: space.lg, alignItems: 'flex-end' },
  tab: { minHeight: MIN_TARGET, justifyContent: 'flex-end' },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingBottom: space.xs,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: color.inkSoft,
    textAlign: align.start,
  },
  tabLabelOn: { color: color.ink },
  tabCount: {
    ...doc.reference,
    color: color.inkSoft,
    minWidth: 18,
    textAlign: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: doc.rule,
    borderColor: color.line,
    overflow: 'hidden',
  },
  /**
   * Ink on paper with an orange rim, not white on an orange fill.
   *
   * The filled version put 12px white on `#f1551f` — 3.47:1, well under the 4.5:1
   * AA needs for text this size, and it is a *count*, so it is the one thing here
   * that must be read exactly rather than recognised. It also spent a second
   * orange on a screen that already has the active tab rule; the rim keeps the
   * active state legible without adding another filled accent.
   */
  tabCountOn: { color: color.ink, borderColor: color.orange },
  tabRule: { alignSelf: 'stretch' },

  sheetScroll: { paddingTop: space.xl, paddingBottom: space.xl },

  sheetCount: {
    ...doc.reference,
    color: color.inkSoft,
    textAlign: 'center',
    paddingBottom: space.sm,
  },
});
