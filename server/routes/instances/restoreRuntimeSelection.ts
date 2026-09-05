import { runtimeRegistry } from "../../runtime/runtimeRegistry";
import { getRuntimeReleaseBoundary } from "../../utils/runtimeReleaseBoundary";
import { resolveCreateRuntimeImage } from "./createRuntimeImageSelection";

export async function resolveRestoredRuntimeMetadata(options: {
  configData: any;
  userRole: string;
}) {
  const { configData, userRole } = options;
  const runtimeBoundary = getRuntimeReleaseBoundary(configData.runtime_type);
  if (runtimeBoundary) return { ok: false as const, status: runtimeBoundary.status, body: runtimeBoundary };

  const runtimeType = runtimeRegistry.resolveRuntimeType(configData.runtime_type);
  configData.runtime_type = runtimeType;
  const imageResult = await resolveCreateRuntimeImage({ data: configData, secureData: configData, userRole });
  if (imageResult.ok === false) return imageResult;

  return {
    ok: true as const,
    selection: imageResult.selection,
    binding: runtimeRegistry.createBindingForInstance({ runtime_type: runtimeType }),
  };
}
