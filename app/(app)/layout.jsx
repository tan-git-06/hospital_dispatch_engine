// (app) is a ROUTE GROUP: the parentheses mean it doesn't appear in the URL.
// Every page inside gets the sidebar shell; /login sits outside it and doesn't.
import Shell from '@/components/Shell';

export default function AppLayout({ children }) {
  return <Shell>{children}</Shell>;
}
