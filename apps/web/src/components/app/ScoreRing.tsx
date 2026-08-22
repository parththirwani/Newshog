import { band } from "@/lib/result-utils";

const STROKE = 4;

export function ScoreRing({
  score,
  size = 40,
}: {
  score: number;
  size?: number;
}) {
  const r = (size - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const b = band(score);
  const color =
    b === "Strong"
      ? "var(--color-green-600, #16a34a)"
      : b === "Consider"
        ? "var(--color-amber-500, #f59e0b)"
        : "var(--color-red-500, #ef4444)";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-foreground"
        style={{ fontSize: size * 0.275 }}
      >
        {score}
      </span>
    </div>
  );
}
