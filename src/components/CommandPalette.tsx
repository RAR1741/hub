"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Icon } from "@/components/ui/Icon";
import type { NavDestination, NavGroup } from "@/lib/nav-destinations";

const GROUPS: NavGroup[] = ["Overview", "Shop floor", "Team", "Admin"];

type PersonHit = { id: string; name: string; role: string; isActive: boolean; gradYear: number | null };

// ⌘K / Ctrl+K command palette: jump to any nav destination, or (mentor+) find
// a person. Mounted once in SiteTopbar; owns its own trigger button + dialog.
export function CommandPalette({
  destinations,
  canSearchPeople,
}: {
  destinations: NavDestination[];
  canSearchPeople: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // Server always renders "⌘K"; this corrects it post-mount from
    // navigator, which must not be read during render (hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setOpen((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!canSearchPeople || !open || !query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPeople([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/people/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => {
          setPeople(d.people ?? []);
          setSearching(false);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, open, canSearchPeople]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  const q = query.trim().toLowerCase();
  function matches(d: NavDestination) {
    return (
      !q ||
      d.label.toLowerCase().includes(q) ||
      d.group.toLowerCase().includes(q) ||
      d.href.includes(q)
    );
  }

  return (
    <>
      <button
        type="button"
        className="tb-search"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Icon name="search" className="ic" />
        <span>Search</span>
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
        label="Search and navigate"
        overlayClassName="palette-overlay"
        contentClassName="palette"
        shouldFilter={false}
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder={canSearchPeople ? "Go to a page or find a person…" : "Go to a page…"}
        />
        <Command.List>
          <Command.Empty>{searching ? "Searching…" : "No results"}</Command.Empty>
          {canSearchPeople && people.length > 0 && (
            <Command.Group heading="People">
              {people.map((p) => (
                <Command.Item key={p.id} value={`person:${p.id}`} onSelect={() => go(`/people/${p.id}`)}>
                  <Icon name="users" className="ic" />
                  <span>{p.name}</span>
                  <span className="meta">
                    {p.role}
                    {p.gradYear ? ` · ${p.gradYear}` : ""}
                    {p.isActive ? "" : " · inactive"}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {GROUPS.map((g) => {
            const items = destinations.filter((d) => d.group === g && matches(d));
            if (!items.length) return null;
            return (
              <Command.Group key={g} heading={g}>
                {items.map((d) => (
                  <Command.Item key={d.href} value={`${d.label} ${g}`} onSelect={() => go(d.href)}>
                    <span>{d.label}</span>
                    <span className="meta">{d.href}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command.Dialog>
    </>
  );
}
