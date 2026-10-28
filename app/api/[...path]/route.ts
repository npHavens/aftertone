import { proxyLocalApi } from '@/lib/server/local-api-proxy';

export const runtime = 'nodejs';

type Context = { params: Promise<{ path: string[] }> };

async function handler(request: Request, context: Context) {
  const { path } = await context.params;
  return proxyLocalApi(request, path);
}

export { handler as GET, handler as POST, handler as DELETE };
