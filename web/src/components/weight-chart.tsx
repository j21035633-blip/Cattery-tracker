"use client";

import { formatWeight } from "@/lib/format";
import type { WeightLog } from "@/lib/types";

/**
 * Inline SVG sparkline — no chart library for one small line, and it scales
 * cleanly from a phone-width card to a desktop column.
 */
export function WeightChart({ logs }: { logs: WeightLog[] }) {
  // The API returns newest first; a chart reads left-to-right in time order.
  const points = [...logs].sort(
    (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime(),
  );

  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-ink/45">
        Two or more measurements are needed to draw a trend.
      </p>
    );
  }

  const width = 600;
  const height = 160;
  const padding = { top: 12, right: 12, bottom: 22, left: 44 };

  const values = points.map((point) => point.weight_grams);
  const times = points.map((point) => new Date(point.measured_at).getTime());
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  // A flat series would divide by zero; give it a 100 g band to sit inside.
  const valueSpan = maxValue - minValue || 100;
  const timeSpan = times[times.length - 1] - times[0] || 1;

  const x = (time: number) =>
    padding.left + ((time - times[0]) / timeSpan) * (width - padding.left - padding.right);
  const y = (value: number) =>
    padding.top +
    (1 - (value - minValue) / valueSpan) * (height - padding.top - padding.bottom);

  const path = points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${x(times[index]).toFixed(1)},${y(point.weight_grams).toFixed(1)}`;
    })
    .join(" ");

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label={`Weight from ${formatWeight(values[0])} to ${formatWeight(
          values[values.length - 1],
        )} across ${points.length} measurements`}
        preserveAspectRatio="none"
      >
        {[maxValue, (maxValue + minValue) / 2, minValue].map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(value)}
              y2={y(value)}
              stroke="currentColor"
              className="text-ink/10"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-current text-ink/40"
              fontSize={11}
            >
              {(value / 1000).toFixed(1)}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="#4a7c59" strokeWidth={2.5} strokeLinejoin="round" />

        {points.map((point, index) => (
          <circle
            key={point.id}
            cx={x(times[index])}
            cy={y(point.weight_grams)}
            r={3.5}
            fill="#4a7c59"
          >
            <title>
              {new Date(point.measured_at).toLocaleDateString()} ·{" "}
              {formatWeight(point.weight_grams)}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-ink/45">
        <span>{new Date(times[0]).toLocaleDateString()}</span>
        <span>kg</span>
        <span>{new Date(times[times.length - 1]).toLocaleDateString()}</span>
      </figcaption>
    </figure>
  );
}
