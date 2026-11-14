/**
 * Storage локального Supabase для смоука пульса: бакет аудио встреч и уборка частей, которые
 * `meeting-ingest` положил по встречам смоука.
 */
export interface StorageTarget {
  readonly url: string;
  readonly key: string;
  readonly bucket: string;
}

async function storage(
  target: StorageTarget,
  method: string,
  route: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${target.url}/storage/v1/${route}`, {
    method,
    headers: {
      apikey: target.key,
      Authorization: `Bearer ${target.key}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

export async function ensureBucket(target: StorageTarget): Promise<void> {
  const response = await storage(target, "POST", "bucket", {
    id: target.bucket,
    name: target.bucket,
    public: false,
  });
  await response.body?.cancel(); // уже есть — 409, это нормально
}

interface Entry {
  readonly name: string;
  readonly id: string | null;
}

/**
 * Части, которые meeting-ingest положил в Storage по встрече (вложенность — до одного уровня).
 */
async function storedParts(target: StorageTarget, meetingId: string): Promise<string[]> {
  const list = async (prefix: string): Promise<Entry[]> => {
    const response = await storage(target, "POST", `object/list/${target.bucket}`, {
      prefix,
      limit: 1000,
    });
    if (!response.ok) return [];
    return (await response.json()) as Entry[];
  };
  const rows = await list(meetingId);
  const nested = await Promise.all(
    rows
      .filter((row) => row.id === null)
      .map(async (folder) => {
        const files = await list(`${meetingId}/${folder.name}`);
        return files.map((file) => `${meetingId}/${folder.name}/${file.name}`);
      }),
  );
  return [
    ...rows.filter((row) => row.id !== null).map((row) => `${meetingId}/${row.name}`),
    ...nested.flat(),
  ];
}

/**
 * Убрать из Storage всё, что выгрузки положили по этим встречам; не вышло — ошибка.
 */
export async function removeMeetingParts(
  target: StorageTarget,
  meetingIds: readonly string[],
): Promise<void> {
  const found = await Promise.all(meetingIds.map(async (id) => storedParts(target, id)));
  const parts = found.flat();
  if (parts.length === 0) return;
  const response = await storage(target, "DELETE", `object/${target.bucket}`, { prefixes: parts });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Storage: HTTP ${String(response.status)}`);
}
