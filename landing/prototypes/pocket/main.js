import '../../src/fonts.js';
import '../shared/proto.css';
import { mount } from 'svelte';
import Pocket from './Pocket.svelte';

mount(Pocket, { target: document.getElementById('app') });
