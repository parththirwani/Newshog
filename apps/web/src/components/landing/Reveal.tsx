"use client";

import type { ReactNode } from "react";
import { useInView } from "@/hooks/use-reveal";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

export function Reveal({
  children,
  delay = 0,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span" | "p";
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  return (
    <As
      // @ts-expect-error polymorphic ref
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-500 ease-out will-change-transform",
        inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </As>
  );
}

export function WordReveal({ text, className }: { text: string; className?: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.3);
  const words = text.split(" ");
  return (
    <span ref={ref} className={className}>
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="inline-block overflow-hidden align-bottom">
            <span
              className="inline-block transition-[opacity,transform] duration-400 ease-out"
              style={{
                transitionDelay: `${i * 45}ms`,
                opacity: inView ? 1 : 0,
                transform: inView ? "translateY(0)" : "translateY(0.9em)",
              }}
            >
              {word}
            </span>
          </span>
          {"\u00A0"}
        </Fragment>
      ))}
    </span>
  );
}
