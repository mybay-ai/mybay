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
  created_at: string;
}

export const filesRepo = {
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
    return dbAdapter.updateFileRecord(id, { deleted_at: new Date().toISOString() }) as Promise<FileRecord | null>;
  },

  async delete(id: string) {
    await dbAdapter.deleteFileRecord(id);
  },

  listUnboundByOwner(ownerId: string) {
    return dbAdapter.listUnboundFilesByOwner(ownerId) as Promise<FileRecord[]>;
  }
};
