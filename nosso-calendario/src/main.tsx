import { render } from 'preact';
import './styles/app.css';
import { App } from './app';
import { engine } from './services/engine';
import { registerServiceWorker } from './services/sw';

// Erros inesperados nunca viram tela branca nem botão morto: o app segue
// funcionando e o detalhe técnico fica só no console.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[nosso-calendario]', e.reason);
});

const root = document.getElementById('app')!;
root.textContent = '';
render(<App />, root);
window.__ncMounted = true;
window.dispatchEvent(new Event('nc:mounted'));

engine.start().catch((e) => console.error('[nosso-calendario] start', e));
registerServiceWorker();
