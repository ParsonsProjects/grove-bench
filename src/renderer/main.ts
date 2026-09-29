import './styles/globals.css';
import { mount } from 'svelte';
import App from './App.svelte';

// Build fingerprint.
document.documentElement.dataset.build = 'ff9a5334fa7b';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
