import ProxiesPageView from '../components/proxies/ProxiesPageView';
import { useProxiesPage } from '../hooks/useProxiesPage';

export default function ProxiesPage() {
  const vm = useProxiesPage();
  return <ProxiesPageView {...vm} />;
}