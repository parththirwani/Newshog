"use client";

export function LocalDateTime({
  iso,
  dateOnly = false,
}: {
  iso: string;
  dateOnly?: boolean;
}) {
  const value = new Date(iso);
  const text = new Intl.DateTimeFormat(undefined, dateOnly
    ? { dateStyle: "long" }
    : { dateStyle: "medium", timeStyle: "short" }).format(value);

  return <>{text}</>;
}
