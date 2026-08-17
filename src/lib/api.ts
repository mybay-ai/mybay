import { getAuthToken } from "./auth";
import { shouldBroadcastUnauthorized } from "./authNavigation";
import { humanizeChatError } from "./chatRuntimeErrors";

export interface ApiError extends Error {
  status?: number;
  code?: string;
  technicalMessage?: string;
  data?: any;
}

async function fetchApiResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token && token !== "null" && token !== "undefined") {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Default to JSON if body is present and not FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = { error: response.statusText };
    }

    const humanized = humanizeChatError({ data: errorData, status: response.status }, response.statusText || "请求失败");
    const error: ApiError = new Error(humanized.message);
    error.status = response.status;
    error.code = humanized.code || undefined;
    error.technicalMessage = humanized.technicalMessage;
    error.data = errorData;
    
    // Global 401 handling could go here (e.g., redirect to login)
    if (shouldBroadcastUnauthorized(path, response.status)) {
      // Dispatch a custom event or use a global state to handle logout
      window.dispatchEvent(new CustomEvent("api-unauthorized"));
    }

    throw error;
  }

  return response;
}

export async function apiFetchRaw(path: string, options: RequestInit = {}): Promise<Response> {
  return fetchApiResponse(path, options);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetchApiResponse(path, options);

  // Handle empty responses
  if (response.status === 204) {
    return null;
  }

  // Handle non-JSON responses (like blob for export)
  const contentType = response.headers.get("Content-Type");
  if (contentType && !contentType.includes("application/json")) {
    return response;
  }

  return response.json();
}

export const api = {

  getChatAttachmentConfig: async () => {
    return apiFetch(`/api/instances/chat-files/config`);
  },

  uploadChatFiles: async (instanceId: string, conversationId: string, files: FileList | File[]) => {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }
    // We cannot use api.post because it stringifies body.
    return apiFetch(`/api/instances/${instanceId}/conversations/${conversationId}/files`, {
      method: "POST",
      body: formData
    });
  },
  listChatFiles: async (instanceId: string, conversationId: string) => {
    return apiFetch(`/api/instances/${instanceId}/conversations/${conversationId}/files`);
  },
  deleteChatFile: async (instanceId: string, conversationId: string, fileId: string) => {
    return apiFetch(`/api/instances/${instanceId}/conversations/${conversationId}/files/${fileId}`, {
      method: "DELETE"
    });
  },
  downloadChatFile: async (instanceId: string, conversationId: string, fileId: string, disposition: "attachment" | "inline" = "attachment", options?: RequestInit): Promise<Response> => {
    return apiFetchRaw(`/api/instances/${instanceId}/conversations/${conversationId}/files/${fileId}/download?disposition=${encodeURIComponent(disposition)}`, options);
  },

  get: <T = any>(path: string, options?: RequestInit): Promise<T> => apiFetch(path, { ...options, method: "GET" }),
  getRaw: (path: string, options?: RequestInit): Promise<Response> => apiFetchRaw(path, { ...options, method: "GET" }),
  post: (path: string, body?: any, options?: RequestInit) => 
    apiFetch(path, { ...options, method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: (path: string, body?: any, options?: RequestInit) => 
    apiFetch(path, { ...options, method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  /**
   * Performs a PATCH request. The second argument is the request body (business payload),
   * which will be automatically JSON-stringified. RequestInit options go in the third argument.
   */
  patch: (path: string, body?: any, options?: RequestInit) => 
    apiFetch(path, { ...options, method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  /**
   * Performs a DELETE request. The second argument is the request body (business payload),
   * which will be automatically JSON-stringified. RequestInit options go in the third argument.
   */
  delete: (path: string, body?: any, options?: RequestInit) => 
    apiFetch(path, { ...options, method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};

