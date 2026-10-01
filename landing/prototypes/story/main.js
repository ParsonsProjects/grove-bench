import '../../src/fonts.js';
import '../shared/proto.css';
import { mount } from 'svelte';
import Story from './Story.svelte';

mount(Story, { target: document.getElementById('app') });
