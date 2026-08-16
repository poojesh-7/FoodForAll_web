"use client";

import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import PublicAuthActions from "@/components/public/PublicAuthActions";

export const businessName = "FoodForAll";

const publicLinks = [
  { href: "/", label: "Home" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refund-policy", label: "Refund Policy" },
  { href: "/contact", label: "Contact" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicNavigation() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
    opacity: number;
  }>({ left: 0, width: 0, opacity: 0 });

  const updateIndicator = () => {
    const nav = navRef.current;
    if (!nav) return;
    const activeEl = nav.querySelector<HTMLAnchorElement>(
      'a[data-active="true"]'
    );
    if (!activeEl) {
      setIndicatorStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const linkRect = activeEl.getBoundingClientRect();
    setIndicatorStyle({
      left: linkRect.left - navRect.left,
      width: linkRect.width,
      opacity: 1,
    });
  };

  useLayoutEffect(() => {
    updateIndicator();
  }, [pathname]);

  useEffect(() => {
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const handleMobileMenuToggle = () => {
    setMobileMenuOpen((open) => !open);
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  return (
    <header className="border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-20 items-center justify-between gap-4">
          <Link
            href="/"
            className="flex-shrink-0 rounded-md text-xl font-semibold text-zinc-950 outline-none transition hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-4"
          >
            {businessName}
          </Link>

          <nav
            ref={navRef}
            className="relative hidden flex-1 items-center justify-center gap-2 px-8 text-sm font-medium text-zinc-700 lg:flex"
            aria-label="Main navigation"
          >
            {publicLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  data-active={active ? "true" : "false"}
                  className={`relative rounded-md px-3 py-2 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 ${
                    active
                      ? "bg-emerald-50 text-emerald-700"
                      : "hover:bg-zinc-50 hover:text-zinc-950"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-emerald-700 transition-all duration-300 ease-out"
              style={{
                left: indicatorStyle.left,
                width: indicatorStyle.width,
                opacity: indicatorStyle.opacity,
              }}
            />
          </nav>

          <div className="hidden lg:block">
            <PublicAuthActions variant="header" showLogout={true} />
          </div>

          <button
            ref={triggerRef}
            onClick={handleMobileMenuToggle}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 lg:hidden"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {mobileMenuOpen &&
        createPortal(
          <div
            id="mobile-menu"
            ref={menuRef}
            className="fixed inset-0 top-20 z-50 origin-top overflow-y-auto bg-zinc-50 lg:hidden"
            role="navigation"
            aria-label="Mobile navigation"
          >
            <div className="space-y-5 px-5 py-5">
              <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <PublicAuthActions variant="mobileMenu" showLogout={true} />
              </section>

              <nav className="space-y-2" aria-label="Public pages">
                {publicLinks.map((link) => {
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={closeMobileMenu}
                      className={`flex min-h-12 items-center justify-between rounded-md border px-4 text-sm font-semibold shadow-sm transition-colors ${
                        active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950"
                      }`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span>{link.label}</span>
                      {active && (
                        <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
