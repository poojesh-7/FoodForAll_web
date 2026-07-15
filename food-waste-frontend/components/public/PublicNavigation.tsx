"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Desktop & Tablet Navigation */}
        <div className="flex items-center justify-between py-4">
          {/* Logo */}
          <Link
            href="/"
            className="flex-shrink-0 text-xl font-semibold text-zinc-950"
          >
            {businessName}
          </Link>

          {/* Desktop Navigation (hidden on mobile, shown on lg+) */}
          <nav
            ref={navRef}
            className="relative hidden flex-1 items-center justify-center gap-6 px-8 text-sm font-medium text-zinc-700 lg:flex"
            aria-label="Main navigation"
          >
            {publicLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  data-active={active ? "true" : "false"}
                  className={`relative transition-colors duration-300 ${
                    active
                      ? "text-emerald-700"
                      : "hover:text-emerald-700"
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
            className="lg:hidden inline-flex items-center justify-center p-2 text-zinc-700 hover:text-emerald-700 transition"
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
            className={`fixed inset-0 top-[73px] z-50 origin-top bg-white lg:hidden transition-all duration-300 ease-out will-change-transform ${
              mobileMenuVisible
                ? "translate-y-0 opacity-100"
                : "-translate-y-6 opacity-0"
            }`}
            role="navigation"
            aria-label="Mobile navigation"
          >
            {/* Mobile Auth Actions - Top of menu */}
            <div className="border-b border-zinc-200 px-4 py-4">
              <PublicAuthActions variant="header" showLogout={true} />
            </div>

            {/* Mobile Navigation Links */}
            <nav className="flex flex-col">
              {publicLinks.map((link, index) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-4 py-3 text-sm font-medium border-b border-zinc-100 transition-all duration-300 ease-out ${
                      active
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-zinc-700 hover:bg-zinc-50"
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
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>,
          document.body
        )}
    </header>
  );
}