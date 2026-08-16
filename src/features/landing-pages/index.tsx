import { ACTIVE_LANDING_PAGE } from "./landing.config";
import { LegacyLandingPage } from "./variants/LegacyLandingPage";
import { MainLandingPage } from "./variants/MainLandingPage";
import { OpenSourceLandingPage } from "./variants/OpenSourceLandingPage";

export function ActiveLandingPage({ currentUser }: { currentUser: any }) {
  switch (ACTIVE_LANDING_PAGE) {
    case "legacy":
      return <LegacyLandingPage currentUser={currentUser} />;
    case "main":
    default:
      return <MainLandingPage currentUser={currentUser} />;
  }
}

export { LegacyLandingPage, MainLandingPage, OpenSourceLandingPage };
