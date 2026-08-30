import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { CareCleaning } from "@/components/care-cleaning";
import { CareFeeding } from "@/components/care-feeding";
import { CareVet } from "@/components/care-vet";
import { ChipGroup, PageHeader, Screen } from "@/components/ui";

type Segment = "feeding" | "cleaning" | "vet";

const SEGMENTS: { label: string; value: Segment }[] = [
  { label: "Feeding", value: "feeding" },
  { label: "Cleaning", value: "cleaning" },
  { label: "Vet", value: "vet" },
];

/**
 * The web app gives feeding, cleaning and vet their own nav entries. On a phone
 * that would push the tab bar to seven items, so they share one tab with a
 * segmented control — same screens, same actions.
 */
export default function CareScreen() {
  const [segment, setSegment] = useState<Segment>("feeding");
  const [reloadKey, setReloadKey] = useState(0);

  // Bump the key on focus so the active segment refetches after work done
  // elsewhere (or by the backend sweep) without each child polling.
  useFocusEffect(
    useCallback(() => {
      setReloadKey((current) => current + 1);
    }, []),
  );

  return (
    <Screen>
      <PageHeader title="Care" subtitle="Feeding, cleaning and vet in one place" />

      <View style={{ marginBottom: 12 }}>
        <ChipGroup options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>

      {segment === "feeding" ? <CareFeeding reloadKey={reloadKey} /> : null}
      {segment === "cleaning" ? <CareCleaning reloadKey={reloadKey} /> : null}
      {segment === "vet" ? <CareVet reloadKey={reloadKey} /> : null}
    </Screen>
  );
}
