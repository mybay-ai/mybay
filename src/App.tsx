import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import type { AgentInstance, User } from "./types";
import { AuthScreen, ProfileModal } from "./components/AuthAndProfile";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { InstanceLoginScreen } from "./components/InstanceLoginScreen";
import { MarketingLayout } from "./components/marketing/MarketingLayout";
import { OpenSourceLandingPage } from "./features/landing-pages";
import { FirstRunSetupPage } from "./features/first-run/FirstRunSetupPage";
import { getStoredUser, setStoredUser, clearStoredUser } from "./lib/auth";
import { api } from "./lib/api";
import { APP_ROUTES } from "./constants/routes";
import { VALID_GUIDES } from "./data/docs/docs.registry";
import { SEOHead } from "./components/SEOHead";
import { FeedbackProvider } from "./components/FeedbackProvider";
import { ChannelAuthInbox } from "./components/ChannelAuthInbox";
import { ThemeProvider } from "./components/ThemeProvider";
import { recentActions } from "./lib/recentActions";

import ChangelogPage from "./components/Changelog";
import PrivacyPage from "./components/Privacy";
import TermsPage from "./components/Terms";
import FAQPage from "./components/FAQ";
import SecurityPage from "./components/SecurityPage";
import { DocsPageV2 } from "./components/marketing/DocsPageV2";
import { GuideDocV2 } from "./components/GuideDocV2";
import { resolveDocsId } from "./lib/docs/docsAliases";
import { hasMarkdownDocument } from "./lib/docs/docsLoader";
import NotFound from "./components/NotFound";

// Lazy-loaded components for route-level optimization
const Dashboard = lazy(() => import("./components/Dashboard").then(m => ({ default: m.Dashboard })));
const DashboardLayout = lazy(() => import("./components/DashboardLayout").then(m => ({ default: m.DashboardLayout })));
const DeployWizard = lazy(() => import("./features/deploy/DeployWizard").then(m => ({ default: m.DeployWizard })));
const DeployPage = lazy(() => import("./features/deploy/DeployPage").then(m => ({ default: m.DeployPage })));
const TemplateCenter = lazy(() => import("./components/TemplateCenter").then(m => ({ default: m.TemplateCenter })));
const InstanceSetup = lazy(() => import("./components/dashboard/InstanceSetup").then(m => ({ default: m.InstanceSetup })));
const ChatWorkspace = lazy(() => import("./components/ChatWorkspace").then(m => ({ default: m.ChatWorkspace })));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-950" />
  </div>
);

