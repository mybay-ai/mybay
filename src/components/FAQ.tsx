import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { 
  HelpCircle, 
  ChevronDown, 
  Rocket, 
  ShieldCheck, 
  Cpu, 
  CreditCard, 
  ExternalLink,
  Search,
  X,
  Zap,
  Server,
  MessageSquare,
  ShieldAlert,
  Layers,
  FileText,
  Clock,
  Lock,
  BarChart3,
  Wrench,
  ArrowRight,
  LifeBuoy,
  MessageCircle,
  FileSearch,
  Sparkles,
  ChevronRight,
  History,
  CornerDownRight,
  ArrowLeft
} from "lucide-react";
import { cn } from "./ui";
import { FAQItem, FAQCategory } from "../data/faqs";

// Map string icon names to Lucide icons
const IconMap: Record<string, React.ComponentType<any>> = {
  Zap,
  Server,
  Cpu,
  MessageSquare,
  ShieldAlert,
  Layers,
  FileText,
  Clock,
  Lock,
  BarChart3,
  Wrench
};

interface FAQItemCardProps {
  item: FAQItem;
  searchQuery: string;
  onTagClick: (tag: string) => void;
  lang: string;
  categories: FAQCategory[];
}

const FAQItemCard: React.FC<FAQItemCardProps> = ({ item, searchQuery, onTagClick, lang, categories }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation("marketing");
  const isZh = lang === "zh-CN";

  // Helper to highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, index) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={index} className="bg-yellow-100 text-yellow-900 rounded-sm px-0.5 font-medium">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  return (
    <div 
      className={cn(
        "bg-surface border rounded-2xl transition-all duration-300 overflow-hidden",
        isOpen 
          ? "border-blue-200 shadow-md shadow-blue-50/50" 
          : "border-outline hover:border-outline-strong hover:shadow-sm"
      )}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left px-5 py-4 md:px-6 md:py-5 flex items-start gap-4 justify-between leading-relaxed"
      >
        <div className="space-y-1">
          <span className="text-xs font-semibold px-2 py-0.5 bg-surface-muted text-content-muted rounded-md">
            {categories.find(cat => cat.id === item.category)?.name || item.category}
          </span>
          <h4 className={cn(
            "text-sm md:text-base font-bold text-content leading-snug transition-colors pt-1",
            isOpen ? "text-blue-600" : "group-hover:text-content"
          )}>
            {highlightText(item.question, searchQuery)}
          </h4>
        </div>
        <div className={cn(
          "p-1.5 rounded-lg border transition-all duration-300 shrink-0 mt-1",
          isOpen ? "bg-blue-50 border-blue-200 text-blue-600 rotate-180" : "bg-surface-muted border-outline text-content-muted"
        )}>
          <ChevronDown className="w-4 h-4" />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            <div className="px-5 pb-5 md:px-6 md:pb-6 pt-1 border-t border-outline bg-surface-muted/30">
              <div className="prose prose-slate prose-sm max-w-none text-content-secondary space-y-4 text-sm leading-relaxed whitespace-pre-wrap text-left">
                {highlightText(item.answer, searchQuery)}
              </div>
              
              {/* Special tags on the FAQ answer */}
              <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-4 border-t border-dashed border-outline">
                <span className="text-[10px] text-content-muted font-medium">{t("faq.tagLabel")}</span>
                {item.tags.map((tag) => (
                  <button
                    key={tag}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTagClick(tag);
                    }}
                    className="text-[10px] font-medium px-2 py-0.5 bg-surface-muted hover:bg-blue-50 hover:text-blue-600 text-content-muted transition-colors rounded-full"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const FAQPage: React.FC = () => {
  const { t, i18n } = useTranslation("marketing");
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  
  const isZh = i18n.language === "zh-CN";

  const categoriesRaw = t("faq.categories", { returnObjects: true });
  const categories = Array.isArray(categoriesRaw) ? categoriesRaw as FAQCategory[] : [];
  const itemsRaw = t("faq.items", { returnObjects: true });
  const items = Array.isArray(itemsRaw) ? itemsRaw as FAQItem[] : [];

  // Read category from URL query parameters (default to 'all')
  const activeCategory = searchParams.get("category") || "all";

  const recommendedSearchesRaw = t("faq.recommendedSearches", { returnObjects: true });
  const recommendedSearches = Array.isArray(recommendedSearchesRaw)
    ? recommendedSearchesRaw as string[]
    : (isZh
      ? ["部署", "智能体", "密码保护", "飞书", "无法打开", "免费"]
      : ["Deploy", "Agent", "Password", "Feishu", "Cannot open", "Free"]);

  // Filter category helper
  const handleSelectCategory = (catId: string) => {
    if (catId === "all") {
      searchParams.delete("category");
    } else {
      searchParams.set("category", catId);
    }
    setSearchParams(searchParams);
  };

  const clearFilters = () => {
    setSearchQuery("");
    searchParams.delete("category");
    setSearchParams(searchParams);
  };

  const handleTagClick = (tag: string) => {
    setSearchQuery(tag);
  };

  // Memoized filtered items based on category and search query
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Category Filter
      if (activeCategory !== "all" && item.category !== activeCategory) {
        return false;
      }
      
      // 2. Search Query Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const categoryLabel = categories.find(cat => cat.id === item.category)?.name?.toLowerCase() || "";
        
        const matchQuestion = item.question.toLowerCase().includes(query);
        const matchAnswer = item.answer.toLowerCase().includes(query);
        const matchCategory = categoryLabel.includes(query);
        const matchTags = item.tags.some(tag => tag.toLowerCase().includes(query));

        return matchQuestion || matchAnswer || matchCategory || matchTags;
      }

      return true;
    });
  }, [activeCategory, searchQuery, items, categories]);

  return (
    <div className="min-h-screen bg-app-canvas text-content selection:bg-blue-100 selection:text-blue-900 pb-20">
      {/* 1. Hero Area */}
      <section 
        className="relative overflow-hidden text-white pt-32 pb-24 px-6 sm:px-8 border-b border-slate-800/80"
        style={{
          background: "radial-gradient(circle at 50% 20%, rgba(91, 102, 255, 0.28), transparent 38%), linear-gradient(135deg, #0b1024 0%, #12183a 50%, #1c1b4f 100%)"
        }}
      >
        <div className="absolute inset-0 opacity-15 overflow-hidden pointer-events-none">
          {/* Subtle decoration lines/shadows */}
          <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-blue-500 rounded-full blur-[120px]" />
          <div className="absolute top-1/2 right-1/4 w-80 h-80 bg-indigo-500 rounded-full blur-[100px]" />
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:16px_16px]" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-1.5 justify-center">
            <Link to="/" className="inline-flex items-center gap-1.5 text-content-muted hover:text-white transition-colors text-[11px] font-bold uppercase tracking-widest text-left">
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("faq.appStrings.backHome")}
            </Link>
          </div>


          <motion.h1 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl md:text-5xl font-black text-white tracking-tight"
          >
            {t("faq.title")}
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm md:text-base text-white/80 max-w-2xl mx-auto font-normal"
            style={{
              color: "rgba(255, 255, 255, 0.78)",
              lineHeight: "1.8"
            }}
          >
            {t("faq.subtitle")}
          </motion.p>

          {/* Majestic Interactive Search Input */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="max-w-2xl mx-auto pt-4"
          >
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-30 group-focus-within:opacity-50 transition duration-300" />
              <div 
                className="relative flex items-center rounded-xl shadow-2xl overflow-hidden border"
                style={{
                  background: "rgba(255, 255, 255, 0.96)",
                  boxShadow: "0 24px 80px rgba(80, 90, 255, 0.22)",
                  borderColor: "rgba(255, 255, 255, 0.5)"
                }}
              >
                <Search className="w-5 h-5 text-content-muted ml-4 shrink-0" />
                <input 
                  type="text"
                  placeholder={t("faq.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-slate-800 placeholder-slate-400 text-sm md:text-base py-4 px-3 focus:outline-none focus:ring-0 text-left"
                />
                
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery("")}
                    className="p-1 text-content-muted hover:text-slate-800 mr-3 rounded-full hover:bg-control-hover transition-colors shrink-0"
                    title="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Quick searches chips */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-5 text-xs">
              <span className="text-content-muted font-medium mr-1">{t("faq.appStrings.popularTags")}</span>
              {recommendedSearches.map((keyword) => (
                <button
                  key={keyword}
                  onClick={() => setSearchQuery(keyword)}
                  className="px-3 py-1.5 rounded-lg transition-all text-[11px] font-medium border cursor-pointer"
                  style={{
                    background: "rgba(255, 255, 255, 0.12)",
                    borderColor: "rgba(255, 255, 255, 0.16)",
                    color: "rgba(255, 255, 255, 0.82)"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.18)";
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                    e.currentTarget.style.color = "rgba(255, 255, 255, 0.82)";
                  }}
                >
                  {keyword}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* 2. Content Layout */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Inner Sidebar Category Selector */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-surface border border-outline rounded-2xl p-4 sticky top-6 shadow-sm">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-outline">
                <h3 className="text-sm font-bold text-content flex items-center gap-2">
                  <Layers className="w-4 h-4 text-content-muted" />
                  {t("faq.appStrings.filterCategory")}
                </h3>
                {activeCategory !== "all" && (
                  <button 
                    onClick={() => handleSelectCategory("all")}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {t("faq.appStrings.reset")}
                  </button>
                )}
              </div>

              {/* Category Buttons List */}
              <div className="space-y-1">
                <button
                  onClick={() => handleSelectCategory("all")}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-between",
                    activeCategory === "all"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-content-secondary hover:bg-surface-muted hover:text-content"
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <HelpCircle className="w-4 h-4 shrink-0 opacity-80" />
                    {t("faq.appStrings.allCoreQs")}
                  </span>
                  <span className={cn(
                    "text-2xs px-2 py-0.5 rounded-full font-bold",
                    activeCategory === "all" ? "bg-blue-500 text-white" : "bg-surface-muted text-content-muted"
                  )}>
                    {items.length}
                  </span>
                </button>

                {categories.map((cat) => {
                  const CategoryIcon = IconMap[cat.iconName] || HelpCircle;
                  const count = items.filter(item => item.category === cat.id).length;
                  const isActive = activeCategory === cat.id;

                  return (
                    <button
                      key={cat.id}
                      onClick={() => handleSelectCategory(cat.id)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-between group",
                        isActive
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-content-secondary hover:bg-surface-muted hover:text-content"
                      )}
                    >
                      <span className="flex items-center gap-2.5 min-w-0 truncate">
                        <CategoryIcon className={cn(
                          "w-4 h-4 shrink-0 transition-transform group-hover:scale-110",
                          isActive ? "text-white" : "text-content-muted"
                        )} />
                        <span className="truncate">{cat.name}</span>
                      </span>
                      <span className={cn(
                        "text-2xs px-2 py-0.5 rounded-full font-bold shrink-0",
                        isActive ? "bg-blue-500 text-white" : "bg-surface-muted text-content-muted"
                      )}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Main FAQ Accordion Area */}
          <div className="lg:col-span-3 space-y-6">
            
            {/* Header / Active filters notification */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface border border-outline p-4 rounded-2xl shadow-sm text-left">
              <div className="space-y-0.5">
                <h2 className="text-lg font-bold text-content">
                  {activeCategory === "all" 
                    ? t("faq.appStrings.allCoreQs")
                    : categories.find(c => c.id === activeCategory)?.name}
                </h2>
                <p className="text-xs text-content-muted">
                  {activeCategory === "all" 
                    ? t("faq.appStrings.allSearchDesc")
                    : categories.find(c => c.id === activeCategory)?.description}
                </p>
              </div>

              {/* Status information */}
              <div className="text-xs text-content-muted bg-surface-muted px-3 py-1.5 rounded-xl border border-outline flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
                <span>
                  {t("faq.appStrings.resultsFoundTag").replace("{{count}}", String(filteredItems.length))}
                </span>
              </div>
            </div>

            {/* Empty State */}
            {filteredItems.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface border border-dashed border-outline-strong rounded-3xl p-12 text-center"
              >
                <div className="w-16 h-16 bg-surface-muted border border-outline rounded-2xl mx-auto flex items-center justify-center mb-4">
                  <FileSearch className="w-8 h-8 text-content-muted" />
                </div>
                <h3 className="text-base font-bold text-content mb-1">
                  {t("faq.appStrings.noResult")}
                </h3>
                <p className="text-sm text-content-muted max-w-sm mx-auto mb-6">
                  {t("faq.appStrings.noResultDesc").replace("{{query}}", searchQuery)}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={clearFilters}
                    className="text-xs font-bold px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 transition-colors rounded-xl shadow-xs"
                  >
                    {t("faq.appStrings.clearSearch")}
                  </button>
                  <Link
                    to="/app/guides"
                    className="text-xs font-semibold px-4 py-2 text-content-secondary hover:text-content transition-colors bg-surface-muted hover:bg-control-hover rounded-xl"
                  >
                    {t("faq.appStrings.viewGuidebooks")}
                  </Link>
                </div>
              </motion.div>
            ) : (
              <div className="space-y-4">
                <AnimatePresence mode="popLayout">
                  {filteredItems.map((item, idx) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
                    >
                      <FAQItemCard 
                        item={item} 
                        searchQuery={searchQuery}
                        onTagClick={handleTagClick}
                        lang={i18n.language}
                        categories={categories}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* 4. Support Call-to-action Section */}
            <div className="bg-gradient-to-r from-slate-50 to-slate-100/70 border border-outline rounded-3xl p-6 sm:p-8 mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 items-center text-left">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-100 rounded-lg text-blue-600 text-[10px] font-bold uppercase tracking-wider">
                  <LifeBuoy className="w-3.5 h-3.5" />
                  <span>{t("faq.appStrings.unresolvedHeader")}</span>
                </div>
                <h3 className="text-xl font-bold text-content tracking-tight">
                  {t("faq.appStrings.unresolvedTitle")}
                </h3>
                <p className="text-xs md:text-sm text-content-muted leading-relaxed">
                  {t("faq.appStrings.unresolvedDesc")}
                </p>
              </div>

              {/* Action Buttons Link Card */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href="mailto:support@mybay.ai?subject=MyBay Product Support Request"
                  className="bg-surface hover:bg-surface-muted border border-outline p-4 rounded-2xl shadow-xs transition-all flex flex-col items-start gap-2 group cursor-pointer"
                >
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:scale-110 transition-transform">
                    <MessageCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-content flex items-center gap-1">
                      {t("faq.appStrings.contactSupport")}
                      <ArrowRight className="w-3 h-3 text-content-muted group-hover:translate-x-0.5 transition-transform" />
                    </span>
                    <span className="text-[11px] text-content-muted">{t("faq.appStrings.contactSupportSub")}</span>
                  </div>
                </a>

                <Link
                  to="/app/instances"
                  className="bg-surface hover:bg-surface-muted border border-outline p-4 rounded-2xl shadow-xs transition-all flex flex-col items-start gap-2 group"
                >
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl group-hover:scale-110 transition-transform">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-content flex items-center gap-1 border-0">
                      {t("faq.appStrings.examineLogs")}
                      <ArrowRight className="w-3 h-3 text-content-muted group-hover:translate-x-0.5 transition-transform" />
                    </span>
                    <span className="text-[11px] text-content-muted">{t("faq.appStrings.examineLogsSub")}</span>
                  </div>
                </Link>

                <Link
                  to="/app"
                  className="bg-surface hover:bg-surface-muted border border-outline p-4 rounded-2xl shadow-xs transition-all flex flex-col items-start gap-2 group"
                >
                  <div className="p-2 bg-teal-50 text-teal-600 rounded-xl group-hover:scale-110 transition-transform">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-content flex items-center gap-1 border-0">
                      {t("faq.appStrings.returnConsole")}
                      <ArrowRight className="w-3 h-3 text-content-muted group-hover:translate-x-0.5 transition-transform" />
                    </span>
                    <span className="text-[11px] text-content-muted">{t("faq.appStrings.returnConsoleSub")}</span>
                  </div>
                </Link>

                <a
                  href="mailto:support@mybay.ai?subject=MyBay Feature Feedback"
                  className="bg-surface hover:bg-surface-muted border border-outline p-4 rounded-2xl shadow-xs transition-all flex flex-col items-start gap-2 group cursor-pointer"
                >
                  <div className="p-2 bg-amber-50 text-amber-600 rounded-xl group-hover:scale-110 transition-transform">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-content flex items-center gap-1">
                      {t("faq.appStrings.suggestFeatures")}
                      <ArrowRight className="w-3 h-3 text-content-muted group-hover:translate-x-0.5 transition-transform" />
                    </span>
                    <span className="text-[11px] text-content-muted">{t("faq.appStrings.suggestFeaturesSub")}</span>
                  </div>
                </a>
              </div>
            </div>

          </div>

        </div>
      </section>
    </div>
  );
};

export default FAQPage;
