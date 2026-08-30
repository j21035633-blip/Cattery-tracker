import type { ReactElement, ReactNode } from "react";
import {
  ActivityIndicator,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useResponsive } from "@/lib/responsive";
import { TAP_TARGET, colors, radius, spacing } from "@/theme";

// --- layout ---------------------------------------------------------------

/**
 * Page wrapper. Applies the responsive gutter and centres content on a tablet,
 * so text lines do not stretch the full width of a 12" screen.
 */
export function Screen({
  children,
  scroll = true,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const { gutter, maxContentWidth } = useResponsive();
  const inner: ViewStyle = {
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    paddingHorizontal: gutter,
    paddingBottom: spacing.xxl,
  };

  if (!scroll) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={inner}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={inner}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { isTablet } = useResponsive();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={[styles.title, isTablet && styles.titleTablet]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/**
 * Responsive card grid: one column on a phone, two or three on a tablet.
 * Implemented with flex-wrap and a percentage basis rather than FlatList
 * `numColumns`, which cannot change column count on rotation without a remount.
 */
export function Grid({ children }: { children: ReactNode }) {
  const { columns } = useResponsive();
  const items = Array.isArray(children) ? children : [children];

  return (
    <View style={styles.grid}>
      {items.map((child, index) => (
        <View
          key={index}
          style={{
            width: columns === 1 ? "100%" : `${100 / columns}%`,
            padding: spacing.xs,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.moss500} />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={styles.errorNote} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

// --- controls -------------------------------------------------------------

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const background = {
    primary: colors.moss500,
    secondary: colors.moss50,
    ghost: "transparent",
    danger: colors.clay500,
  }[variant];
  const textColor = {
    primary: "#ffffff",
    secondary: colors.moss700,
    ghost: colors.inkMuted,
    danger: "#ffffff",
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "sm" ? styles.buttonSm : styles.buttonMd,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.inkFaint}
      {...props}
      style={[styles.input, props.multiline && styles.inputMultiline, props.style]}
    />
  );
}

/** Chip row used wherever the web app uses a `<select>`. */
export function ChipGroup<T extends string | number>({
  options,
  value,
  onChange,
  multiple = false,
  selected = [],
}: {
  options: { label: string; value: T }[];
  value?: T;
  onChange: (value: T) => void;
  multiple?: boolean;
  selected?: T[];
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const active = multiple
          ? selected.includes(option.value)
          : value === option.value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Switch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.switchRow}
    >
      <View style={[styles.switchBox, value && styles.switchBoxOn]}>
        {value ? <Text style={styles.switchTick}>✓</Text> : null}
      </View>
      <Text style={styles.switchLabel}>{label}</Text>
    </Pressable>
  );
}

// --- indicators -----------------------------------------------------------

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "overdue" | "due" | "done";
}) {
  const background = {
    neutral: "#1f24210d",
    overdue: colors.clay100,
    due: colors.amber100,
    done: colors.moss50,
  }[tone];
  const textColor = {
    neutral: colors.inkMuted,
    overdue: colors.clay600,
    due: colors.amber600,
    done: colors.moss700,
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={[styles.badgeText, { color: textColor }]}>{children}</Text>
    </View>
  );
}

/**
 * Bottom sheet on a phone, centred dialog on a tablet — the same component,
 * because a full-width sheet looks broken on a 12" screen.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { isTablet } = useResponsive();

  return (
    <RNModal
      visible={visible}
      animationType={isTablet ? "fade" : "slide"}
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.sheetBackdrop, isTablet && styles.sheetBackdropTablet]}>
        <View style={[styles.sheet, isTablet && styles.sheetTablet]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Button title="✕" variant="ghost" size="sm" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  headerText: { flexShrink: 1 },
  title: { fontSize: 24, fontWeight: "600", color: colors.ink },
  titleTablet: { fontSize: 30 },
  subtitle: { marginTop: 2, fontSize: 14, color: colors.inkMuted },

  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },

  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -spacing.xs },

  empty: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  emptyTitle: { fontWeight: "500", color: colors.inkMuted, textAlign: "center" },
  emptyHint: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.inkFaint,
    textAlign: "center",
  },

  loading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  loadingLabel: { color: colors.inkFaint, fontSize: 14 },

  errorNote: {
    backgroundColor: colors.clay100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#c96f4a4d",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.clay600, fontSize: 14 },

  button: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: TAP_TARGET,
  },
  buttonSm: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 38 },
  buttonMd: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  buttonText: { fontWeight: "600", fontSize: 15 },

  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: 14, fontWeight: "500", color: colors.inkMuted, marginBottom: 6 },
  fieldHint: { marginTop: 4, fontSize: 12, color: colors.inkFaint },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.ink,
    minHeight: TAP_TARGET,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: "#1f24210d",
    minHeight: 38,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.moss500 },
  chipText: { fontSize: 14, fontWeight: "500", color: colors.inkMuted },
  chipTextActive: { color: "#ffffff" },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: TAP_TARGET,
  },
  switchBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  switchBoxOn: { backgroundColor: colors.moss500, borderColor: colors.moss500 },
  switchTick: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  switchLabel: { fontSize: 15, color: colors.ink, flexShrink: 1 },

  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  badgeText: { fontSize: 12, fontWeight: "600" },

  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#1f24214d" },
  sheetBackdropTablet: { justifyContent: "center", alignItems: "center", padding: spacing.xl },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: "90%",
  },
  sheetTablet: { borderRadius: radius.lg, width: "100%", maxWidth: 560, maxHeight: "80%" },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 18, fontWeight: "600", color: colors.ink },
});
