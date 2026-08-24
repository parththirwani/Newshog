export interface Angle {
  title: string;
  why_now: string;
  why_journalists_care: string;
  headline: string;
  /** Only present when profile context was used: why this user can credibly take the angle. */
  fit_rationale?: string;
  /** True when a weak / stretched fit, flagged by the analysis critique pass. */
  is_stretch?: boolean;
}
