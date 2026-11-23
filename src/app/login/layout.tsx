import AllowBodyScroll from '@/components/AllowBodyScroll';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (<><AllowBodyScroll />{children}</>);
}
