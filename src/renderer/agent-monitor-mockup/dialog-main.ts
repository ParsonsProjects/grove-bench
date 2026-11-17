// The demo app (main.ts, loaded before this) brings the styles and fonts.
import { mount } from 'svelte';
import MonitorDialog from './MonitorDialog.svelte';

mount(MonitorDialog, { target: document.getElementById('monitor')! });
