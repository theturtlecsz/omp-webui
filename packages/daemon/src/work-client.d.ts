// Narrow surface of @oh-my-pi/pi-work-client used by oversight.ts. tsconfig `paths`
// points typecheck here so the daemon's stricter flags skip the linked package source.
export declare class WorkClient {
  constructor(baseUrl: string, workspaceId: string, token: () => string | null);
}
export declare function readOversight(client: WorkClient): Promise<unknown>;
export declare function engageOversightStop(client: WorkClient, reason: string): Promise<{ stopped: boolean }>;
