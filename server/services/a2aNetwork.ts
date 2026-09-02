import type Docker from "dockerode";
import { A2A_COLLABORATION_NETWORK } from "../../shared/a2aConfig";

export async function connectContainerToA2ANetwork(docker: Docker, containerId: string): Promise<void> {
  let network = docker.getNetwork(A2A_COLLABORATION_NETWORK);
  try {
    await network.inspect();
  } catch (error: any) {
    if (error?.statusCode !== 404) throw error;
    try {
      network = await docker.createNetwork({
        Name: A2A_COLLABORATION_NETWORK,
        Internal: true,
        Attachable: true,
        Labels: {
          "com.mybay.managed": "true",
          "com.mybay.purpose": "a2a-collaboration",
        },
      }) as any;
    } catch (createError: any) {
      const alreadyExists = createError?.statusCode === 409 || /already exists/i.test(String(createError?.message || ""));
      if (!alreadyExists) throw createError;
      network = docker.getNetwork(A2A_COLLABORATION_NETWORK);
    }
  }
  try {
    await network.connect({ Container: containerId });
  } catch (error: any) {
    const alreadyConnected = error?.statusCode === 409 || /already exists|already connected/i.test(String(error?.message || ""));
    if (!alreadyConnected) throw error;
  }
}
