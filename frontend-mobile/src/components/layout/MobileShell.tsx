import { useWebSocket } from '../../hooks/useWebSocket';
import PreviewBanner from '../ui/PreviewBanner';
import AnimatedOutlet from './AnimatedOutlet';
import BottomNav from './BottomNav';
import SideNav from './SideNav';

export default function MobileShell() {
  useWebSocket();

  return (
    <div className="mobile-app">
      <PreviewBanner />
      <div className="mobile-shell-body">
        <SideNav />
        <main className="mobile-main">
          <AnimatedOutlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}