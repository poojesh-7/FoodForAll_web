import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeIndianRupee,
  CheckCircle2,
  Clock3,
  Leaf,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Store,
  Utensils,
  WalletCards,
} from "lucide-react";
import { PublicPageShell } from "@/components/public/PublicSite";
import PublicAuthActions from "@/components/public/PublicAuthActions";

export const metadata: Metadata = {
  title: "FoodForAll | Food Rescue Marketplace",
  description:
    "FoodForAll helps people discover affordable surplus fresh food nearby and connects restaurants, NGOs, volunteers, and communities to reduce food waste.",
};

const valuePoints = [
  { title: "AVAILABLE TODAY", text: "Fresh food available now", icon: Clock3 },
  { title: "BETTER PRICES", text: "Good food at lower prices", icon: BadgeIndianRupee },
  { title: "SIMPLE PICKUP", text: "Reserve, pay, collect", icon: CheckCircle2 },
];

const marketplaceCards = [
  {
    title: "Veg Meal Box",
    provider: "Green Bowl Kitchen",
    price: "₹60",
    originalPrice: "₹100",
    distance: "500 m away",
    pickup: "Pickup by 8:30 PM",
    remaining: "4 portions left",
    badge: "Limited",
    tone: "bg-emerald-100 text-emerald-800",
    icon: Utensils,
  },
  {
    title: "Fresh Bakery Box",
    provider: "Morning Crust",
    price: "₹75",
    originalPrice: "₹140",
    distance: "1.2 km away",
    pickup: "Pickup by 7:15 PM",
    remaining: "7 portions left",
    badge: "Fresh today",
    tone: "bg-amber-100 text-amber-800",
    icon: Sparkles,
  },
  {
    title: "Rice & Curry Packs",
    provider: "Community Canteen",
    price: "₹90",
    originalPrice: "₹150",
    distance: "820 m away",
    pickup: "Pickup by 9:00 PM",
    remaining: "3 portions left",
    badge: "Nearby",
    tone: "bg-sky-100 text-sky-800",
    icon: Leaf,
  },
];

const foodSpotlightCards = [
  {
    title: "Veg meal boxes",
    provider: "Green Bowl Kitchen",
    detail: "Pickup by 8:30 PM",
    price: "Better price",
    tone: "bg-emerald-100 text-emerald-800",
    icon: Utensils,
  },
  {
    title: "Fresh Bakery Box",
    provider: "Morning Crust",
    detail: "1.2 km away",
    price: "Fresh today",
    tone: "bg-amber-100 text-amber-800",
    icon: Sparkles,
  },
  {
    title: "Rice and curry packs",
    provider: "Community Canteen",
    detail: "Limited portions",
    price: "Nearby",
    tone: "bg-sky-100 text-sky-800",
    icon: Leaf,
  },
];

const steps = [
  {
    icon: MapPin,
    title: "Find food nearby",
    description: "Browse fresh food available today.",
    number: "01",
  },
  {
    icon: WalletCards,
    title: "Reserve & pay",
    description: "Choose your portion and secure it.",
    number: "02",
  },
  {
    icon: Store,
    title: "Pick it up",
    description: "Collect directly from the provider during the pickup window.",
    number: "03",
  },
];

const benefits: { title: string; description: string; icon: LucideIcon; tint: string }[] = [
  {
    title: "SAVE MONEY",
    description: "Enjoy good food at better prices.",
    icon: BadgeIndianRupee,
    tint: "bg-emerald-100 text-emerald-700",
  },
  {
    title: "PICK UP NEARBY",
    description: "Reserve online and collect directly from the provider.",
    icon: MapPin,
    tint: "bg-amber-100 text-amber-700",
  },
  {
    title: "REDUCE WASTE",
    description: "Help good food get eaten instead of discarded.",
    icon: Leaf,
    tint: "bg-sky-100 text-sky-700",
  },
];

