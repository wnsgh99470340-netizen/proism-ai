import { initAllDatabases, ensureCustomerDbProperties } from '@/lib/notion';

export async function POST() {
  try {
    await ensureCustomerDbProperties();
    const dbIds = await initAllDatabases();

    return Response.json({
      success: true,
      message: '모든 Notion DB가 초기화되었습니다.',
      databases: dbIds,
    });
  } catch (error) {
    console.error('[Notion] 초기화 실패:', error);
    return Response.json(
      { error: 'Notion DB 초기화 실패', detail: String(error) },
      { status: 500 }
    );
  }
}
