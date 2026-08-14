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
  // Controls whether the mobile menu is mounted at all (kept mounted a
  // little longer than `mobileMenuOpen` so the close transition can play).
  const [mobileMenuMounted, setMobileMenuMounted] = useState(false);
  // Drives the actual transform/opacity classes; toggled a tick after
  // mount so the "enter" transition runs from a real starting state.
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Sliding indicator under the active desktop nav link
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

  // Close menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Mount/unmount mobile menu with a slide transition
  useEffect(() => {
    let rafId1: number;
    let rafId2: number;
    let hideTimeout: ReturnType<typeof setTimeout>;

    if (mobileMenuOpen) {
      setMobileMenuMounted(true);
      // Two nested rAFs guarantee the browser has painted the initial
      // (hidden) state at least once before we flip to visible — a
      // setTimeout can still land in the same paint and skip the
      // transition entirely, which is what caused the "popping" jump.
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(() => setMobileMenuVisible(true));
      });
    } else {
      setMobileMenuVisible(false);
      hideTimeout = setTimeout(() => setMobileMenuMounted(false), 320);
    }

    return () => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      clearTimeout(hideTimeout);
    };
  }, [mobileMenuOpen]);

  // Handle keyboard and outside clicks
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
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <header className="border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Desktop & Tablet Navigation */}
        <div className="flex min-h-20 items-center justify-between gap-4">
          {/* Logo */}
          <Link
            href="/"
            className="flex-shrink-0 rounded-md text-xl font-semibold text-zinc-950 outline-none transition hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-4"
          >
            {businessName}
          </Link>

          {/* Desktop Navigation (hidden on mobile, shown on lg+) */}
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
            {/* Sliding active-link indicator */}
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

          {/* Desktop Auth Actions */}
          <div className="hidden lg:block">
            <PublicAuthActions variant="header" showLogout={true} />
          </div>

          {/* Mobile Menu Trigger */}
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

      {/* Mobile Menu Portal */}
      {mobileMenuMounted &&
        createPortal(
          <div
            id="mobile-menu"
            ref={menuRef}
            className={`fixed inset-0 top-20 z-50 origin-top overflow-y-auto bg-zinc-50 lg:hidden transition-all duration-300 ease-out will-change-transform ${
              mobileMenuVisible
                ? "translate-y-0 opacity-100"
                : "-translate-y-6 opacity-0"
            }`}
            role="navigation"
            aria-label="Mobile navigation"
          >
            <div className="space-y-5 px-5 py-5">
              {/* Mobile Auth Actions - stacked, button-like */}
              <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <PublicAuthActions variant="mobileMenu" showLogout={true} />
              </section>

              {/* Mobile Navigation Links */}
              <nav className="space-y-2" aria-label="Public pages">
                {publicLinks.map((link, index) => {
                  const active = isActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex min-h-12 items-center justify-between rounded-md border px-4 text-sm font-semibold shadow-sm transition-all duration-300 ease-out ${
                        active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950"
                      } ${
                        mobileMenuVisible
                          ? "translate-y-0 opacity-100"
                          : "-translate-y-3 opacity-0"
                      }`}
                      style={{
                        transitionDelay: mobileMenuVisible
                          ? `${index * 40}ms`
                          : "0ms",
                      }}
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
