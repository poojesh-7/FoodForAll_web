import Link from "next/link";
import type { Metadata } from "next";
import {
  HandHeart,
  MapPin,
  ShieldCheck,
  Truck,
  Utensils,
  UsersRound,
} from "lucide-react";
import { PublicPageShell } from "@/components/public/PublicSite";

export const metadata: Metadata = {
  title: "FoodForAll | Food Rescue Platform",
  description:
    "FoodForAll connects restaurants, NGOs, volunteers, and communities to rescue surplus food before it goes to waste.",
};

const flow = ["Restaurants", "NGOs", "Volunteers", "Communities"];

const steps = [
  {
    title: "Providers list surplus food.",
    description:
      "Verified restaurants and food providers publish available food with pickup details.",
  },
  {
    title: "Users or NGOs reserve available food.",
    description:
      "Individuals can reserve eligible paid listings, while NGOs coordinate rescue for community distribution.",
  },
  {
    title: "Volunteers assist with pickup and delivery.",
    description:
      "Volunteer workflows help NGOs move rescued food when transport support is required.",
  },
  {
    title: "Food reaches communities instead of being wasted.",
    description:
      "Reservations, notifications, and impact tracking keep the operation accountable.",
  },
];

const audiences = [
  {
    icon: UsersRound,
    title: "Users",
    description: "Reserve available food.",
  },
  {
    icon: HandHeart,
    title: "NGOs",
    description: "Coordinate food rescue and distribution.",
  },
  {
    icon: Utensils,
    title: "Providers",
    description: "Share surplus food responsibly.",
  },
  {
    icon: Truck,
    title: "Volunteers",
    description: "Support local food rescue efforts.",
  },
];

export default function Home() {
  return (
    <PublicPageShell>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:items-center lg:px-8 lg:py-16">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Public food rescue platform
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-zinc-950 sm:text-5xl">
            FoodForAll
          </h1>
          <p className="mt-5 max-w-2xl text-2xl font-semibold leading-9 text-zinc-900">
            Reduce Food Waste. Support Communities. Create Measurable Impact.
          </p>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">
            FoodForAll helps restaurants, NGOs, volunteers, and users coordinate
            surplus food listings, reservations, pickup support, notifications,
            trust workflows, and impact tracking in one platform.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-md bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              Login
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100"
            >
              Get Started
            </Link>
          </div>
        </div>

        <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <MapPin className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            Rescue flow
          </div>
          <div className="mt-5 space-y-3">
            {flow.map((item, index) => (
              <div key={item}>
                <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <span className="font-medium text-zinc-950">{item}</span>
                  <span className="text-xs font-semibold text-emerald-700">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                {index < flow.length - 1 && (
                  <div className="mx-auto h-5 w-px bg-zinc-300" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
          <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Built for pilot operations, NGO onboarding, provider verification,
            volunteer coordination, and payment-gateway review.
          </p>
        </aside>
      </section>

      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold text-zinc-950">How It Works</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              FoodForAll keeps the public flow simple while the application
              handles verification, trust, payments, and operational status.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-5"
              >
                <p className="text-sm font-semibold text-emerald-700">
                  Step {index + 1}
                </p>
                <h3 className="mt-2 text-base font-semibold text-zinc-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-950">
              Who Can Use FoodForAll
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              The same platform supports community members, rescue
              organizations, food providers, and volunteers.
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
      </section>

      <section className="bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-white sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <h2 className="text-2xl font-semibold">Ready to start?</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Continue with Google to join the FoodForAll pilot.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100"
            >
              Login
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
