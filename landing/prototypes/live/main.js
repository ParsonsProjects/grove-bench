import '../../src/fonts.js';
import '../shared/proto.css';
import { mount } from 'svelte';
import Live from './Live.svelte';

mount(Live, { target: document.getElementById('app') });
