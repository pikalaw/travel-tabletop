import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import { toast } from './ui/toast';
import { getMeta, setMeta } from './storage/db';
import './styles.css';

const root = document.getElementById('app')!;
let update: (() => void) | null = null;
const draw = () => render(<App update={update} />, root);
draw();

if ('serviceWorker' in navigator) {
  const activate = registerSW({
    // A new build is waiting: offer "Update now" on the home screen. It activates the waiting
    // worker, and the page reloads once that worker takes control.
    onNeedRefresh() {
      update = () => void activate(true);
      draw();
    },
    // The whole app is stored on this device: say so once, ever.
    async onOfflineReady() {
      if (await getMeta('offlineNoticeShown').catch(() => true)) return;
      toast('Ready to play offline', 'info', 5000);
      await setMeta('offlineNoticeShown', true).catch(() => {});
    },
  });
}
