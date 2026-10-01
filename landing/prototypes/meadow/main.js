import '../../src/fonts.js';
import '../day/base.css';
import { mount } from 'svelte';
import Meadow from './Meadow.svelte';

mount(Meadow, { target: document.getElementById('app') });
