"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

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
            className="hidden flex-1 items-center justify-center gap-6 px-8 text-sm font-medium text-zinc-700 lg:flex"
            aria-label="Main navigation"
          >
            {publicLinks.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`transition ${
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
      {mobileMenuOpen &&
        createPortal(
          <div
            id="mobile-menu"
            ref={menuRef}
            className="fixed inset-0 top-[73px] z-50 bg-white lg:hidden"
            role="navigation"
            aria-label="Mobile navigation"
          >
            {/* Mobile Auth Actions - Top of menu */}
            <div className="border-b border-zinc-200 px-4 py-4">
              <PublicAuthActions variant="header" showLogout={true} />
            </div>

            {/* Mobile Navigation Links */}
            <nav className="flex flex-col">
              {publicLinks.map((link) => {
                const active = isActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-4 py-3 text-sm font-medium border-b border-zinc-100 transition ${
                      active
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-zinc-700 hover:bg-zinc-50"
                    }`}
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
