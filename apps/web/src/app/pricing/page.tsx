import { SiteHeader } from "@/components/landing/SiteHeader";
import { PricingSection } from "@/components/landing/PricingSection";
import { SiteFooter } from "@/components/landing/SiteFooter";

export const metadata = {
  title: "Pricing — Newshog",
  description: "Start free, go Pro for $20/mo. View Newshog's plans and features.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="pt-14">
        <PricingSection />
      </main>
      <SiteFooter />
    </div>
  );
}