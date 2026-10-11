import '../styles/fonts.js';
import '../styles/globals.css';
import { mount } from 'svelte';
import UiKit from './UiKit.svelte';

mount(UiKit, { target: document.getElementById('app')! });