const SOCKET_URL = typeof window !== "undefined" ? window.location.origin : "";

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      // Global window scroll
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.body.style.overflow = '';
      
      // Reset any inner scrolling containers (like Dashboard layout or Docs layout)
      setTimeout(() => {
        const scrollContainers = document.querySelectorAll('.overflow-y-auto, main');
        scrollContainers.forEach(container => {
          container.scrollTo({ top: 0, left: 0, behavior: "auto" });
        });
      }, 10);
    } else {
      setTimeout(() => {
        const element = document.getElementById(hash.substring(1));
        if (element) {
          // Check if the element is inside a custom scroll container
          const scrollParent = element.closest('.overflow-y-auto');
          if (scrollParent) {
             const parentRect = scrollParent.getBoundingClientRect();
             const elRect = element.getBoundingClientRect();
             const relativeTop = elRect.top - parentRect.top;
             scrollParent.scrollTo({
               top: scrollParent.scrollTop + relativeTop - 70, 
               behavior: 'smooth'
             });
          } else {
             element.scrollIntoView({ behavior: 'smooth' });
          }
        }
      }, 50);
    }
  }, [pathname, hash]);

  return null;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(() => getStoredUser());
  const [authLoading, setAuthLoading] = useState(() => {
    return typeof window === "undefined" || import.meta.env.SSR ? false : true;
  });
  const [showProfileModal, setShowProfileModal] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || import.meta.env.SSR) {
      setAuthLoading(false);
      return;
    }

    api.get("/api/auth/me")
      .then(data => {
        if (data && data.success) {
          const updatedUser: User = {
            id: data.id,
            username: data.username,
            role: data.role,
            avatar_url: data.avatar_url
          };
          
          setCurrentUser(updatedUser);
          setStoredUser(updatedUser);
        } else {
          setCurrentUser(null);
          clearStoredUser();
        }
      })
      .catch(err => {
        console.error("Session verification failed:", err);
        if (err.status === 401 || err.status === 403) {
          setCurrentUser(null);
          clearStoredUser();
        }
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!currentUser || currentUser.role !== "admin" || location.pathname === "/setup") return;
    api.get("/api/system/first-run")
      .then(state => {
        if (state?.required) navigate("/setup", { replace: true });
      })
      .catch(() => undefined);
  }, [currentUser, location.pathname, navigate]);
  const [selectedGuideId, setSelectedGuideId] = useState<string>("platform");
  const isKnownGuideId = (guideId: string) => {
    const resolved = resolveDocsId(guideId);
    return guideId === "platform" || VALID_GUIDES.includes(guideId) || resolved === "docs_home" || hasMarkdownDocument("zh-CN", resolved) || hasMarkdownDocument("en", resolved);
  };

  const handleSelectGuide = (guideId: string) => {
    const validId = isKnownGuideId(guideId) ? guideId : "platform";
    setSelectedGuideId(validId);
    navigate(`${APP_ROUTES.GUIDES}?guide=${encodeURIComponent(validId)}`, { replace: false });
  };

  useEffect(() => {
    if (location.pathname === APP_ROUTES.GUIDES) {
      const params = new URLSearchParams(location.search);
      const guideId = params.get("guide");
      if (guideId) {
        if (isKnownGuideId(guideId)) {
          setSelectedGuideId(guideId);
        } else {
          setSelectedGuideId("platform");
          navigate(`${APP_ROUTES.GUIDES}?guide=platform`, { replace: true });
        }
      } else {
        setSelectedGuideId("platform");
      }
    }
  }, [location.search, location.pathname, navigate]);
  const [features, setFeatures] = useState<{
    status: "unknown" | "loading" | "loaded";
    templateCenterEnabled: boolean;
    advancedResourceConfigEnabled: boolean;
  }>({
    status: "unknown",
    templateCenterEnabled: false,
    advancedResourceConfigEnabled: false
  });

  const handleLogout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch (err) {
      console.error("Backend logout failed:", err);
      return;
    }

    clearStoredUser();
    setCurrentUser(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    const handleUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener("api-unauthorized", handleUnauthorized);
    return () => window.removeEventListener("api-unauthorized", handleUnauthorized);
  }, [handleLogout]);

  useEffect(() => {
    if (currentUser) {
      fetchInstances();
      fetchFeatures();
    }
    const newSocket = io(SOCKET_URL, {
      withCredentials: true
    });
    setSocket(newSocket);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleInstancesUpdated = (payload?: { id?: string; action?: string; status?: string }) => {
      // Ignore socket broadcasts that were just triggered by this page.
      if (payload && payload.id && payload.action) {
        if (recentActions.isRecent(payload.id, payload.action)) {
          console.log(`[Socket Deduplication] Ignored duplicate update broadcast for instance ${payload.id} (${payload.action}) on the current page.`);
          return;
        }
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        // 静默检查首次运行状态，避免在普通路由显示初始化错误。
        fetchInstances(true);
      }, 500);
    };

    newSocket.on("instances_updated", handleInstancesUpdated);

    return () => { 
      newSocket.off("instances_updated", handleInstancesUpdated);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      newSocket.close(); 
    };
  }, [currentUser]);

  const fetchInstances = async (silent: boolean = false) => {
    if (!currentUser) return;
    try {
      if (!silent) setInstancesLoading(true);
      const data = await api.get("/api/instances");
      setInstances(data);
    } catch (e) {
      console.error("Error fetching instances:", e);
    } finally {
      if (!silent) setInstancesLoading(false);
    }
  };

  const fetchFeatures = async () => {
    try {
      setFeatures(f => ({ ...f, status: "loading" }));
      const data = await api.get("/api/system/features");
      if (data && typeof data.templateCenterEnabled === "boolean" && typeof data.advancedResourceConfigEnabled === "boolean") {
        setFeatures({
          status: "loaded",
          templateCenterEnabled: data.templateCenterEnabled,
          advancedResourceConfigEnabled: data.advancedResourceConfigEnabled
        });
      } else {
        setFeatures(f => ({ ...f, status: "loaded" }));
      }
    } catch (e) {
      console.error("Error fetching system features:", e);
      setFeatures(f => ({ ...f, status: "loaded" }));
    }
  };

  const handleLoginSuccess = (user: any) => {
    setCurrentUser(user);
    
    const searchParams = new URLSearchParams(window.location.search);
    const returnTo = searchParams.get('returnTo');
    if (returnTo) {
      setTimeout(() => navigate(returnTo), 50);
    }
    // Removed redundant navigate(APP_ROUTES.DASHBOARD) - AuthScreen handles its own navigation flow
  };

  if (authLoading) {
    return <PageLoader />;
  }

  return (
    <>
      <SEOHead />
      <Suspense fallback={<PageLoader />}>
        <Routes>
        {/* Primary Root Route: dashboard for signed-in users, open-source choice page for visitors */}
        <Route path="/" element={
          currentUser ? (
            <Navigate to={APP_ROUTES.DASHBOARD} replace />
          ) : (
            <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
              <OpenSourceLandingPage />
            </MarketingLayout>
          )
        } />
        
        {/* Deprecated Marketing & Landing Routes: Redirect to / */}
        <Route path="/landing/*" element={<Navigate to="/" replace />} />
        <Route path="/features" element={<Navigate to="/" replace />} />
        <Route path="/models" element={<Navigate to="/" replace />} />
        <Route path="/contact" element={<Navigate to="/" replace />} />
        <Route path="/demo/*" element={<Navigate to="/" replace />} />
        <Route path="/demo" element={<Navigate to="/" replace />} />

        {/* Console Auth Routes */}
        <Route path="/login" element={
          currentUser ? (
            <Navigate to={APP_ROUTES.DASHBOARD} replace />
          ) : (
            <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
              <AuthScreen onLogin={handleLoginSuccess} />
            </MarketingLayout>
          )
        } />

        <Route path="/register" element={<Navigate to="/login" replace />} />

        <Route path="/instance-login" element={
          <InstanceLoginScreen />
        } />

        <Route path="/docs" element={<DocsPageV2 currentUser={currentUser} />} />
        <Route path="/docs/*" element={<DocsPageV2 currentUser={currentUser} />} />

        <Route path="/changelog" element={
          <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
            <ChangelogPage />
          </MarketingLayout>
        } />

        <Route path="/privacy" element={
          <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
            <PrivacyPage />
          </MarketingLayout>
        } />

        <Route path="/terms" element={
          <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
            <TermsPage />
          </MarketingLayout>
        } />

        <Route path="/security" element={
          <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
            <SecurityPage />
          </MarketingLayout>
        } />

        <Route path="/faq" element={
          <MarketingLayout currentUser={currentUser} authLoading={authLoading}>
            <FAQPage />
          </MarketingLayout>
        } />

        <Route path="/setup" element={
          currentUser ? <FirstRunSetupPage /> : <Navigate to="/login" replace />
        } />
        {/* Dashboard Routes (Protected) */}
        <Route path={APP_ROUTES.DASHBOARD} element={
          currentUser ? (
            <DashboardLayout 
              currentUser={currentUser} 
              onLogout={handleLogout}
              setShowProfileModal={setShowProfileModal}
              instances={instances}
              templateCenterEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
            >
              <ErrorBoundary>
                <Dashboard 
                  instances={instances} 
                  loading={instancesLoading}
                  fetchInstances={fetchInstances} 
                  socket={socket} 
                  currentUser={currentUser} 
                  templateWorkflowsEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
                  onViewGuide={(guideId: string) => { 
                    setSelectedGuideId(guideId); 
                    navigate(`${APP_ROUTES.GUIDES}?guide=${guideId}`);
                  }} 
                  advancedResourceConfigEnabled={features.status === "loaded" ? features.advancedResourceConfigEnabled : false}
                />
              </ErrorBoundary>
            </DashboardLayout>
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.INSTANCES} element={
          currentUser ? (
            <DashboardLayout 
              currentUser={currentUser} 
              onLogout={handleLogout}
              setShowProfileModal={setShowProfileModal}
              instances={instances}
              templateCenterEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
            >
              <ErrorBoundary>
                <Dashboard 
                  instances={instances} 
                  loading={instancesLoading}
                  fetchInstances={fetchInstances} 
                  socket={socket} 
                  currentUser={currentUser} 
                  onViewGuide={(guideId: string) => { 
                    setSelectedGuideId(guideId); 
                    navigate(`${APP_ROUTES.GUIDES}?guide=${guideId}`);
                  }} 
                  advancedResourceConfigEnabled={features.status === "loaded" ? features.advancedResourceConfigEnabled : false}
                />
              </ErrorBoundary>
            </DashboardLayout>
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.CREDENTIALS} element={
          currentUser ? (
            <DashboardLayout 
              currentUser={currentUser} 
              onLogout={handleLogout}
              setShowProfileModal={setShowProfileModal}
              instances={instances}
              templateCenterEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
            >
              <ErrorBoundary>
                <Dashboard 
                  instances={instances} 
                  loading={instancesLoading}
                  fetchInstances={fetchInstances} 
                  socket={socket} 
                  currentUser={currentUser} 
                  onViewGuide={(guideId: string) => { 
                    setSelectedGuideId(guideId); 
                    navigate(`${APP_ROUTES.GUIDES}?guide=${guideId}`);
                  }} 
                  advancedResourceConfigEnabled={features.status === "loaded" ? features.advancedResourceConfigEnabled : false}
                />
              </ErrorBoundary>
            </DashboardLayout>
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.INSTANCE_SETUP} element={
          currentUser ? (
            <ErrorBoundary>
              <InstanceSetup />
            </ErrorBoundary>
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.DEPLOY} element={
          currentUser ? (
            <DashboardLayout 
              currentUser={currentUser} 
              onLogout={handleLogout}
              setShowProfileModal={setShowProfileModal}
              instances={instances}
              templateCenterEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
            >
              <DeployPage 
                currentUser={currentUser} 
                socket={socket} 
                instances={instances}
                fetchInstances={fetchInstances} 
                templateWorkflowsEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
                advancedResourceConfigEnabled={features.status === "loaded" ? features.advancedResourceConfigEnabled : false}
              />
            </DashboardLayout>
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.TEMPLATES} element={
          currentUser ? (
            features.status === "unknown" || features.status === "loading" ? (
              <DashboardLayout 
                currentUser={currentUser} 
                onLogout={handleLogout}
                setShowProfileModal={setShowProfileModal}
                instances={instances}
                templateCenterEnabled={false}
              >
                <div className="flex items-center justify-center min-h-[400px]">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                </div>
              </DashboardLayout>
            ) : features.templateCenterEnabled ? (
              <DashboardLayout 
                currentUser={currentUser} 
                onLogout={handleLogout}
                setShowProfileModal={setShowProfileModal}
                instances={instances}
                templateCenterEnabled={features.templateCenterEnabled}
              >
                <TemplateCenter currentUser={currentUser} instances={instances} />
              </DashboardLayout>
            ) : <Navigate to={APP_ROUTES.DASHBOARD} />
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.GUIDES} element={
          currentUser ? (
            <DashboardLayout 
              currentUser={currentUser} 
              onLogout={handleLogout}
              setShowProfileModal={setShowProfileModal}
              instances={instances}
              templateCenterEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
            >
              <GuideDocV2 activeGuideId={selectedGuideId} setActiveGuideId={handleSelectGuide} variant="embedded" />
            </DashboardLayout>
          ) : <Navigate to="/login" />
        } />

        <Route path={APP_ROUTES.CHAT_WORKSPACE} element={
          currentUser ? (
            <DashboardLayout 
              currentUser={currentUser} 
              onLogout={handleLogout}
              setShowProfileModal={setShowProfileModal}
              instances={instances}
              templateCenterEnabled={features.status === "loaded" ? features.templateCenterEnabled : false}
            >
              <ChatWorkspace currentUser={currentUser} socket={socket} />
            </DashboardLayout>
          ) : <Navigate to="/login" />
        } />

        {/* Fallback */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>

      {currentUser && <ChannelAuthInbox currentUser={currentUser} socket={socket} />}

      {showProfileModal && currentUser && (
        <ProfileModal 
          user={currentUser} 
          onClose={() => setShowProfileModal(false)} 
          onUpdate={(updatedUser) => {
            const newUser = { ...currentUser, ...updatedUser };
            setCurrentUser(newUser);
            setStoredUser(newUser);
            setShowProfileModal(false);
          }} 
          onSilentUpdate={(updatedUser) => {
            const newUser = { ...currentUser, ...updatedUser };
            setCurrentUser(newUser);
            setStoredUser(newUser);
          }}
        />
      )}
    </>
  );
}

export function AppCore() {
  return (
    <>
      <ScrollToTop />
      <AppContent />
    </>
  );
}

export default function App() {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <ThemeProvider>
          <FeedbackProvider>
            <AppCore />
          </FeedbackProvider>
        </ThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  );
}


