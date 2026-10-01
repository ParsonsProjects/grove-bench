import { mount } from 'svelte';
import '../fonts.js';
import '../styles.css';
import OgImage from './OgImage.svelte';

mount(OgImage, { target: document.getElementById('og') });
