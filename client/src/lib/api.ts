// Тонкая обёртка над fetch: всегда отправляет куки сессии, разбирает JSON-ошибки
// в понятный текст на русском (требование репозитория — понятные ошибки без кодов).

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Для FormData (загрузка файла) заголовок Content-Type нельзя ставить вручную —
  // браузер сам добавит правильную multipart-границу.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message = isJson && body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : "Не удалось выполнить запрос. Попробуйте ещё раз.";
    throw new ApiError(message);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", body: formData }),
};
