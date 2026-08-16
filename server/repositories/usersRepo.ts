import { dbAdapter } from "../db";

export const usersRepo = {
  findByUsername(username: string) { return dbAdapter.getUserByUsername(username); },
  findById(id: string) { return dbAdapter.getUserById(id); },
  create(user: { id: string; username: string; username_normalized: string; password_hash: string; role: string }) { return dbAdapter.createUser(user); },
  updateRole(username: string, role: string) { return dbAdapter.updateUserRole(username, role); },
  updateProfile(id: string, updates: { password_hash?: string; avatar_url?: string }) { return dbAdapter.updateUserProfile(id, updates); },
  count() { return dbAdapter.getUserCount(); },
  countActiveAdmins() { return dbAdapter.countActiveAdmins(); },
  getAdminUsersList(params: { page: number; pageSize: number; search?: string; role?: string; status?: string }) { return dbAdapter.getAdminUsersList(params); },
  updateUser(id: string, updates: any) { return dbAdapter.updateAdminUser(id, updates); }
};
