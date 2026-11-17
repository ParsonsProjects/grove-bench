import '../styles/fonts.js';
import '../styles/globals.css';
import { mount } from 'svelte';
import AgentMonitorMockup from './AgentMonitorMockup.svelte';

mount(AgentMonitorMockup, { target: document.getElementById('app')! });
