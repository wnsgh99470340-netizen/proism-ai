import { redirect } from 'next/navigation';

/** 2026-11-12 사장님: 블로그 AI 는 CRM 안의 탭으로 합침. 예전 주소(/)는 CRM 으로 보낸다 */
export default function Home() {
  redirect('/crm');
}