export default function Home() {
  return (
    <PublicPageShell>
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,26rem)] lg:items-center lg:gap-8 lg:px-8 lg:py-12">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <Leaf className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Food Rescue Marketplace</span>
            </div>

            <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-zinc-950 sm:text-5xl lg:text-[3.5rem]">
              Good food. Better prices. Near you.
            </h1>

            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-700 sm:text-lg">
              Restaurants and cafes sometimes have extra fresh food available today. Discover it nearby, grab it at a better price, and pick it up before the collection window ends.
            </p>

            <div className="mt-6">
              <PublicAuthActions variant="lightCta" />
            </div>
          </div>

          <aside
            className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 shadow-[var(--shadow-subtle)]"
            aria-label="Nearby food marketplace preview"
          >
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-950">Nearby food</p>
                  <p className="text-xs text-zinc-500">Available today</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  <Clock3 className="h-3 w-3" aria-hidden="true" />
                  Live
                </span>
              </div>

              <div className="space-y-3 p-3">
                {foodSpotlightCards.map((item) => {
                  const Icon = item.icon;

                  return (
                    <article
                      key={item.title}
                      className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"
                    >
                      <div
                        className={`flex aspect-square items-center justify-center rounded-lg ${item.tone}`}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold text-zinc-950">
                              {item.title}
                            </h2>
                            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                              {item.provider}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md bg-zinc-950 px-2 py-1 text-[10px] font-semibold text-white">
                            {item.price}
                          </span>
                        </div>

                        <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-zinc-600">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                          <span className="truncate">{item.detail}</span>
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-zinc-50">
        <div className="mx-auto grid max-w-6xl gap-3 px-4 py-4 sm:grid-cols-3 sm:px-6 lg:px-8">
          {valuePoints.map(({ title, text, icon: Icon }) => (
            <div
              key={title}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {title}
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-900">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-5 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-3xl">
              Fresh food available near you.
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 sm:text-base">
              Discover extra fresh food from local restaurants and cafes before the pickup window ends.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {marketplaceCards.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-subtle)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                        {item.badge}
                      </span>
                      <h3 className="mt-3 text-xl font-semibold text-zinc-950">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">{item.provider}</p>
                    </div>

                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3 border-t border-zinc-100 pt-3">
                    <div>
                      <p className="text-2xl font-bold tracking-[-0.04em] text-emerald-700">
                        {item.price}
                      </p>
                      <p className="text-xs text-zinc-400 line-through">{item.originalPrice}</p>
                    </div>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      Better price
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-zinc-600">
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                      {item.distance}
                    </p>
                    <p className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                      {item.pickup}
                    </p>
                    <p className="flex items-center gap-2">
                      <PackageCheck className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                      {item.remaining}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover"
                  >
                    Reserve
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-5 text-center sm:text-left">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-3xl">
              Find. Reserve. Collect.
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step) => {
              const Icon = step.icon;

              return (
                <article
                  key={step.number}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-subtle)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                      {step.number}
                    </span>
                  </div>

                  <h3 className="mt-4 text-lg font-semibold text-zinc-950">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{step.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-5 max-w-lg">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-zinc-950 sm:text-3xl">
              Why FoodForAll?
            </h2>
            <p className="mt-2 text-base text-zinc-600">Good food, better prices, simple pickup.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {benefits.map(({ title, description, icon: Icon, tint }) => (
              <article
                key={title}
                className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
              >
                <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tint}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold uppercase tracking-[0.08em] text-zinc-950">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-emerald-100 bg-emerald-50/70">
        <div className="mx-auto max-w-5xl px-4 py-6 text-center sm:px-6 lg:px-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Good food shouldn&apos;t go to waste.
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-700 sm:text-base">
            FoodForAll helps local outlets get extra fresh food to people who can enjoy it.
          </p>
        </div>
      </section>

      <section className="bg-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 text-white sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Have extra fresh food?
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              Turn extra food into extra revenue.
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              List your food, set your price, and let nearby customers reserve and pick it up directly.
            </p>
          </div>

          <div className="flex shrink-0">
            <Link
              href="/provider/register"
              className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100"
            >
              Register as a Provider / Restaurant
            </Link>
          </div>
        </div>
      </section>

      <div className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 text-center text-sm font-medium text-zinc-500 sm:px-6 lg:px-8">
          Good food. Better prices. Less waste.
        </div>
      </div>
    </PublicPageShell>
  );
}
