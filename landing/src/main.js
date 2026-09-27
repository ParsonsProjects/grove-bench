import App from './App.svelte';
import './fonts.js';
import './styles.css';
import { mount } from 'svelte';

const app = mount(App, { target: document.getElementById('app') });

export default app;
