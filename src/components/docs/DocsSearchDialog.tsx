import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { DocsLocale, DocsSearchRecord } from "../../lib/docs/docsTypes";
import { rankDocsSearch } from "../../lib/docs/docsSearch";

export function DocsSearchDialog({ open, onClose, locale }: { open: boolean; onClose: () => void; locale: DocsLocale }) {
  const { t } = useTranslation("docs");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<DocsSearchRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/docs/docs-search-index.${locale}.json`)
      .then(response => {
        if (!response.ok) throw new Error(`Search index returned ${response.status}`);
        return response.json();
      })
      .then(value => setRecords(Array.isArray(value) ? value : []))
      .catch(error => {
        console.error("[DocsSearch] Failed to load index", error);
        setRecords([]);
      })
      .finally(() => setLoading(false));
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, locale]);

  useEffect(() => { setSelected(0); }, [query]);
  const results = useMemo(() => rankDocsSearch(records, query), [records, query]);
  if (!open || typeof document === "undefined") return null;

  const choose = (href: string) => {
    navigate(href);
    setQuery("");
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected(value => Math.min(value + 1, Math.max(0, results.length - 1))); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); return; }
    if (event.key === "Enter" && results[selected]) { event.preventDefault(); choose(results[selected].record.href); return; }
    if (event.key === "Tab" && dialogRef.current) {
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("input, button, a[href]")).filter(element => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  return createPortal(
    <div className="docs-search-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="docs-search-dialog" role="dialog" aria-modal="true" aria-label={t("search.dialogLabel")} ref={dialogRef} onKeyDown={handleKeyDown}>
        <div className="docs-search-input-row">
          <Search aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("search.placeholder")} />
          <button type="button" onClick={onClose} aria-label={t("search.close")}><X aria-hidden="true" /></button>
        </div>
        <div className="docs-search-results" role="listbox">
          {loading ? <div className="docs-search-empty">{t("search.loading")}</div>
            : !query.trim() ? <div className="docs-search-empty">{t("search.prompt")}</div>
            : results.length === 0 ? <div className="docs-search-empty">{t("search.empty")}</div>
            : results.map(({ record }, index) => (
              <button key={record.id} type="button" role="option" aria-selected={selected === index} className={selected === index ? "is-selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => choose(record.href)}>
                <FileText aria-hidden="true" />
                <span><strong>{record.title}</strong><small>{record.description}</small></span>
              </button>
            ))}
        </div>
        <div className="docs-search-help"><span>{t("search.selectHint")}</span><span>{t("search.openHint")}</span><span>{t("search.closeKeyboardHint")}</span></div>
      </div>
    </div>, document.body
  );
}
