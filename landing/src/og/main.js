import { mount } from 'svelte';
import '../fonts.js';
import '../styles.css';
import { applyBrand } from '../lib/brand.js';
import OgImage from './OgImage.svelte';

applyBrand();
mount(OgImage, { target: document.getElementById('og') });
