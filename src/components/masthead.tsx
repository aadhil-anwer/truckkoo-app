/**
 * The document masthead. Every screen opens with it, which is what makes the
 * whole app read as one form rather than a set of pages.
 *
 * A printed consignment note carries the issuer at the top, a title, and a
 * strong rule closing the block. That is exactly this.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { align, t } from '@/i18n';
import { color, font, space } from '@/theme/tokens';

import { Rule } from './primitives';

export function Masthead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text style={styles.issuer}>{t('app.name').toUpperCase()}</Text>
        {action}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      </View>

      <Rule strong />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: space.sm },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.xl,
    minHeight: 32,
  },
  issuer: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    color: color.orange,
  },
  titleRow: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  // Weight 900, tight tracking — DESIGN.md §2's heading rule, unchanged.
  title: { ...font.hero, color: color.ink, textAlign: align.start },
});
