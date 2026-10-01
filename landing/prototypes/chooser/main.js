import '../../src/fonts.js';
import '../shared/proto.css';
import { mount } from 'svelte';
import Chooser from './Chooser.svelte';

mount(Chooser, { target: document.getElementById('app') });
