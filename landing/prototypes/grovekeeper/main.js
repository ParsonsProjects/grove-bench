import '../../src/fonts.js';
import '../shared/proto.css';
import { mount } from 'svelte';
import Grovekeeper from './Grovekeeper.svelte';

mount(Grovekeeper, { target: document.getElementById('app') });
