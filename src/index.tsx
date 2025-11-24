/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App.tsx';

const root = document.getElementById('root');

if (root instanceof HTMLElement) {
  render(() => <App />, root);
}
