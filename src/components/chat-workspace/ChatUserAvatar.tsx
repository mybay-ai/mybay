import { useEffect, useState } from "react";
import { User } from "lucide-react";
import type { User as UserType } from "../../types";

interface ChatUserAvatarProps {
  currentUser?: UserType | null;
}

export function ChatUserAvatar({ currentUser }: ChatUserAvatarProps) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUrl = currentUser?.avatar_url && !avatarFailed ? currentUser.avatar_url : "";

  useEffect(() => {
    setAvatarFailed(false);
  }, [currentUser?.avatar_url]);

  return (
    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={currentUser?.username || "User"}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <User className="w-4 h-4" />
      )}
    </div>
  );
}