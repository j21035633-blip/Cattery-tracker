import { StyleSheet, Text, View } from "react-native";

import { formatWeight } from "@/lib/format";
import type { WeightLog } from "@/lib/types";
import { colors, radius, spacing } from "@/theme";

/**
 * Weight trend drawn with plain Views.
 *
 * react-native-svg would be the obvious tool, but a bar chart of this size does
 * not justify the extra native dependency in an EAS build — flex heights give
 * the same reading and cost nothing.
 */
export function WeightChart({ logs }: { logs: WeightLog[] }) {
  // The API returns newest first; a chart reads left to right in time order.
  const points = [...logs]
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
    // Keep the most recent 12 so the bars stay wide enough to touch.
    .slice(-12);

  if (points.length < 2) {
    return (
      <Text style={styles.placeholder}>
        Two or more measurements are needed to draw a trend.
      </Text>
    );
  }

  const values = points.map((point) => point.weight_grams);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; give it a 100 g band to sit inside.
  const span = max - min || 100;

  return (
    <View>
      <View style={styles.chart} accessibilityRole="image">
        {points.map((point) => {
          // Floor at 12% so the lightest reading is still a visible bar.
          const ratio = 0.12 + ((point.weight_grams - min) / span) * 0.88;
          return (
            <View key={point.id} style={styles.barSlot}>
              <View style={[styles.bar, { height: `${ratio * 100}%` }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisLabel}>
          {new Date(points[0].measured_at).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}
        </Text>
        <Text style={styles.axisLabel}>
          {formatWeight(min)} – {formatWeight(max)}
        </Text>
        <Text style={styles.axisLabel}>
          {new Date(points[points.length - 1].measured_at).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    paddingVertical: spacing.xl,
    textAlign: "center",
    color: colors.inkFaint,
    fontSize: 13,
  },
  chart: {
    height: 120,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: {
    backgroundColor: colors.moss500,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    minHeight: 4,
  },
  axis: {
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  axisLabel: { fontSize: 11, color: colors.inkFaint },
});
