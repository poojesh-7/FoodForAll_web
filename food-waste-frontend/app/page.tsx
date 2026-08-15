import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeIndianRupee,
  CheckCircle2,
  Clock3,
  HandHeart,
  Leaf,
  MapPin,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Utensils,
  UsersRound,
} from "lucide-react";
import { PublicPageShell } from "@/components/public/PublicSite";
import PublicAuthActions from "@/components/public/PublicAuthActions";

export const metadata: Metadata = {
  title: "FoodForAll | Food Rescue Marketplace",
  description:
    "FoodForAll helps people discover affordable surplus fresh food nearby and connects restaurants, NGOs, volunteers, and communities to reduce food waste.",
};

const heroStats = [
  { label: "Available today", value: "Fresh pickups" },
  { label: "Simple flow", value: "Reserve, Pay, Collect" },
  { label: "Local impact", value: "Less food wasted" },
];

const marketplaceCards = [
  {
    title: "Veg meal boxes",
    provider: "Green Bowl Kitchen",
    detail: "Pickup by 8:30 PM",
    price: "Better price",
    tone: "bg-emerald-100 text-emerald-800",
  },
  {
    title: "Bakery surplus",
    provider: "Morning Crust",
    detail: "1.8 km away",
    price: "Fresh today",
    tone: "bg-amber-100 text-amber-800",
  },
  {
    title: "Rice and curry packs",
    provider: "Community Canteen",
    detail: "Limited portions",
    price: "Reserve now",
    tone: "bg-sky-100 text-sky-800",
  },
];

const steps = [
  {
    icon: MapPin,
    title: "Discover nearby food",
    description:
      "Browse fresh surplus listings from local restaurants and food providers.",
  },
  {
    icon: BadgeIndianRupee,
    title: "Reserve and pay",
    description:
      "Choose available portions and complete the existing reservation flow.",
  },
  {
    icon: ShoppingBag,
    title: "Collect on time",
    description:
      "Pick up during the provider's collection window and help prevent waste.",
  },
];

const benefits = [
  {
    icon: Utensils,
    title: "Fresh food, not leftovers",
    description:
      "Listings are built around real pickup windows, remaining quantity, and provider details.",
  },
  {
    icon: PackageCheck,
    title: "Availability you can scan",
    description:
      "Category, price, distance, dietary tags, and pickup deadlines make discovery practical.",
  },
  {
    icon: ShieldCheck,
    title: "Trust-led marketplace",
    description:
      "Verification, notifications, and account workflows keep the rescue process accountable.",
  },
];

const audiences = [
  {
    icon: UsersRound,
    title: "Community members",
    description: "Reserve affordable surplus food from nearby providers.",
  },
  {
    icon: HandHeart,
    title: "NGOs",
    description: "Coordinate rescue and distribution for community support.",
  },
  {
    icon: Utensils,
    title: "Providers",
    description: "Share surplus food responsibly and reduce avoidable waste.",
  },
  {
    icon: Truck,
    title: "Volunteers",
    description: "Support pickup and delivery when NGOs need transport help.",
  },
];

export default function Home() {
  return (
    <PublicPageShell>
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:items-center lg:px-8 lg:py-16">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase text-emerald-700">
              <Leaf className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                Food rescue marketplace
              </span>
            </div>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl lg:text-6xl">
              Discover surplus fresh food nearby at better prices.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-700 sm:text-lg sm:leading-8">
              FoodForAll connects people with local providers who have good food
              available today. Reserve, pay, and collect before it goes to
              waste.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href="/food"
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:w-auto"
              >
                Browse food
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <div className="sm:w-auto">
                <PublicAuthActions variant="lightCta" />
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {heroStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-4"
                >
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-950">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <aside
            className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-sm sm:p-4"
            aria-label="Marketplace preview"
          >
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-950">
                    Nearby food
                  </p>
                  <p className="text-xs text-zinc-500">Available today</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Live
                </span>
              </div>

              <div className="space-y-3 p-3">
                {marketplaceCards.map((item) => (
                  <article
                    key={item.title}
                    className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-md border border-zinc-200 bg-white p-3 shadow-sm"
                  >
                    <div
                      className={`flex aspect-square items-center justify-center rounded-md ${item.tone}`}
                    >
                      <Utensils className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-sm font-semibold text-zinc-950">
                            {item.title}
                          </h2>
                          <p className="mt-1 truncate text-xs text-zinc-500">
                            {item.provider}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
                          {item.price}
                        </span>
                      </div>
                      <p className="mt-3 flex items-center gap-1 text-xs font-medium text-zinc-600">
                        <MapPin
                          className="h-3.5 w-3.5 shrink-0 text-emerald-700"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate">{item.detail}</span>
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold text-zinc-950">
              Reserve, Pay, Collect
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              The public experience stays simple while FoodForAll handles
              provider details, payments, pickup status, notifications, and
              rescue accountability in the app.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <article
                  key={step.title}
                  className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold text-zinc-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-zinc-950">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {step.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase text-emerald-700">
              Marketplace essentials
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-950">
              Built for fresh food decisions, not admin work.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              FoodForAll keeps discovery approachable for community members:
              what is available, where it is, what it costs, and when to pick it
              up.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <article
                  key={benefit.title}
                  className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <Icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold text-zinc-950">
                    {benefit.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {benefit.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-emerald-700">
                Community impact
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-zinc-950">
                One platform for everyone in the rescue loop.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                FoodForAll supports the people reserving food and the teams
                making local rescue operations reliable.
              </p>
            </div>
            <ShieldCheck className="h-8 w-8 text-emerald-700" aria-hidden="true" />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {audiences.map((audience) => {
              const Icon = audience.icon;
              return (
                <article
                  key={audience.title}
                  className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <Icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold text-zinc-950">
                    {audience.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {audience.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 text-white sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              <p className="text-sm font-semibold uppercase">
                Start with nearby food
              </p>
            </div>
            <h2 className="mt-3 text-2xl font-semibold">
              Rescue good food before it goes to waste.
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Sign in to reserve available food or continue to the marketplace
              to see what providers are sharing.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/food"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:w-auto"
            >
              Browse food
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <PublicAuthActions variant="darkCta" />
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
