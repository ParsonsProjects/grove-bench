import '../../src/fonts.js';
import '../day/base.css';
import { mount } from 'svelte';
import Trail from './Trail.svelte';

mount(Trail, { target: document.getElementById('app') });
