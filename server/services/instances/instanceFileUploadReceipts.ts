import crypto from "node:crypto";
import { mutateStoreCollections, readStoreCollections } from "../../localStore";

export type InstanceFileUploadReceipt = {
  id: string;
  uploadId: string;
  instanceId: string;
  directory: string;
  name: string;
  path: string;
  size: number;
  sha256: string;
  createdAt: string;
};

function receiptId(instanceId: string, uploadId: string) {
  return crypto.createHash("sha256").update(JSON.stringify([instanceId, uploadId])).digest("hex");
}

export function getInstanceFileUploadReceipt(instanceId: string, uploadId: string): InstanceFileUploadReceipt | undefined {
  const id = receiptId(instanceId, uploadId);
  return readStoreCollections(["instanceFileUploads"]).instanceFileUploads.find((row) => row.id === id);
}

export function commitInstanceFileUploadReceipt(input: Omit<InstanceFileUploadReceipt, "id" | "createdAt">) {
  return mutateStoreCollections(["instanceFileUploads"], (store) => {
    const id = receiptId(input.instanceId, input.uploadId);
    const existing = store.instanceFileUploads.find((row) => row.id === id) as InstanceFileUploadReceipt | undefined;
    if (existing) {
      const same = existing.directory === input.directory && existing.name === input.name
        && existing.path === input.path && existing.size === input.size && existing.sha256 === input.sha256;
      if (!same) throw Object.assign(new Error("UPLOAD_REQUEST_CONFLICT"), { status: 409, code: "UPLOAD_REQUEST_CONFLICT" });
      return existing;
    }
    const receipt: InstanceFileUploadReceipt = { ...input, id, createdAt: new Date().toISOString() };
    store.instanceFileUploads.push(receipt);
    return receipt;
  });
}
