import '../../src/fonts.js';
import '../shared/proto.css';
import { mount } from 'svelte';
import Crew from './Crew.svelte';

mount(Crew, { target: document.getElementById('app') });
