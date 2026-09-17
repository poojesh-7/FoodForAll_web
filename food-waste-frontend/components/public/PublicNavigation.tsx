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
    <header className="border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-20 items-center justify-between gap-4">
          <Link
            href="/"
            className="flex-shrink-0 rounded-md text-xl font-semibold text-[var(--text-primary)] outline-none transition-colors hover:text-[var(--brand-hover)]"
          >
            {businessName}
          </Link>

          <nav
            ref={navRef}
            className="relative hidden flex-1 items-center justify-center gap-2 px-8 text-sm font-medium text-[var(--text-secondary)] lg:flex"
            aria-label="Main navigation"
          >
            {publicLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  data-active={active ? "true" : "false"}
                  className={`relative rounded-md px-3 py-2 transition-colors duration-200 ${
                    active
                      ? "bg-[var(--brand-soft)] text-[var(--brand-hover)]"
                      : "hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-[var(--brand)] transition-all duration-200 ease-out"
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
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-[var(--shadow-subtle)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-hover)] lg:hidden"
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
            className="fixed inset-0 top-20 z-50 origin-top overflow-y-auto bg-[var(--background)] lg:hidden"
            role="navigation"
            aria-label="Mobile navigation"
          >
            <div className="space-y-5 px-5 py-5">
              <section className="border-b border-[var(--border)] bg-[var(--surface)] p-4">
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
                      className={`flex min-h-12 items-center justify-between rounded-md border px-4 text-sm font-semibold transition-colors ${
                        active
                          ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-hover)]"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                      }`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span>{link.label}</span>
                      {active && (
                        <span className="h-2 w-2 rounded-full bg-[var(--brand)]" />
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
