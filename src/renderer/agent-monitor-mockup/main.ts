import '../styles/fonts.js';
import '../styles/globals.css';
import { mount } from 'svelte';
import MonitorView from './MonitorView.svelte';

mount(MonitorView, { target: document.getElementById('app')!, props: { class: 'h-screen' } });
