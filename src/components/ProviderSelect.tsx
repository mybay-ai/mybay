import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe2, Search, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import { providerRegistry, type ProviderConfig } from "../../shared/providerRegistry";
import { getProviderDisplayGroups } from "../../shared/providerRegistryUtils";
import { cn } from "../lib/utils";

interface ProviderSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  includeOAuth?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  legacyOption?: { id: string; label: string };
}

const badgeClassName = "rounded-full border border-outline bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-content-muted";

export function ProviderSelect({
  value,
  onValueChange,
  includeOAuth = true,
  disabled = false,
  placeholder,
  className,
  legacyOption
}: ProviderSelectProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = providerRegistry[value];
  const groups = useMemo(
    () => getProviderDisplayGroups({ query, includeOAuth }),
    [includeOAuth, query]
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectProvider = (providerId: string) => {
    onValueChange(providerId);
    setOpen(false);
    setQuery("");
  };

  const renderBadges = (provider: ProviderConfig) => {
    const badges = [
      ...(provider.recommendedRank !== undefined ? ["recommended"] : []),
      ...provider.badges,
      provider.networkAccess
    ].slice(0, 3);
    return badges.map((badge) => (
      <span key={badge} className={badgeClassName}>{t(`providerPicker.badges.${badge}`)}</span>
    ));
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        className="flex h-11 w-full items-center gap-2 rounded-lg border border-outline bg-surface px-3.5 text-left text-sm text-content shadow-sm transition-colors hover:border-outline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selected?.iconUrl ? <img src={selected.iconUrl} alt="" className="h-5 w-5 object-contain" referrerPolicy="no-referrer" /> : <Globe2 className="h-4 w-4 text-content-muted" />}
        <span className="min-w-0 flex-1 truncate">{selected?.label || legacyOption?.label || placeholder || t("providerPicker.placeholder")}</span>
        {selected?.networkAccess === "cn-direct" && <Wifi className="h-3.5 w-3.5 text-emerald-500" aria-label={t("providerPicker.badges.cn-direct")} />}
        <ChevronDown className={cn("h-4 w-4 text-content-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-[80] mt-2 overflow-hidden rounded-xl border border-outline bg-surface shadow-2xl">
          <div className="border-b border-outline p-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("providerPicker.search")}
                className="h-9 w-full rounded-lg border border-outline bg-control pl-9 pr-3 text-sm text-content outline-none focus:border-action focus:ring-2 focus:ring-focus-ring"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-80 overflow-y-auto p-2">
            {legacyOption && !selected && !query && (
              <div className="mb-2">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t("providerPicker.groups.legacy")}</div>
                <button type="button" onClick={() => selectProvider(legacyOption.id)} className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-surface-muted">
                  {legacyOption.label}
                </button>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.id} className="mb-2 last:mb-0">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t(`providerPicker.groups.${group.id}`)}</div>
                {group.providers.map((provider) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={provider.id === value}
                    key={provider.id}
                    onClick={() => selectProvider(provider.id)}
                    className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-muted", provider.id === value && "bg-blue-50 dark:bg-blue-950/30")}
                  >
                    {provider.iconUrl ? <img src={provider.iconUrl} alt="" className="h-6 w-6 shrink-0 object-contain" referrerPolicy="no-referrer" /> : <Globe2 className="h-5 w-5 shrink-0 text-content-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-content">{provider.label}</span>
                      <span className="mt-1 flex flex-wrap gap-1">{renderBadges(provider)}</span>
                    </span>
                    {provider.id === value && <Check className="h-4 w-4 shrink-0 text-action" />}
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="px-3 py-8 text-center text-sm text-content-muted">{t("providerPicker.empty")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
