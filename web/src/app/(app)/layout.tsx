"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button, Spinner, cx } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Today", icon: "◉" },
  { href: "/cats", label: "Cats", icon: "◐" },
  { href: "/feeding", label: "Feeding", icon: "◇" },
  { href: "/cleaning", label: "Cleaning", icon: "◈" },
  { href: "/vet", label: "Vet", icon: "✚" },
  { href: "/notifications", label: "Alerts", icon: "◆" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Refresh the badge on navigation and on a slow poll, so an alert raised by
  // the backend sweep shows up without a manual reload.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const { unread: count } = await api.notifications.unreadCount();
        if (!cancelled) setUnread(count);
      } catch {
        /* the badge is not worth surfacing an error for */
      }
    };

    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user, pathname]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  return (
    <div className="min-h-screen desktop:flex">
      {/* Desktop: persistent sidebar. Tablet and below: top bar + bottom tabs. */}
      <aside className="hidden desktop:flex desktop:w-60 desktop:shrink-0 desktop:flex-col desktop:border-r desktop:border-black/5 desktop:bg-white desktop:p-4">
        <div className="px-2 py-3">
          <p className="text-lg font-semibold text-ink">Cattery Tracker</p>
          <p className="mt-0.5 truncate text-xs text-ink/50">{user.email}</p>
        </div>
        <nav className="mt-2 flex-1 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              active={pathname.startsWith(item.href)}
              badge={item.href === "/notifications" ? unread : 0}
            />
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={logout} className="justify-start">
          Sign out
        </Button>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-black/5 bg-cream/90 px-4 py-3 backdrop-blur desktop:hidden">
        <p className="font-semibold text-ink">Cattery Tracker</p>
        <Button variant="ghost" size="sm" onClick={logout}>
          Sign out
        </Button>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 tablet:px-6 desktop:pb-10 desktop:pt-8">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-black/5 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur desktop:hidden"
        aria-label="Main"
      >
        {NAV.map((item) => (
          <TabLink
            key={item.href}
            {...item}
            active={pathname.startsWith(item.href)}
            badge={item.href === "/notifications" ? unread : 0}
          />
        ))}
      </nav>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge: number;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
        active ? "bg-moss-50 text-moss-700" : "text-ink/70 hover:bg-black/5",
      )}
    >
      <span aria-hidden className="w-4 text-center">
        {icon}
      </span>
      {label}
      {badge > 0 && <UnreadDot count={badge} />}
    </Link>
  );
}

function TabLink({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  badge: number;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium",
        active ? "text-moss-700" : "text-ink/50",
      )}
    >
      <span aria-hidden className="text-base leading-none">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span className="absolute right-1/2 top-1 translate-x-3 rounded-full bg-clay-500 px-1 text-[10px] font-semibold leading-4 text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

function UnreadDot({ count }: { count: number }) {
  return (
    <span className="ml-auto rounded-full bg-clay-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
