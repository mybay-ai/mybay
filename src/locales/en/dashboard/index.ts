import base from "./base.json";
import overview from "./overview.json";
import templateCenter from "./template_center.json";
import chatWorkspace from "./chatWorkspace.json";
import instanceStatus from "./instanceStatus.json";
import theme from "./theme.json";
import runtimeMetrics from "./runtimeMetrics.json";
import credentials from "./credentials.json";
import versionRepository from "./versionRepository.json";

const dashboard = {
  ...base,
  overview,
  template_center: templateCenter,
  chatWorkspace,
  instanceStatus,
  theme,
  runtimeMetrics,
  credentials,
  versionRepository,
};

export default dashboard;
