import { dbAdapter } from "../db";

export interface FileRecord {
  conversation_id?: string | null;
  original_name?: string | null;
  id: string;
  owner_id: string;
  instance_id: string | null;
  filename: string;
  mime_type: string;
  size: number;
  storage_path: string;
  deleted_at?: string | null;
  cleanup_completed_at?: string | null;
  upload_request_id?: string;
  created_at: string;
}

export const filesRepo = {
  findUpload(ownerId: string, instanceId: string, conversationId: string, uploadId: string) {
    return dbAdapter.findChatUpload(ownerId, instanceId, conversationId, uploadId) as Promise<FileRecord | null>;
  },

  createUploadOnce(data: Partial<FileRecord> & { upload_request_id: string }) {
    return dbAdapter.createChatUploadOnce(data) as Promise<{ file: FileRecord; created: boolean }>;
  },
  create(data: Partial<FileRecord>) {
    return dbAdapter.createFileRecord(data) as Promise<FileRecord>;
  },

  findById(id: string) {
    return dbAdapter.getFileRecordById(id) as Promise<FileRecord | null>;
  },

  updateInstanceId(id: string, instanceId: string | null, storagePath?: string) {
    const updateData: any = { instance_id: instanceId };
    if (storagePath) updateData.storage_path = storagePath;
    return dbAdapter.updateFileRecord(id, updateData) as Promise<FileRecord | null>;
  },

  listByConversation(instanceId: string, conversationId: string) {
    return dbAdapter.listFilesByConversation(instanceId, conversationId) as Promise<FileRecord[]>;
  },

  deleteByConversation(instanceId: string, conversationId: string) {
    return dbAdapter.deleteFileRecordsByConversation(instanceId, conversationId);
  },

  softDelete(id: string) {
    return dbAdapter.updateFileRecord(id, { deleted_at: new Date().toISOString(), cleanup_completed_at: null }) as Promise<FileRecord | null>;
  },

  markCleanupComplete(id: string) {
    return dbAdapter.updateFileRecord(id, { cleanup_completed_at: new Date().toISOString() }) as Promise<FileRecord | null>;
  },

  listPendingDeleted(limit = 50) {
    const listPending = (dbAdapter as any).listPendingDeletedFileRecords;
    return typeof listPending === "function"
      ? listPending.call(dbAdapter, limit) as Promise<FileRecord[]>
      : Promise.resolve([]);
  },

  hasActiveStorageIdentity(instanceId: string, conversationId: string, filename: string) {
    const hasActive = (dbAdapter as any).hasActiveFileRecord;
    return typeof hasActive === "function"
      ? hasActive.call(dbAdapter, instanceId, conversationId, filename) as Promise<boolean>
      : Promise.resolve(true);
  },

  async delete(id: string) {
    await dbAdapter.deleteFileRecord(id);
  },

  listUnboundByOwner(ownerId: string) {
    return dbAdapter.listUnboundFilesByOwner(ownerId) as Promise<FileRecord[]>;
  }
};
