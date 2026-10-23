import App from './App.svelte';
import './fonts.js';
import './styles.css';
import { mount } from 'svelte';
import { applyBrand } from './lib/brand.js';

// The brand's colours and fonts as CSS variables, before anything draws.
applyBrand();

const app = mount(App, { target: document.getElementById('app') });

export default app;
